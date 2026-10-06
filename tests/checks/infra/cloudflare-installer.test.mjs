import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";

import {
	encryptedStore,
	cloudflareGrantToken,
} from "../../../infra/cloudflare-installer/encrypted-store.mjs";
import { installationRegistry } from "../../../infra/cloudflare-installer/installations.mjs";
import { installerOAuth } from "../../../infra/cloudflare-installer/oauth.mjs";
import { installerPage } from "../../../infra/cloudflare-installer/page.mjs";
import { createInstaller, startInstallation } from "../../../infra/cloudflare-installer/worker.mjs";
import { desiredCloudflareResources } from "../../../scripts/cloudflare/bootstrap-core.mjs";
import { installationTarget } from "../../../scripts/cloudflare/installation-target.mjs";
import { loadTarget, validateTarget } from "../../../scripts/cloudflare/target.mjs";
import { cloudflareInstallerFixture } from "../../fixtures/cloudflare/installer.mjs";
import { oauthFixture } from "../../fixtures/cloudflare/oauth.mjs";

const id = "12345678-1234-1234-1234-123456789012";
const input = {
	name: "vocostar",
	domain: "example.com",
	email: "admin@example.com",
	workersDevSubdomain: "example",
	installationId: id,
	accountId: "a".repeat(32),
	buildTokenUuid: id,
	automaticUpdates: true,
	analyticsToken: "simulated-read-only-analytics-token",
};

test("OAuth queues complete independent installations without creating any API token", async (t) => {
	const { env, database } = oauthFixture();
	t.after(() => database.close());
	const api = cloudflareInstallerFixture();
	let revision = "1".repeat(40);
	const registry = installationRegistry(env, (url, init) =>
		url.includes("/commits/")
			? Response.json({ sha: revision })
			: url.includes("/actions/runs/")
				? Response.json({ jobs: [{ name: `Install ${id}`, status: "completed" }] })
				: api.fetchImpl(url, init),
	);
	const authorization = {
		id: "grant-one",
		token: "oauth-access",
		refreshToken: "offline-refresh",
		expiresAt: Date.now() + 3_600_000,
	};
	const owner = "f".repeat(32);
	await registry.register(input, authorization, owner);
	const second = {
		...input,
		installationId: "22345678-1234-1234-1234-123456789012",
		accountId: "b".repeat(32),
	};
	await registry.register(second, authorization, owner);
	assert.equal((await registry.list(owner)).length, 2);
	assert.equal((await registry.list("e".repeat(32))).length, 0);
	assert.ok(api.calls.every(({ method }) => method === "GET"));
	assert.ok(api.calls.every(({ url }) => !url.includes("/tokens")));
	await assert.rejects(registry.register(input, authorization, "e".repeat(32)), /ID_CONFLICT/u);
	const firstRun = await registry.claim(input.installationId, revision, {
		runId: "123",
		ref: "refs/heads/main",
	});
	await assert.rejects(
		registry.claim(input.installationId, revision, { runId: "124", ref: "refs/heads/main" }),
		/ALREADY_RUNNING/u,
	);
	const request = new Request("https://install.example.com/runner", {
		headers: { Authorization: `Bearer ${firstRun.lease}` },
	});
	const context = await registry.context(request, firstRun.runId);
	assert.equal(context.accountId, input.accountId);
	assert.equal(context.token, authorization.token);
	assert.deepEqual(
		context.target,
		installationTarget({
			...input,
			hostPrefix: `${input.name}-${input.installationId.slice(0, 8)}`,
		}),
	);
	assert.ok(context.initial);
	await assert.rejects(
		registry.context(
			new Request(request.url, { headers: { Authorization: "Bearer " + "x".repeat(43) } }),
			firstRun.runId,
		),
		/RUN_UNAUTHORIZED/u,
	);
	await registry.persist(request, firstRun.runId, {
		SUPERBOARD_INSTALLATION_KEYS: { value: '{"fixture":"saved-key"}' },
	});
	await registry.complete(request, firstRun.runId, {
		status: "failed",
		errorCode: "INSTALLATION_TEST_FAILURE",
	});
	assert.equal(
		(await registry.list(owner)).find(({ id }) => id === input.installationId).status,
		"failed",
	);
	await assert.rejects(registry.persist(request, firstRun.runId, {}), /RUN_UNAUTHORIZED/u);
	await registry.configure(
		input.installationId,
		owner,
		{ automaticUpdates: true, retry: true },
		authorization,
	);
	const retried = await registry.claim(input.installationId, revision, {
		runId: "125",
		ref: "refs/heads/main",
	});
	const retryRequest = new Request(request.url, {
		headers: { Authorization: `Bearer ${retried.lease}` },
	});
	assert.equal(
		(await registry.context(retryRequest, retried.runId)).keys,
		'{"fixture":"saved-key"}',
	);
	await registry.persist(retryRequest, retried.runId, {
		SUPERBOARD_INITIAL_INSTALL: { value: "0" },
	});
	await registry.complete(retryRequest, retried.runId, { status: "deployed" });
	await registry.configure(input.installationId, owner, { automaticUpdates: false });
	revision = "2".repeat(40);
	const jobs = await registry.jobs({ ref: "refs/heads/main" });
	assert.ok(!jobs.some(({ id }) => id === input.installationId));
	assert.equal(jobs.find(({ id }) => id === second.installationId).revision, revision);
});

