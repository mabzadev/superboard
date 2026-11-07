import {
	createProjectContextHeaders,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import identityWorker from "../../../../../../packages/plugins/superboard-authentification/worker/src/index.js";

const siteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const siteKey = "1x00000000000000000000AA";
const secret = "runtime-turnstile-secret";
const configurationPath = "/internal/v1/melody-admin/api/v1/configuration";
const database = Reflect.get(env, "DB") as D1Database;

type Verdict =
	| "success"
	| "failure"
	| "internal-error"
	| "server-error"
	| "network-error"
	| "timeout";
interface Verification {
	form: URLSearchParams;
	signal: AbortSignal | null | undefined;
}

let verdict: Verdict = "success";
let verifications: Verification[] = [];

async function clearConfiguration() {
	await database.batch([
		database.prepare("DELETE FROM identity_configuration"),
		database.prepare("DELETE FROM identity_configuration_history"),
		database.prepare("DELETE FROM application_auth_rate_limits"),
	]);
}

beforeEach(async () => {
	await clearConfiguration();
	verdict = "success";
	verifications = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		if (request.url !== siteverifyUrl)
			throw new Error(`Unexpected outbound request to ${request.url}`);
		const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
		verifications.push({ form, signal: init?.signal });
		if (verdict === "network-error") throw new TypeError("Network connection lost");
		if (verdict === "timeout") throw new DOMException("The operation timed out", "TimeoutError");
		if (verdict === "server-error") return new Response("unavailable", { status: 502 });
		if (verdict === "internal-error")
			return Response.json({ success: false, "error-codes": ["internal-error"] });
		if (verdict === "failure")
			return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
		return Response.json({ success: true, "error-codes": [], hostname: "auth.example.test" });
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await clearConfiguration();
});

function context(method: string, pathname: string, role: string, operator: boolean) {
	const value: InternalProjectContext = {
		module: "identity",
		method,
		pathname,
		projectId: 101,
		projectRef: "10-test",
		instanceId: 10,
		environment: "test",
		actorId: 0,
		role,
		requestId: crypto.randomUUID(),
		issuedAt: Math.floor(Date.now() / 1000),
		...(operator ? { operatorId: "captcha-operator" } : {}),
	};
	return createProjectContextHeaders(value, "identity-runtime-internal-token");
}

async function call(request: Request, withSecret = true): Promise<Response> {
	const fetch = identityWorker.fetch;
	if (!fetch) throw new Error("The identity worker has no fetch handler");
	const bindings = withSecret ? { ...env, TURNSTILE_SECRET_KEY: secret } : env;
	return fetch(request, bindings, createExecutionContext());
}

async function settings(method: "GET" | "PUT", body?: unknown, withSecret = true) {
	const headers = await context(method, configurationPath, "admin", true);
	headers.set("content-type", "application/json");
	return call(
		new Request(`https://identity.test${configurationPath}`, {
			method,
			headers,
			...(body ? { body: JSON.stringify(body) } : {}),
		}),
		withSecret,
	);
}

async function configure(values: Record<string, unknown>) {
	const current = await (await settings("GET")).json<{ revision: number }>();
	const saved = await settings("PUT", { revision: current.revision, values });
	expect({ status: saved.status, body: await saved.text() }).toMatchObject({ status: 200 });
}

async function outcome(response: Response) {
	return { status: response.status, body: await response.json<Record<string, unknown>>() };
}

async function sdk(
	pathname: string,
	body: Record<string, unknown>,
	options: { headers?: Record<string, string>; withSecret?: boolean } = {},
) {
	const headers = await context("POST", pathname, "sdk", false);
	headers.set("content-type", "application/json");
	headers.set("cf-connecting-ip", "198.51.100.7");
	for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
	return call(
		new Request(`https://identity.test${pathname}`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}),
		options.withSecret ?? true,
	);
}

