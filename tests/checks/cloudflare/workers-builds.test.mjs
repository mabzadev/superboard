import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	encodeBuildVariables,
	readBuildVariable,
} from "../../../scripts/cloudflare/build-variables.mjs";
import { installInstanceUpdates } from "../../../scripts/cloudflare/install-updates.mjs";
import { loadTarget } from "../../../scripts/cloudflare/target.mjs";
import {
	instanceBuildConfiguration,
	validateBuildContext,
} from "../../../scripts/cloudflare/workers-builds-config.mjs";
import {
	buildInstance,
	validationEnvironment,
	assertBuildReceipt,
	retainProductionBackups,
} from "../../../scripts/cloudflare/workers-builds.mjs";
import { validateDeploymentConfiguration } from "../../../scripts/github/deployment-matrix.mjs";

const target = JSON.parse(
	await readFile(new URL("../../../infra/targets/mbza-development.json", import.meta.url), "utf8"),
);
const uuid = "12345678-1234-1234-1234-123456789012";

test("large build secrets round-trip Unicode and reject missing or mixed chunks", async () => {
	const value = JSON.stringify({ secret: "clé🔑".repeat(2000) });
	const variables = await encodeBuildVariables({
		SUPERBOARD_INSTALLATION_KEYS: { value, is_secret: true },
	});
	for (const entry of Object.values(variables)) {
		assert.ok(Buffer.byteLength(entry.value) <= 5120);
		assert.equal(entry.is_secret, true);
	}
	const env = Object.fromEntries(
		Object.entries(variables).map(([name, entry]) => [name, entry.value]),
	);
	assert.equal(await readBuildVariable(env, "SUPERBOARD_INSTALLATION_KEYS"), value);
	await assert.rejects(
		readBuildVariable(
			{ ...env, SUPERBOARD_INSTALLATION_KEYS__PART_0: undefined },
			"SUPERBOARD_INSTALLATION_KEYS",
		),
		/BUILD_VARIABLE_INCOMPLETE/u,
	);
	await assert.rejects(
		readBuildVariable(
			{ ...env, SUPERBOARD_INSTALLATION_KEYS__PART_0: "YQ==" },
			"SUPERBOARD_INSTALLATION_KEYS",
		),
	);
	assert.equal(
		await readBuildVariable(
			{ SUPERBOARD_INSTALLATION_KEYS: value },
			"SUPERBOARD_INSTALLATION_KEYS",
		),
		value,
	);
});

function installation(accountId = "a".repeat(32)) {
	return {
		schemaVersion: 1,
		accountId,
		environment: "development",
		automaticUpdates: true,
		repoConnectionUuid: uuid,
		buildTokenUuid: uuid,
		target,
	};
}

function cloudflare() {
	const accounts = new Map();
	return {
		accounts,
		async fetchImpl(url, init = {}) {
			const [, account, path] = new URL(url).pathname.match(/\/accounts\/([^/]+)(.*)/u);
			if (!accounts.has(account)) accounts.set(account, { triggers: [], variables: {} });
			const state = accounts.get(account);
			const body = init.body ? JSON.parse(init.body) : null;
			let result;
			if (path === "/workers/scripts")
				result = [{ id: target.workers.site.development, tag: "b".repeat(32) }];
			else if (path.endsWith("/triggers") && !body) result = state.triggers;
			else if (path === "/builds/triggers" && init.method === "POST") {
				result = { ...body, trigger_uuid: uuid };
				state.triggers.push(result);
			} else if (path.endsWith("/environment_variables") && body) {
				Object.assign(state.variables, body);
				result = state.variables;
			} else if (path === `/builds/triggers/${uuid}` && init.method === "PATCH") {
				Object.assign(state.triggers[0], body);
				result = state.triggers[0];
			} else throw new Error(`Unexpected API call: ${init.method} ${path}`);
			return Response.json({ success: true, result });
		},
	};
}

test("Cloudflare production can be registered without a GitHub deployment environment", () => {
	const config = instanceBuildConfiguration();
	assert.equal(
		validateDeploymentConfiguration({
			schemaVersion: 4,
			deployments: [
				{
					id: "new-customer",
					target: "new-customer",
					branch: "main",
					githubEnvironment: "production",
					cloudflareEnvironment: "production",
					automaticDeployment: config,
					referenceAcceptance: false,
				},
			],
		}),
		true,
	);
});

test("the build refuses another branch, missing Cloudflare context and invalid revisions", () => {
	const env = {
		WORKERS_CI: "1",
		WORKERS_CI_BRANCH: "dev",
		WORKERS_CI_COMMIT_SHA: "a".repeat(40),
		CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
		SUPERBOARD_TARGET: "mbza-development",
		SUPERBOARD_ENVIRONMENT: "development",
	};
	assert.equal(validateBuildContext(env).branch, "dev");
	assert.throws(
		() => validateBuildContext({ ...env, SUPERBOARD_ENVIRONMENT: "production" }),
		/BRANCH/u,
	);
	assert.throws(() => validateBuildContext({ ...env, WORKERS_CI: "" }), /WORKERS_BUILDS/u);
	assert.throws(
		() => validateBuildContext({ ...env, WORKERS_CI_COMMIT_SHA: "latest" }),
		/REVISION/u,
	);
});