test("offline authorizations rotate their refresh token without creating API tokens", async (t) => {
	const { env, database } = oauthFixture();
	t.after(() => database.close());
	const store = encryptedStore(env);
	await store.put("grant:one", {
		token: "expired-access",
		refreshToken: "first-refresh",
		expiresAt: 0,
	});
	let calls = 0;
	const fetchImpl = async (url, init) => {
		calls += 1;
		assert.equal(url, "https://dash.cloudflare.com/oauth2/token");
		assert.equal(new URLSearchParams(init.body).get("refresh_token"), "first-refresh");
		return Response.json({
			token_type: "bearer",
			access_token: "renewed-access",
			refresh_token: "rotated-refresh",
			expires_in: 3600,
		});
	};
	assert.equal(await cloudflareGrantToken(env, "one", fetchImpl), "renewed-access");
	assert.equal(await cloudflareGrantToken(env, "one", fetchImpl), "renewed-access");
	assert.equal(calls, 1);
	assert.equal((await store.get("grant:one")).refreshToken, "rotated-refresh");
	assert.ok(
		!JSON.stringify(database.prepare("SELECT * FROM installer_sessions").all()).includes(
			"rotated-refresh",
		),
	);
});

test("concurrent refresh attempts cannot consume the same rotating authorization", async (t) => {
	const { env, database } = oauthFixture();
	t.after(() => database.close());
	await encryptedStore(env).put("grant:one", {
		token: "expired",
		refreshToken: "refresh",
		expiresAt: 0,
	});
	let finish;
	let started;
	const ready = new Promise((resolve) => {
		started = resolve;
	});
	const first = cloudflareGrantToken(env, "one", async () => {
		started();
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	await ready;
	await assert.rejects(
		cloudflareGrantToken(env, "one", () => {
			throw new Error("Duplicate refresh");
		}),
		/AUTHORIZATION_BUSY/u,
	);
	finish(
		Response.json({
			token_type: "bearer",
			access_token: "new",
			refresh_token: "new-refresh",
			expires_in: 3600,
		}),
	);
	await first;
});

test("OAuth binds consent to the browser, uses PKCE and never exposes the access token", async (t) => {
	const { env, database } = oauthFixture();
	t.after(() => database.close());
	const accessToken = "private-cloudflare-access-token";
	let exchangeCount = 0;
	let exchange;
	const oauth = installerOAuth(env, async (url, init) => {
		assert.equal(url, "https://dash.cloudflare.com/oauth2/token");
		exchangeCount += 1;
		exchange = new URLSearchParams(init.body);
		return Response.json({ access_token: accessToken, token_type: "bearer", expires_in: 3600 });
	});
	const start = await oauth.start(new Request(`${env.INSTALLER_ORIGIN}/oauth/start?lang=fr`));
	const authorization = new URL(start.headers.get("Location"));
	assert.equal(authorization.origin, "https://dash.cloudflare.com");
	assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
	const callbackUrl = `${env.INSTALLER_ORIGIN}/oauth/callback?code=fixture-code&state=${authorization.searchParams.get("state")}`;
	await assert.rejects(oauth.callback(new Request(callbackUrl)), /STATE_INVALID/u);
	assert.equal(exchangeCount, 0);
	const callback = new Request(callbackUrl, {
		headers: { Cookie: start.headers.get("Set-Cookie").split(";")[0] },
	});
	const completed = await oauth.callback(callback);
	assert.equal(completed.headers.get("Location"), `${env.INSTALLER_ORIGIN}/?lang=fr`);
	assert.equal(exchange.get("redirect_uri"), `${env.INSTALLER_ORIGIN}/oauth/callback`);
	const challenge = Buffer.from(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exchange.get("code_verifier"))),
	).toString("base64url");
	assert.equal(challenge, authorization.searchParams.get("code_challenge"));
	const cookies = completed.headers.getSetCookie();
	assert.ok(!JSON.stringify(cookies).includes(accessToken));
	assert.ok(
		!JSON.stringify(database.prepare("SELECT * FROM installer_sessions").all()).includes(
			accessToken,
		),
	);
	const session = cookies.find((value) => value.startsWith("__Host-superboard-session="));
	assert.match(session, /Secure; HttpOnly; SameSite=Lax/u);
	const request = new Request(`${env.INSTALLER_ORIGIN}/api/accounts`, {
		headers: { Cookie: session.split(";")[0] },
	});
	assert.equal(await oauth.token(request), accessToken);
	await assert.rejects(oauth.callback(callback), /SESSION_EXPIRED/u);
	assert.equal(exchangeCount, 1);
	await oauth.logout(request);
	await assert.rejects(oauth.token(request), /SESSION_EXPIRED/u);
});

