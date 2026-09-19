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
