import assert from "node:assert/strict";
import test from "node:test";

import { SuperBoardClient, SuperBoardError } from "../../../../sdks/web/src/client.js";

const options = {
	apiUrl: "http://127.0.0.1:4321",
	projectKey: "project-key",
	appId: "demo.web",
	environment: "test",
};
const session = { access_token: "identity-one", refresh_token: "refresh-one", expires_in: 300 };

await test("application authentication and requests remain scoped to each client", async () => {
	const requests = [];
	const client = new SuperBoardClient({
		...options,
		fetch: async (url, init) => {
			requests.push({ url, ...init });
			return Response.json({
				data: url.endsWith("/auth/signin/password") ? session : { id: "user-one" },
			});
		},
	});
	await client.signIn("demo@example.test", "test-password");
	assert.deepEqual(await client.getProfile(), { id: "user-one" });
	assert.equal(requests[0].headers.has("Authorization"), false);
	assert.equal(requests[1].headers.get("Authorization"), "Bearer identity-one");
	assert.equal(requests[1].headers.get("PLATFORM"), "web");
	assert.equal(requests[1].headers.get("ENVIRONMENT"), "test");
	assert.equal(requests[1].headers.get("PROJECT-KEY"), "project-key");
	assert.equal(requests[1].credentials, "omit");
	assert.equal(requests[1].redirect, "error");
	const other = new SuperBoardClient({ ...options, fetch: client.fetch });
	assert.equal(other.session, null);
	await assert.rejects(other.getProfile(), { code: "session_required" });
});

await test("refresh is shared by concurrent callers and cannot restore a cleared session", async () => {
	let resolveRefresh;
	let calls = 0;
	const client = new SuperBoardClient({
		...options,
		fetch: async () => {
			calls++;
			return new Promise((resolve) => {
				resolveRefresh = resolve;
			});
		},
	});
	client.setSession(session);
	const first = client.refreshSession();
	const second = client.refreshSession();
	client.clearSession();
	resolveRefresh(
		Response.json({ data: { access_token: "new-access", refresh_token: "new-refresh" } }),
	);
	for (const result of await Promise.allSettled([first, second])) {
		assert.equal(result.status, "rejected");
		assert.equal(result.reason.code, "session_changed");
	}
	assert.equal(calls, 1);
	assert.equal(client.session, null);
});

await test("application token exchange is cached and invalidated on a new session", async () => {
	let calls = 0;
	const client = new SuperBoardClient({
		...options,
		fetch: async () => {
			calls++;
			return Response.json({ data: { access_token: `application-${calls}`, expires_in: 300 } });
		},
	});
	client.setSession(session);
	assert.equal(await client.getApplicationAccessToken(), "application-1");
	assert.equal(await client.getApplicationAccessToken(), "application-1");
	client.setSession({ ...session, access_token: "second-user" });
	assert.equal(await client.getApplicationAccessToken(), "application-2");
});

await test("request errors retain their code without accepting unsafe destinations", async () => {
	let calls = 0;
	const client = new SuperBoardClient({
		...options,
		fetch: async () => {
			calls++;
			return Response.json(
				{ error: { code: "invalid_credentials", message: "Invalid credentials" } },
				{ status: 401 },
			);
		},
	});
	await assert.rejects(
		client.signIn("demo@example.test", "wrong"),
		(error) =>
			error instanceof SuperBoardError &&
			error.code === "invalid_credentials" &&
			error.status === 401,
	);
	for (const path of [
		"https://other.example.test/",
		"//other.example.test/",
		"/\\other.example.test/",
	])
		await assert.rejects(client.request(path, { authenticated: false }), TypeError);
	assert.equal(calls, 1);
	assert.throws(
		() => new SuperBoardClient({ ...options, apiUrl: "http://remote.example.test" }),
		TypeError,
	);
});

await test("logout clears the session even when the server is unavailable", async () => {
	const client = new SuperBoardClient({
		...options,
		fetch: async () => {
			throw new Error("Unavailable");
		},
	});
	client.setSession(session);
	await assert.rejects(client.logout(), /Unavailable/u);
	assert.equal(client.session, null);
});

await test("Stripe checkout uses the application identity and carries SDK context", async () => {
	const requests = [];
	const client = new SuperBoardClient({
		...options,
		appVersion: "2.0.1",
		language: "fr-CH",
		fetch: async (url, init) => {
			requests.push({ url, init });
			if (url.endsWith("/auth/superboard-token"))
				return Response.json({ access_token: "application-token", expires_in: 300 });
			if (new URL(url).pathname === "/v1/monetization/purchases/stripe/checkout")
				return Response.json({ id: "checkout", url: "https://checkout.stripe.com/session" });
			return Response.json(
				{ error: { code: "not_found", message: "Unknown endpoint" } },
				{ status: 404 },
			);
		},
	});
	client.setSession(session);
	const result = await client.createCheckoutSession(
		{
			product_id: "product",
			success_url: "https://app.example.test/done",
			cancel_url: "https://app.example.test/cancel",
		},
		"stable-attempt",
	);
	assert.equal(result.id, "checkout");
	assert.equal(requests.at(-1).init.headers.get("Authorization"), "Bearer application-token");
	assert.equal(requests.at(-1).init.headers.get("Idempotency-Key"), "stable-attempt");
	assert.equal(requests.at(-1).init.headers.get("X-SuperBoard-Language"), "fr-CH");
	assert.equal(requests.at(-1).init.headers.get("X-SuperBoard-App-Version"), "2.0.1");
});