test("expired OAuth attempts and denied consent cannot establish a session", async (t) => {
	const { env, database } = oauthFixture();
	t.after(() => database.close());
	const oauth = installerOAuth(env, () => {
		throw new Error("Token endpoint must not be called");
	});
	for (const expired of [false, true]) {
		const start = await oauth.start(new Request(`${env.INSTALLER_ORIGIN}/oauth/start`));
		const state = new URL(start.headers.get("Location")).searchParams.get("state");
		if (expired) database.exec("UPDATE installer_sessions SET expires = 0");
		await assert.rejects(
			oauth.callback(
				new Request(`${env.INSTALLER_ORIGIN}/oauth/callback?error=access_denied&state=${state}`, {
					headers: { Cookie: start.headers.get("Set-Cookie").split(";")[0] },
				}),
			),
			expired ? /SESSION_EXPIRED/u : /OAUTH_DENIED/u,
		);
	}
	assert.equal(database.prepare("SELECT COUNT(*) AS count FROM installer_sessions").get().count, 0);
});

test("a fresh installation fits Builds variable limits and retains its complete manifest", async () => {
	const api = cloudflareInstallerFixture();
	const result = await startInstallation(input, "test-token", async (url, init = {}) => {
		if (url.endsWith("/environment_variables") && init.method === "PATCH") {
			const variables = JSON.parse(init.body);
			assert.ok(Object.keys(variables).length <= 64);
			for (const [name, { value }] of Object.entries(variables))
				assert.ok(Buffer.byteLength(value) <= 5120, `Builds variable exceeds 5 KB: ${name}`);
		}
		return api.fetchImpl(url, init);
	});
	const env = Object.fromEntries(
		Object.entries(api.records.get(input.accountId).variables).map(([name, entry]) => [
			name,
			entry.value,
		]),
	);
	assert.deepEqual((await loadTarget(result.target, env)).target, installationTarget(input));
});

test("unpublished installation sources stop before any Cloudflare operation", async () => {
	const api = cloudflareInstallerFixture();
	await assert.rejects(
		startInstallation(input, "test-token", (url, init) =>
			url.startsWith("https://raw.githubusercontent.com/")
				? new Response(null, { status: 404 })
				: api.fetchImpl(url, init),
		),
		/INSTALLATION_SOURCE_NOT_PUBLISHED/u,
	);
	assert.equal(api.calls.length, 0);
});

test("source readiness is public and reports an unavailable release", async () => {
	const worker = createInstaller(() => new Response(null, { status: 404 }));
	const response = await worker.fetch(new Request("https://install.example.com/api/readiness"));
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { available: false });
});