async function hosted(pathname: string, body: Record<string, unknown>) {
	return call(
		new Request(`https://identity.test${pathname}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"cf-connecting-ip": "198.51.100.8",
				"x-superboard-auth-gateway": "1",
			},
			body: JSON.stringify({ scope: "openid profile", locale: "en", ...body }),
		}),
	);
}

function account(label: string) {
	return {
		email: `${label}-${crypto.randomUUID()}@example.test`,
		password: "captcha-runtime-password",
	};
}

async function errorCode(response: Response) {
	const body = await response.json<{ error?: { code?: string } }>();
	return body.error?.code;
}

describe("Turnstile CAPTCHA", () => {
	it("stores the switch and site key where identity workers released before CAPTCHA do not read them", async () => {
		await configure({
			ENABLE_CAPTCHA: true,
			TURNSTILE_SITE_KEY: siteKey,
			EMAIL_SENDER_NAME: "Captcha",
		});
		const read = await (await settings("GET")).json<{ values: Record<string, unknown> }>();
		expect(read.values).toMatchObject({
			ENABLE_CAPTCHA: true,
			TURNSTILE_SITE_KEY: siteKey,
			EMAIL_SENDER_NAME: "Captcha",
		});
		const row = await database
			.prepare("SELECT values_json FROM identity_configuration WHERE realm=?")
			.bind("test:local")
			.first<{ values_json: string }>();
		const legacyValues = JSON.parse(row?.values_json ?? "{}") as Record<string, unknown>;
		expect(legacyValues).toMatchObject({ EMAIL_SENDER_NAME: "Captcha" });
		expect(legacyValues).not.toHaveProperty("ENABLE_CAPTCHA");
		expect(legacyValues).not.toHaveProperty("TURNSTILE_SITE_KEY");

		await database
			.prepare("UPDATE identity_configuration SET values_json=? WHERE realm=?")
			.bind(
				JSON.stringify({ ...legacyValues, EMAIL_SENDER_NAME: "Written by an older worker" }),
				"test:local",
			)
			.run();
		expect(
			(await (await settings("GET")).json<{ values: Record<string, unknown> }>()).values,
		).toMatchObject({ ENABLE_CAPTCHA: true, EMAIL_SENDER_NAME: "Written by an older worker" });
	});

	it("rejects a site key that cannot be embedded in the hosted pages", async () => {
		const saved = await settings("PUT", {
			revision: 0,
			values: { TURNSTILE_SITE_KEY: `${siteKey}"</script>` },
		});
		expect(saved.status).toBe(422);
		expect(await saved.json()).toMatchObject({
			error: { code: "configuration_invalid", field: "TURNSTILE_SITE_KEY" },
		});
	});

	it("reports whether the deployment holds the secret key without revealing it", async () => {
		const withSecret = await (await settings("GET")).text();
		expect(withSecret).not.toContain(secret);
		expect(JSON.parse(withSecret)).toMatchObject({ deployment: { captchaSecret: true } });
		expect(await (await settings("GET", undefined, false)).json()).toMatchObject({
			deployment: { captchaSecret: false },
		});
	});

	it("keeps registration and password sign-in unchanged while CAPTCHA is off or incomplete", async () => {
		const off = account("off");
		expect((await sdk("/auth/register", off)).status).toBe(201);

		await configure({ ENABLE_CAPTCHA: true, TURNSTILE_SITE_KEY: siteKey });
		const missingSecret = account("missing-secret");
		expect((await sdk("/auth/register", missingSecret, { withSecret: false })).status).toBe(201);
		expect((await sdk("/auth/signin/password", missingSecret, { withSecret: false })).status).toBe(
			200,
		);

		await configure({ TURNSTILE_SITE_KEY: "" });
		expect((await sdk("/auth/signin/password", off)).status).toBe(200);
		expect(verifications).toHaveLength(0);
	});

	it("requires a verified token to register and sends Turnstile the visitor address", async () => {
		await configure({ ENABLE_CAPTCHA: true, TURNSTILE_SITE_KEY: siteKey });
		const visitor = account("register");
		const missing = await sdk("/auth/register", visitor);
		expect(missing.status).toBe(403);
		expect(await errorCode(missing)).toBe("captcha_required");
		expect(verifications).toHaveLength(0);

		const registered = await sdk("/auth/register", { ...visitor, captcha_token: "body-token" });
		expect(await outcome(registered)).toMatchObject({ status: 201 });
		expect(verifications).toHaveLength(1);
		const [verification] = verifications;
		expect(verification?.form.get("secret")).toBe(secret);
		expect(verification?.form.get("response")).toBe("body-token");
		expect(verification?.form.get("remoteip")).toBe("198.51.100.7");
		expect(verification?.form.get("idempotency_key")).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
		);
		expect(verification?.signal).toBeInstanceOf(AbortSignal);
	});

	it("accepts the token from the header or the Turnstile form field and rejects a refused token", async () => {
		const visitor = account("sign-in");
		expect((await sdk("/auth/register", visitor)).status).toBe(201);
		await configure({ ENABLE_CAPTCHA: true, TURNSTILE_SITE_KEY: siteKey });

		const byHeader = await sdk("/auth/signin/password", visitor, {
			headers: { "X-SuperBoard-Captcha-Token": "header-token" },
		});
		expect(await outcome(byHeader)).toMatchObject({ status: 200 });
		const byField = await sdk("/auth/signin/password", {
			...visitor,
			"cf-turnstile-response": "field-token",
		});
		expect(byField.status).toBe(200);
		expect(verifications.map(({ form }) => form.get("response"))).toEqual([
			"header-token",
			"field-token",
		]);

		verdict = "failure";
		const refused = await sdk("/auth/signin/password", { ...visitor, captcha_token: "reused" });
		expect(refused.status).toBe(403);
		expect(await errorCode(refused)).toBe("captcha_failed");
	});

	it("fails closed when Turnstile cannot confirm a token", async () => {
		await configure({ ENABLE_CAPTCHA: true, TURNSTILE_SITE_KEY: siteKey });
		const visitors = [];
		for (const outage of ["network-error", "timeout", "server-error", "internal-error"] as const) {
			verdict = outage;
			const visitor = account(outage);
			visitors.push(visitor.email);
			const response = await sdk("/auth/register", { ...visitor, captcha_token: "token" });
			expect({ outage, ...(await outcome(response)) }).toMatchObject({
				outage,
				status: 503,
				body: { error: { code: "captcha_unavailable", retryable: true } },
			});
		}
		expect(
			await database
				.prepare(
					`SELECT COUNT(*) count FROM application_users WHERE email IN (${visitors.map(() => "?").join(",")})`,
				)
				.bind(...visitors)
				.first("count"),
		).toBe(0);
	});

	it("leaves anonymous sign-in and session refresh without a challenge", async () => {
		await configure({ ENABLE_CAPTCHA: true, TURNSTILE_SITE_KEY: siteKey });
		const anonymous = await sdk("/auth/anonymous", { installation_id: crypto.randomUUID() });
		expect(anonymous.status).toBe(200);
		const session = await anonymous.json<{ refresh_token: string }>();
		expect((await sdk("/auth/refresh", { refresh_token: session.refresh_token })).status).toBe(200);
		expect(verifications).toHaveLength(0);
	});

	it("protects the application sign-in command", async () => {
		const visitor = account("command");
		expect((await sdk("/auth/register", visitor)).status).toBe(201);
		await configure({ ENABLE_CAPTCHA: true, TURNSTILE_SITE_KEY: siteKey });
		const path = "/internal/v1/application-plugin/commands/application_sign_in";
		const missing = await sdk(path, visitor);
		expect(missing.status).toBe(403);
		expect(await errorCode(missing)).toBe("captcha_required");
		const signedIn = await sdk(path, visitor, {
			headers: { "X-SuperBoard-Captcha-Token": "command-token" },
		});
		expect(await outcome(signedIn)).toMatchObject({ status: 200 });
		expect(verifications.at(-1)?.form.get("remoteip")).toBe("198.51.100.7");
	});

	it("protects hosted and embedded sign-up and password sign-in", async () => {
		const routes = [
			"/identity/v1/authorize-password",
			"/identity/v1/authorize-account",
			`/embedded-auth/v1/${crypto.randomUUID()}/sign-in`,
			`/embedded-auth/v1/${crypto.randomUUID()}/sign-up`,
		];
		const unprotected = await Promise.all(
			routes.map(async (route) => (await hosted(route, account("hosted"))).status),
		);
		expect(unprotected.every((status) => status !== 403 && status !== 503)).toBe(true);

		await configure({ ENABLE_CAPTCHA: true, TURNSTILE_SITE_KEY: siteKey });
		for (const [index, route] of routes.entries()) {
			const missing = await hosted(route, account("hosted"));
			expect({ route, ...(await outcome(missing)) }).toMatchObject({
				route,
				status: 403,
				body: { error: { code: "captcha_required" } },
			});

			const verified = await hosted(route, {
				...account("hosted"),
				"cf-turnstile-response": `hosted-token-${index}`,
			});
			expect({
				route,
				status: verified.status,
				remoteIp: verifications.at(-1)?.form.get("remoteip"),
			}).toEqual({ route, status: unprotected[index], remoteIp: "198.51.100.8" });

			verdict = "failure";
			const refused = await hosted(route, { ...account("hosted"), captcha_token: "refused" });
			expect({ route, ...(await outcome(refused)) }).toMatchObject({
				route,
				status: 403,
				body: { error: { code: "captcha_failed" } },
			});
			verdict = "success";
		}
	});

	it("gives the hosted sign-in page the site key and the Turnstile script only when CAPTCHA is complete", async () => {
		const client = await database
			.prepare("SELECT clientId FROM app WHERE id=1")
			.first<{ clientId: string }>();
		async function view(withSecret: boolean) {
			const authorize = new URL("https://identity.test/oauth2/v1/authorize");
			authorize.searchParams.set("client_id", client?.clientId ?? "");
			authorize.searchParams.set("redirect_uri", "http://localhost:3000/en/dashboard");
			authorize.searchParams.set("response_type", "code");
			authorize.searchParams.set("state", "captcha-state");
			authorize.searchParams.set(
				"code_challenge",
				"captcha-code-challenge-that-is-long-enough-for-pkce",
			);
			authorize.searchParams.set("code_challenge_method", "S256");
			authorize.searchParams.set("scope", "openid profile offline_access");
			authorize.searchParams.set("locale", "fr");
			const redirect = await call(
				new Request(authorize, {
					redirect: "manual",
					headers: { "x-superboard-auth-gateway": "1" },
				}),
				withSecret,
			);
			expect(redirect.status).toBe(302);
			const page = await call(
				new Request(new URL(redirect.headers.get("location") ?? "", authorize), {
					headers: { "x-superboard-auth-gateway": "1" },
				}),
				withSecret,
			);
			expect(page.status).toBe(200);
			return page.text();
		}

		const disabled = await view(true);
		expect(disabled).not.toContain("challenges.cloudflare.com");
		expect(disabled).toContain('captchaSiteKey: ""');

		await configure({ ENABLE_CAPTCHA: true, TURNSTILE_SITE_KEY: siteKey });
		expect(await view(false)).toContain('captchaSiteKey: ""');
		const enabled = await view(true);
		expect(enabled).toContain(`captchaSiteKey: "${siteKey}"`);
		expect(enabled).toContain(
			"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
		);
	});
});
