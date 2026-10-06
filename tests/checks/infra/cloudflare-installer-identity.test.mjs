import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { encryptedStore } from "../../../infra/cloudflare-installer/encrypted-store.mjs";
import { installationRegistry } from "../../../infra/cloudflare-installer/installations.mjs";
import { runnerIdentity } from "../../../infra/cloudflare-installer/runner-identity.mjs";
import { encodeBuildVariables } from "../../../scripts/cloudflare/build-variables.mjs";
import { installationRunRequest } from "../../../scripts/cloudflare/installation-run-context.mjs";
import { cloudflareInstallerFixture } from "../../fixtures/cloudflare/installer.mjs";
import { oauthFixture } from "../../fixtures/cloudflare/oauth.mjs";

const accountA = "a".repeat(32);
const accountB = "b".repeat(32);
const owner = "f".repeat(32);
const id = "12345678-1234-1234-1234-123456789012";
const revision = "1".repeat(40);
const input = {
	installationId: id,
	accountId: accountA,
	name: "example",
	domain: "example.com",
	email: "admin@example.com",
	automaticUpdates: true,
};
const authorization = {
	id: "authorization-one",
	token: "first-access",
	refreshToken: "first-refresh",
	expiresAt: Date.now() + 3_600_000,
};

test("development adoption preserves the configured resources and cannot cross accounts", async (t) => {
	const { env, database } = oauthFixture();
	t.after(() => database.close());
	const target = JSON.parse(
		await readFile(
			new URL("../../../infra/targets/mbza-development.json", import.meta.url),
			"utf8",
		),
	);
	env.INSTALLER_DEVELOPMENT_TARGET = JSON.stringify({ id, accountId: accountA, target });
	Object.assign(
		env,
		Object.fromEntries(
			Object.entries(
				await encodeBuildVariables({
					INSTALLER_DEVELOPMENT_TARGET: { value: env.INSTALLER_DEVELOPMENT_TARGET },
				}),
			).map(([name, entry]) => [name, entry.value]),
		),
	);
	const api = cloudflareInstallerFixture();
	api.records
		.get(accountA)
		.workers.set(target.workers.site.development, { id: target.workers.site.development });
	const registry = installationRegistry(env, (url, init) =>
		url.includes("/commits/") ? Response.json({ sha: revision }) : api.fetchImpl(url, init),
	);
	await assert.rejects(
		registry.adoptDevelopment({ accountId: accountB }, authorization, owner),
		/DEVELOPMENT_UNAVAILABLE/u,
	);
	await registry.adoptDevelopment({ accountId: accountA }, authorization, owner);
	await registry.adoptDevelopment({ accountId: accountA }, authorization, owner);
	assert.equal((await registry.list(owner)).length, 1);
	assert.deepEqual(await registry.jobs({ ref: "refs/heads/main" }), []);
	await assert.rejects(
		registry.claim(id, revision, { ref: "refs/heads/main", runId: "122" }),
		/ALREADY_RUNNING/u,
	);
	const claim = await registry.claim(id, revision, { ref: "refs/heads/dev", runId: "123" });
	const context = await registry.context(
		new Request("https://install.example.com/runner", {
			headers: { Authorization: `Bearer ${claim.lease}` },
		}),
		claim.runId,
	);
	assert.deepEqual(context.target, target);
	assert.equal(context.initial, false);
	assert.equal(context.environment, "development");
	assert.equal(
		api.calls.some(({ method }) => method !== "GET"),
		false,
	);
});