test("both localized installer pages contain executable browser code", () => {
	for (const language of ["fr", "en"]) {
		const script = installerPage(language).match(/<script>([\s\S]+)<\/script>/u)[1];
		assert.doesNotThrow(() => new Script(script));
	}
});

test("fresh installations validate and cannot relabel an existing target", async () => {
	const target = installationTarget(input);
	await validateTarget(target);
	await assert.rejects(
		validateTarget({ ...target, target: "existing-instance" }),
		/FRESH_INSTALLATION_IDENTITY_INVALID/u,
	);
	assert.throws(
		() => installationTarget({ ...input, name: "../escape" }),
		/INSTALLATION_NAME_INVALID/u,
	);
	assert.throws(
		() => installationTarget({ ...input, domain: "https://example.com" }),
		/INSTALLATION_DOMAIN_INVALID/u,
	);
});

test("accepted instance names fit the Cloudflare R2 bucket limit", () => {
	let accepted = 0;
	for (let length = 2; length <= 31; length += 1) {
		let target;
		try {
			target = installationTarget({ ...input, name: "a".repeat(length) });
		} catch (error) {
			assert.match(error.message, /INSTALLATION_NAME_INVALID/u);
			continue;
		}
		accepted += 1;
		for (const resource of desiredCloudflareResources(target, "production").filter(
			({ kind }) => kind === "r2",
		))
			assert.ok(resource.name.length <= 63, resource.name);
	}
	assert.ok(accepted > 0);
});

test("installing in a second account creates independent builds and preserves the first account", async () => {
	const api = cloudflareInstallerFixture();
	const first = await startInstallation(input, "test-token", api.fetchImpl);
	const original = structuredClone(api.records.get(input.accountId));
	const second = await startInstallation(
		{ ...input, accountId: "b".repeat(32), name: "punks" },
		"test-token",
		api.fetchImpl,
	);
	assert.equal(first.status, "queued");
	assert.equal(second.status, "queued");
	assert.deepEqual(api.records.get(input.accountId), original);
	for (const state of api.records.values()) {
		assert.equal(state.builds[0].branch, "main");
		assert.deepEqual(state.triggers[0].branch_excludes, ["*"]);
		assert.equal(state.variables.SUPERBOARD_SETUP_API_TOKEN.is_secret, true);
		assert.equal(state.variables.SUPERBOARD_BACKUP_ENCRYPTION_KEY.is_secret, true);
	}
	assert.ok(!JSON.stringify(first).includes("test-token"));
});

test("retrying the same installation does not replace the Worker or launch a second build", async () => {
	const api = cloudflareInstallerFixture();
	await startInstallation(input, "test-token", api.fetchImpl);
	const result = await startInstallation(input, "test-token", api.fetchImpl);
	assert.equal(result.status, "registered");
	assert.equal(api.records.get(input.accountId).builds.length, 1);
	assert.equal(
		api.calls.filter(({ method, url }) => method === "PUT" && url.includes("/workers/scripts/"))
			.length,
		1,
	);
});

test("foreign origins cannot use installer credentials", async () => {
	const api = cloudflareInstallerFixture();
	const worker = createInstaller(api.fetchImpl);
	const response = await worker.fetch(
		new Request("https://install.example.com/api/install", {
			method: "POST",
			headers: {
				Origin: "https://foreign.example",
				Authorization: "Bearer " + "a".repeat(30),
				"X-SuperBoard-Request": "1",
			},
			body: JSON.stringify(input),
		}),
	);
	assert.equal(response.status, 403);
	assert.equal(api.calls.length, 0);
});

test("an API failure cannot report that installation succeeded or expose credentials", async () => {
	const worker = createInstaller(() =>
		Response.json({ success: false, errors: [{ message: "private-token" }] }, { status: 403 }),
	);
	const response = await worker.fetch(
		new Request("https://install.example.com/api/accounts", {
			method: "POST",
			headers: {
				Origin: "https://install.example.com",
				Authorization: "Bearer " + "a".repeat(30),
				"X-SuperBoard-Request": "1",
			},
			body: "{}",
		}),
	);
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: "CLOUDFLARE_API_403" });
});
