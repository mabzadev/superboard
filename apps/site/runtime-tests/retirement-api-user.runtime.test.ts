import { createExecutionContext, env, SELF } from "cloudflare:test";
import { expect, test, vi } from "vitest";

import { dispatchLifecycleApi } from "./lifecycle-health-services.js";
import {
	apiCommand,
	apiHeaders,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";

const plugin = "supbrd-plug-user";
const file = "retirement-api-user.runtime.test.ts";
function applicationCall(id: string, sdk: Record<string, string>, body?: unknown) {
	const method = body === undefined ? "GET" : "POST";
	const kind = method === "GET" ? "data-sources" : "commands";
	const operation = {
		method,
		path: `/api/v1/application-identity/${kind}/${id}`,
		...(body === undefined ? {} : { body }),
	};
	const url = new URL(
		`https://site.example/_emdash/api/superboard/plugins/${plugin}/${kind}/${id}`,
	);
	if (method === "GET") url.searchParams.set("request", JSON.stringify(operation));
	return SELF.fetch(url, {
		method,
		headers: { ...sdk, "Content-Type": "application/json" },
		...(method === "POST" ? { body: JSON.stringify(operation) } : {}),
	});
}

test("canonical User operations retain real SDK sessions, operator edits and verified provider links", async () => {
	const scope = await prepareApiPlugin(plugin);
	await prepareApiPlugin("supbrd-plugmod-email");
	await prepareApiPlugin("supbrd-plug-settings");
	const ref = scope.production_project_ref;
	const domain = "retirement-user.example.test";
	const db = pluginDatabase("identity");
	await jsonResult(
		await apiCommand("supbrd-plug-settings", "save_sdk_configuration", {
			method: "PUT",
			path: `/api/v1/app/projects/${ref}/setup/web`,
			body: {
				domain,
				minimum_version: "1.0.0",
				recommended_version: "1.0.0",
				maintenance_enabled: false,
			},
		}),
	);
	const rotated = await jsonResult<{ data: { id: string; secret: string } }>(
		await SELF.fetch(`https://site.example/api/v1/app/projects/${ref}/access-key/rotate`, {
			method: "POST",
			headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
			body: "{}",
		}),
	);
	const sdk = {
		"PROJECT-KEY": rotated.data.secret,
		PLATFORM: "web",
		IDENTIFIER: domain,
		ENVIRONMENT: "production",
		"X-Test-Identity-Provider": "google",
	};
	const email = "retirement-user@example.test";
	const password = "retirement-real-password-123";
	const register = await dispatchLifecycleApi(
		new Request("https://api.site.test/auth/register", {
			method: "POST",
			headers: { ...sdk, "Content-Type": "application/json" },
			body: JSON.stringify({ email, password, name: "Retirement User" }),
		}),
		{ ...env },
		createExecutionContext(),
	);
	const registered = await jsonResult<{ user: { id: string }; session_id: string }>(register, 201);
	const userId = registered.user.id;
	const signed = await jsonResult<{ access_token: string; session_id: string; user_id: string }>(
		await applicationCall("application_sign_in", sdk, { email, password }),
	);
	expect(signed.user_id).toBe(userId);
	expect(
		await db
			.prepare("SELECT user_id,revoked_at FROM application_sessions WHERE id=?")
			.bind(signed.session_id)
			.first(),
	).toEqual({ user_id: userId, revoked_at: null });
	proveApi(plugin, "application_sign_in", "mutation", file, [userId, signed.session_id]);
	const authenticated = { ...sdk, Authorization: `Bearer ${signed.access_token}` };
	const sessions = await jsonResult<{ session_ids: string[] }>(
		await applicationCall("active_sessions", authenticated),
	);
	expect(sessions.session_ids).toEqual(
		expect.arrayContaining([signed.session_id, registered.session_id]),
	);
	proveApi(plugin, "active_sessions", "read", file, [signed.session_id, registered.session_id]);
	const profilePath = `/api/v1/application-users/projects/${ref}/profiles/${userId}`;
	const updated = await jsonResult<{ data: { user_id: string; display_name: string } }>(
		await apiCommand(plugin, "update_profile", {
			method: "PUT",
			path: profilePath,
			body: { user_id: userId, display_name: "Updated by operator" },
		}),
	);
	expect(updated.data).toMatchObject({ user_id: userId, display_name: "Updated by operator" });
	expect(
		await db.prepare("SELECT name FROM application_users WHERE id=?").bind(userId).first(),
	).toEqual({ name: "Updated by operator" });
	proveApi(plugin, "update_profile", "mutation", file, [userId]);
	const current = await jsonResult<{ data: { user_id: string; display_name: string } }>(
		await apiRead(plugin, "current_profile", { method: "GET", path: profilePath }),
	);
	expect(current.data).toMatchObject({ user_id: userId, display_name: "Updated by operator" });
	proveApi(plugin, "current_profile", "read", file, [userId]);
	const members = await jsonResult<{ data: { items: string[] } }>(
		await apiRead(plugin, "members", {
			method: "GET",
			path: `/api/v1/application-users/projects/${ref}/members`,
		}),
	);
	expect(members.data.items).toContain(userId);
	proveApi(plugin, "members", "read", file, [userId]);
	const key = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const otherKey = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const jwk = {
		...(await crypto.subtle.exportKey("jwk", key.publicKey)),
		kid: "retirement-provider-key",
		alg: "RS256",
		use: "sig",
	};
	const claims = {
		sub: "retirement-provider-subject",
		iss: "https://accounts.google.com",
		aud: "retirement-provider-client",
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + 300,
		email,
		email_verified: true,
	};
	const providerFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		expect(input instanceof Request ? input.url : input instanceof URL ? input.href : input).toBe(
			"https://www.googleapis.com/oauth2/v3/certs",
		);
		return Response.json({ keys: [jwk] });
	});
	try {
		for (const [overrides, signingKey] of [
			[{ aud: "other-client" }, key.privateKey],
			[{ iss: "https://other-provider.example.test" }, key.privateKey],
			[{ exp: Math.floor(Date.now() / 1000) - 3600 }, key.privateKey],
			[{}, otherKey.privateKey],
		] as const) {
			const token = await providerToken({ ...claims, ...overrides }, signingKey);
			const rejected = await applicationCall("link_provider", authenticated, {
				provider: "google",
				token,
			});
			expect(rejected.status).toBe(401);
		}
		expect(
			await db
				.prepare(
					"SELECT COUNT(*) AS count FROM application_identities WHERE user_id=? AND provider='google'",
				)
				.bind(userId)
				.first(),
		).toEqual({ count: 0 });
		const token = await providerToken(claims, key.privateKey);
		const linked = await jsonResult<{ linked: boolean; provider: string }>(
			await applicationCall("link_provider", authenticated, { provider: "google", token }),
		);
		expect(linked).toMatchObject({ linked: true, provider: "google" });
		const link = await db
			.prepare(
				"SELECT id,user_id FROM application_identities WHERE user_id=? AND provider='google'",
			)
			.bind(userId)
			.first<{ id: string; user_id: string }>();
		expect(link?.user_id).toBe(userId);
		proveApi(plugin, "link_provider", "mutation", file, [userId, link!.id]);
		expect(
			await jsonResult(
				await applicationCall("link_provider", authenticated, { provider: "google", token }),
			),
		).toMatchObject({ linked: true, idempotent: true });
	} finally {
		providerFetch.mockRestore();
	}
	const providers = await jsonResult<{ providers: string[] }>(
		await applicationCall("linked_providers", authenticated),
	);
	expect(providers.providers).toEqual(["google"]);
	proveApi(plugin, "linked_providers", "read", file, [userId]);
	await jsonResult(
		await applicationCall("revoke_application_session", authenticated, {
			session_id: registered.session_id,
		}),
	);
	expect(
		(
			await jsonResult<{ session_ids: string[] }>(
				await applicationCall("active_sessions", authenticated),
			)
		).session_ids,
	).not.toContain(registered.session_id);
	expect(
		await db
			.prepare("SELECT revoked_at FROM application_sessions WHERE id=?")
			.bind(registered.session_id)
			.first<{ revoked_at: string }>(),
	).toMatchObject({ revoked_at: expect.any(String) });
	proveApi(plugin, "revoke_application_session", "mutation", file, [registered.session_id]);
	expect(
		await jsonResult(
			await apiCommand(plugin, "suspend_member", {
				method: "POST",
				path: `${profilePath}/suspend`,
				body: { user_id: userId, reason: "Retirement integration suspension" },
			}),
		),
	).toMatchObject({ data: { user_id: userId, status: "suspended" } });
	expect(
		await db
			.prepare("SELECT reason FROM application_user_suspensions WHERE user_id=?")
			.bind(userId)
			.first(),
	).toEqual({ reason: "Retirement integration suspension" });
	expect((await applicationCall("active_sessions", authenticated)).status).toBe(401);
	proveApi(plugin, "suspend_member", "mutation", file, [userId]);
});

async function providerToken(claims: Record<string, unknown>, key: CryptoKey) {
	const encoded = (value: string) =>
		btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
	const input = `${encoded(JSON.stringify({ alg: "RS256", kid: "retirement-provider-key", typ: "JWT" }))}.${encoded(JSON.stringify(claims))}`;
	const signature = new Uint8Array(
		await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)),
	);
	return `${input}.${encoded(String.fromCharCode(...signature))}`;
}