test("new accounts have isolated triggers and reinstalling does not duplicate them", async () => {
	const api = cloudflare();
	const options = { token: "test-token", fetchImpl: api.fetchImpl };
	await installInstanceUpdates(installation(), options);
	await installInstanceUpdates(installation("c".repeat(32)), options);
	await installInstanceUpdates(installation(), options);
	assert.equal(api.accounts.size, 2);
	for (const [account, state] of api.accounts) {
		assert.equal(state.triggers.length, 1);
		assert.deepEqual(state.triggers[0].branch_includes, ["dev"]);
		assert.deepEqual(state.triggers[0].branch_excludes, []);
		assert.equal(state.variables.CLOUDFLARE_ACCOUNT_ID.value, account);
		const env = Object.fromEntries(
			Object.entries(state.variables).map(([name, entry]) => [name, entry.value]),
		);
		assert.deepEqual((await loadTarget(target.target, env)).target, target);
	}
});

test("disabling automatic updates excludes pushes without deleting the connection", async () => {
	const api = cloudflare();
	await installInstanceUpdates(
		{ ...installation(), automaticUpdates: false },
		{ token: "test-token", fetchImpl: api.fetchImpl },
	);
	assert.deepEqual(api.accounts.values().next().value.triggers[0].branch_excludes, ["*"]);
});

test("a failed configuration never enables the trigger and never discloses API errors", async () => {
	const api = cloudflare();
	await assert.rejects(
		installInstanceUpdates(installation(), {
			token: "test-token",
			fetchImpl: (url, init) =>
				url.endsWith("/environment_variables")
					? Response.json({ success: false, errors: [{ message: "test-token" }] }, { status: 403 })
					: api.fetchImpl(url, init),
		}),
		/CLOUDFLARE_BUILDS_API:403/u,
	);
	assert.deepEqual(api.accounts.values().next().value.triggers[0].branch_excludes, ["*"]);
});

test("private installation manifests can add an account without editing the central repository", async () => {
	const privateTarget = { ...target, target: "another-customer", accountAlias: "another-customer" };
	const env = { SUPERBOARD_TARGET_MANIFEST: JSON.stringify(privateTarget) };
	assert.deepEqual((await loadTarget("another-customer", env)).target, privateTarget);
	await assert.rejects(loadTarget("mbza-development", env), /BUILD_TARGET_MANIFEST_MISMATCH/u);
});

test("failed validation stops before preparation or deployment", async () => {
	const env = {
		WORKERS_CI: "1",
		WORKERS_CI_BRANCH: "dev",
		WORKERS_CI_COMMIT_SHA: "a".repeat(40),
		CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
		SUPERBOARD_TARGET: "build-failure-test",
		SUPERBOARD_ENVIRONMENT: "development",
		SUPERBOARD_TARGET_MANIFEST: JSON.stringify({ ...target, target: "build-failure-test" }),
	};
	let calls = 0;
	await assert.rejects(
		buildInstance(env, () => {
			calls += 1;
			throw new Error("failing-check");
		}),
		/failing-check/u,
	);
	assert.equal(calls, 1);
	assert.equal(validationEnvironment(env).SUPERBOARD_TARGET_MANIFEST, undefined);
	assert.equal(validationEnvironment(env).CLOUDFLARE_ACCOUNT_ID, undefined);
});

test("fresh build validation prepares framework declarations before linting", async () => {
	const env = {
		WORKERS_CI: "1",
		WORKERS_CI_BRANCH: "dev",
		WORKERS_CI_COMMIT_SHA: "a".repeat(40),
		CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
		SUPERBOARD_TARGET: "cold-build-test",
		SUPERBOARD_ENVIRONMENT: "development",
		SUPERBOARD_TARGET_MANIFEST: JSON.stringify({ ...target, target: "cold-build-test" }),
	};
	let declarationsReady = false;
	await assert.rejects(
		buildInstance(env, (_command, args) => {
			if (args[0] === "typecheck") declarationsReady = true;
			if (args[0] === "lint") {
				if (!declarationsReady) throw new Error("FRAMEWORK_DECLARATIONS_MISSING");
				throw new Error("FRESH_VALIDATION_REACHED");
			}
		}),
		/FRESH_VALIDATION_REACHED/u,
	);
});

test("a prepared build cannot be deployed into a different account or revision", () => {
	const context = { accountId: "a".repeat(32), revision: "b".repeat(40) };
	assert.throws(
		() =>
			assertBuildReceipt({ ...context, accountId: "c".repeat(32) }, context, target, "checksum"),
		/BUILD_RECEIPT_MISMATCH:accountId/u,
	);
	assert.throws(
		() => assertBuildReceipt({ ...context, revision: "d".repeat(40) }, context, target, "checksum"),
		/BUILD_RECEIPT_MISMATCH:revision/u,
	);
	assert.throws(
		() => assertBuildReceipt(context, context, target, "checksum"),
		/BUILD_RECEIPT_ARTIFACT_MISMATCH/u,
	);
});

test("production backup retention rejects corrupted remote objects before deployment", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-build-backup-test-"));
	try {
		const objects = new Map();
		const env = {
			SUPERBOARD_BACKUP_R2_BUCKET: "fixture-backups",
			SUPERBOARD_BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
		};
		const input = {
			target,
			context: { target: target.target, environment: "development", revision: "a".repeat(40) },
			directory,
			env,
			backup: async ({ descriptor }) => {
				const sql = join(directory, `${descriptor.service}.sql`);
				await writeFile(sql, "CREATE TABLE fixture(value TEXT);\n");
				return { paths: { sql } };
			},
		};
		await assert.rejects(
			retainProductionBackups({
				...input,
				execute: async (_command, args) => {
					const file = args[args.indexOf("--file") + 1];
					if (args.includes("put")) objects.set(args[5], await readFile(file));
					else await writeFile(file, "corrupted-download");
				},
			}),
			/BUILD_BACKUP_VERIFICATION_FAILED/u,
		);
		assert.equal(objects.size, 1);
		assert.ok(![...objects.values()][0].includes(Buffer.from("CREATE TABLE")));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