test("runner identities require a GitHub signature and the canonical workflow and branch", async () => {
	const pair = await crypto.subtle.generateKey(
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
		...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
		kid: "fixture-key",
		use: "sig",
	};
	const base = {
		iss: "https://token.actions.githubusercontent.com",
		aud: "superboard-installer",
		repository: "mabzadev/superboard",
		ref: "refs/heads/main",
		workflow_ref:
			"mabzadev/superboard/.github/workflows/cloudflare-installations.yml@refs/heads/main",
		sub: "repo:mabzadev/superboard:ref:refs/heads/main",
		runner_environment: "github-hosted",
		event_name: "push",
		exp: Date.now() / 1000 + 600,
		iat: Date.now() / 1000,
		run_id: "123",
		sha: revision,
	};
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	async function request(claims) {
		const unsigned = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode(claims)}`;
		const signature = await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			pair.privateKey,
			new TextEncoder().encode(unsigned),
		);
		return new Request("https://install.example.com/runner/jobs", {
			headers: {
				Authorization: `Bearer ${unsigned}.${Buffer.from(signature).toString("base64url")}`,
			},
		});
	}
	const fetchKeys = async (url) => {
		assert.equal(url, "https://token.actions.githubusercontent.com/.well-known/jwks");
		return Response.json({ keys: [jwk] });
	};
	assert.equal((await runnerIdentity(await request(base), fetchKeys)).ref, "refs/heads/main");
	for (const change of [
		{ repository: "another/repository" },
		{ ref: "refs/pull/12/merge" },
		{ workflow_ref: "mabzadev/superboard/.github/workflows/other.yml@refs/heads/main" },
		{ aud: "another-app" },
		{ exp: 0 },
	])
		await assert.rejects(
			runnerIdentity(await request({ ...base, ...change }), fetchKeys),
			/RUNNER_UNAUTHORIZED/u,
		);
	const valid = await request(base);
	const parts = valid.headers.get("Authorization").slice(7).split(".");
	parts[1] = encode({ ...base, run_id: "999" });
	await assert.rejects(
		runnerIdentity(
			new Request(valid.url, { headers: { Authorization: `Bearer ${parts.join(".")}` } }),
			fetchKeys,
		),
		/RUNNER_UNAUTHORIZED/u,
	);
});

test("concurrent registrations cannot bind an account to another account's manifest", async (t) => {
	const { env, database } = oauthFixture();
	t.after(() => database.close());
	const api = cloudflareInstallerFixture();
	const registry = installationRegistry(env, (url, init) =>
		url.includes("/commits/") ? Response.json({ sha: revision }) : api.fetchImpl(url, init),
	);
	const original = env.INSTALLER_DB.prepare.bind(env.INSTALLER_DB);
	let entered;
	let release;
	const waiting = new Promise((resolve) => {
		entered = resolve;
	});
	const barrier = new Promise((resolve) => {
		release = resolve;
	});
	env.INSTALLER_DB.prepare = (sql) => {
		const statement = original(sql);
		if (!sql.startsWith("INSERT INTO installer_installations")) return statement;
		return {
			bind(...args) {
				const bound = statement.bind(...args);
				return {
					...bound,
					async run() {
						if (args[2] === accountA) {
							entered();
							await barrier;
						}
						return bound.run();
					},
				};
			},
		};
	};
	const first = registry.register(input, authorization, owner);
	await waiting;
	try {
		await assert.rejects(
			registry.register({ ...input, accountId: accountB }, authorization, owner),
			/ID_CONFLICT/u,
		);
	} finally {
		release();
	}
	await first;
	assert.equal(
		database.prepare("SELECT account_id FROM installer_installations WHERE id=?").get(id)
			.account_id,
		accountA,
	);
	assert.equal((await encryptedStore(env).get(`instance:${id}`)).accountId, accountA);
});

test("development cannot claim a production run and renewed consent repairs a failed installation", async (t) => {
	const { env, database } = oauthFixture();
	t.after(() => database.close());
	const api = cloudflareInstallerFixture();
	const registry = installationRegistry(env, (url, init) =>
		url.includes("/commits/")
			? Response.json({ sha: revision })
			: url.includes("/actions/runs/")
				? Response.json({ jobs: [{ name: `Install ${id}`, status: "completed" }] })
				: api.fetchImpl(url, init),
	);
	await registry.register(input, authorization, owner);
	assert.deepEqual(await registry.jobs({ ref: "refs/heads/dev" }), []);
	await assert.rejects(
		registry.claim(id, revision, { ref: "refs/heads/dev", runId: "123" }),
		/ALREADY_RUNNING/u,
	);
	const first = await registry.claim(id, revision, { ref: "refs/heads/main", runId: "123" });
	const request = (lease) =>
		new Request("https://install.example.com/runner", {
			headers: { Authorization: `Bearer ${lease}` },
		});
	await registry.complete(request(first.lease), first.runId, {
		status: "failed",
		errorCode: "INSTALLATION_AUTHORIZATION_EXPIRED",
	});
	await registry.configure(
		id,
		owner,
		{ automaticUpdates: true, retry: true },
		{ ...authorization, id: "new-consent", token: "renewed-access" },
	);
	const next = await registry.claim(id, revision, { ref: "refs/heads/main", runId: "124" });
	assert.equal((await registry.context(request(next.lease), next.runId)).token, "renewed-access");
});

test("runner waits for a concurrent authorization refresh instead of failing the deployment", async () => {
	const env = {
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: "mabzadev/superboard",
		SUPERBOARD_INSTALLATION_RUN_ID: id,
		SUPERBOARD_SOURCE_BRANCH: "main",
		SUPERBOARD_ENVIRONMENT: "production",
		SUPERBOARD_SOURCE_REVISION: revision,
		CLOUDFLARE_ACCOUNT_ID: accountA,
		SUPERBOARD_TARGET: "example",
		SUPERBOARD_INSTALLER_ORIGIN: "https://install.example.com",
		SUPERBOARD_INSTALLATION_RUN_LEASE: "a".repeat(43),
	};
	let attempts = 0;
	const result = await installationRunRequest(env, "context", {}, async () =>
		++attempts === 1
			? Response.json({ error: "INSTALLATION_AUTHORIZATION_BUSY" }, { status: 503 })
			: Response.json({ result: { ready: true } }),
	);
	assert.deepEqual(result, { ready: true });
	assert.equal(attempts, 2);
});

test("pausing a pending update cancels it and a manual update selects the current release", async (t) => {
	const { env, database } = oauthFixture();
	t.after(() => database.close());
	const api = cloudflareInstallerFixture();
	let current = revision;
	const registry = installationRegistry(env, (url, init) =>
		url.includes("/commits/")
			? Response.json({ sha: current })
			: url.includes("/actions/runs/")
				? Response.json({ jobs: [{ name: `Install ${id}`, status: "completed" }] })
				: api.fetchImpl(url, init),
	);
	await registry.register(input, authorization, owner);
	const claimed = await registry.claim(id, revision, { ref: "refs/heads/main", runId: "123" });
	const request = new Request("https://install.example.com/runner", {
		headers: { Authorization: `Bearer ${claimed.lease}` },
	});
	await registry.persist(request, claimed.runId, { SUPERBOARD_INITIAL_INSTALL: { value: "0" } });
	await registry.complete(request, claimed.runId, { status: "deployed" });
	current = "2".repeat(40);
	assert.equal((await registry.jobs({ ref: "refs/heads/main" })).length, 1);
	const prepare = env.INSTALLER_DB.prepare.bind(env.INSTALLER_DB);
	env.INSTALLER_DB.prepare = (sql) => {
		const statement = prepare(sql);
		if (!sql.startsWith("UPDATE installer_installations SET automatic_updates=")) return statement;
		return {
			bind(...args) {
				const bound = statement.bind(...args);
				return {
					...bound,
					async run() {
						await registry.jobs({ ref: "refs/heads/main" });
						return bound.run();
					},
				};
			},
		};
	};
	await registry.configure(id, owner, { automaticUpdates: false });
	env.INSTALLER_DB.prepare = prepare;
	assert.deepEqual(await registry.jobs({ ref: "refs/heads/main" }), []);
	current = "3".repeat(40);
	await registry.configure(id, owner, { automaticUpdates: false, update: true }, authorization);
	assert.deepEqual(
		(await registry.jobs({ ref: "refs/heads/main" })).map((row) => ({ ...row })),
		[{ id, revision: current }],
	);
});