await test("purchase access is returned only from a verified CustomerInfo signature", async () => {
	const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
	const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const info = {
		customer_id: "customer",
		original_app_user_id: "user",
		entitlements: { premium: { is_active: false } },
	};
	const head = encoded({ alg: "ES256", kid: "test-key" });
	const claims = encoded({
		iss: "superboard-purchases",
		aud: "superboard-sdk",
		sub: "user",
		exp: Math.floor(Date.now() / 1000) + 60,
		customer_info: info,
	});
	const signature = Buffer.from(
		await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			pair.privateKey,
			new TextEncoder().encode(`${head}.${claims}`),
		),
	).toString("base64url");
	let tampered = false;
	const client = new SuperBoardClient({
		...options,
		fetch: async (url) =>
			Response.json(
				url.endsWith("superboard-token")
					? { access_token: "app-token", expires_in: 300 }
					: url.endsWith("purchases-jwks.json")
						? { keys: [{ ...publicKey, kid: "test-key" }] }
						: {
								...info,
								entitlements: { premium: { is_active: true } },
								signature_key_id: "test-key",
								signature: `${head}.${tampered ? encoded({ fake: true }) : claims}.${signature}`,
							},
			),
	});
	client.setSession(session);
	assert.equal((await client.getPurchaseCustomerInfo()).entitlements.premium.is_active, false);
	tampered = true;
	await assert.rejects(client.getPurchaseCustomerInfo(), { code: "customer_info_unverified" });
});

await test("concurrent application token callers share one exchange", async () => {
	let calls = 0;
	let release;
	const client = new SuperBoardClient({
		...options,
		fetch: async () => {
			calls++;
			await new Promise((resolve) => {
				release = resolve;
			});
			return Response.json({ access_token: "application-shared", expires_in: 300 });
		},
	});
	client.setSession(session);
	const pending = [client.getApplicationAccessToken(), client.getApplicationAccessToken()];
	await new Promise((resolve) => {
		setImmediate(resolve);
	});
	release();
	assert.deepEqual(await Promise.all(pending), ["application-shared", "application-shared"]);
	assert.equal(calls, 1);
});

await test("an expired access token is refreshed once and the request retried", async () => {
	const requests = [];
	const client = new SuperBoardClient({
		...options,
		fetch: async (url, init) => {
			const path = new URL(url).pathname;
			requests.push({
				path,
				authorization: init.headers.get("Authorization"),
				key: init.headers.get("Idempotency-Key"),
			});
			if (path === "/v1/auth/refresh")
				return Response.json({
					data: { access_token: "identity-two", refresh_token: "refresh-two" },
				});
			if (init.headers.get("Authorization") === "Bearer identity-two")
				return Response.json({ data: { id: "user-one" } });
			return Response.json(
				{ error: { code: "token_expired", message: "Expired" } },
				{ status: 401 },
			);
		},
	});
	client.setSession(session);
	assert.deepEqual(await client.updateProfile({ name: "Demo" }), { id: "user-one" });
	assert.deepEqual(
		requests.map((request) => request.path),
		["/v1/auth/me", "/v1/auth/refresh", "/v1/auth/me"],
	);
	assert.equal(requests[0].key, requests[2].key);
	assert.equal(client.session.access_token, "identity-two");
});

await test("a rejected refresh reports the original 401 without looping", async () => {
	let calls = 0;
	const client = new SuperBoardClient({
		...options,
		fetch: async () => {
			calls++;
			return Response.json({ error: { code: "unauthorized", message: "No" } }, { status: 401 });
		},
	});
	client.setSession(session);
	await assert.rejects(client.getProfile(), { code: "unauthorized", status: 401 });
	assert.equal(calls, 2);
	assert.equal(client.session, null);
});

await test("purchases signing keys are fetched once per kid", async () => {
	const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
	const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const info = { customer_id: "customer", original_app_user_id: "user", entitlements: {} };
	const head = encoded({ alg: "ES256", kid: "cached-key" });
	const claims = encoded({
		iss: "superboard-purchases",
		aud: "superboard-sdk",
		sub: "user",
		exp: Math.floor(Date.now() / 1000) + 60,
		customer_info: info,
	});
	const signature = Buffer.from(
		await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			pair.privateKey,
			new TextEncoder().encode(`${head}.${claims}`),
		),
	).toString("base64url");
	let keysetCalls = 0;
	const client = new SuperBoardClient({
		...options,
		fetch: async (url) => {
			if (url.endsWith("superboard-token"))
				return Response.json({ access_token: "app-token", expires_in: 300 });
			if (url.endsWith("purchases-jwks.json")) {
				keysetCalls++;
				return Response.json({ keys: [{ ...publicKey, kid: "cached-key" }] });
			}
			return Response.json({
				...info,
				signature_key_id: "cached-key",
				signature: `${head}.${claims}.${signature}`,
			});
		},
	});
	client.setSession(session);
	await client.getPurchaseCustomerInfo();
	await client.getPurchaseCustomerInfo();
	assert.equal(keysetCalls, 1);
});

await test("the SDK version header follows the published package version", async () => {
	const { readFile } = await import("node:fs/promises");
	const { version } = JSON.parse(
		await readFile(new URL("../../../../sdks/web/package.json", import.meta.url), "utf8"),
	);
	let header;
	const client = new SuperBoardClient({
		...options,
		fetch: async (_url, init) => {
			header = init.headers.get("X-SuperBoard-SDK-Version");
			return Response.json({ data: {} });
		},
	});
	await client.request("/v1/health", { authenticated: false });
	assert.equal(header, version);
});
