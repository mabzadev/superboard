import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { backupEncryptionKey, encryptBackupFile } from "../database/d1-backup-crypto.mjs";
import { createD1Backup, sha256File } from "../database/d1-backup.mjs";
import { targetD1Descriptors } from "../database/d1-registry.mjs";
import {
	initializeInstance,
	installationDeploymentEnvironment,
	finishInstanceInitialization,
} from "./initialize-instance.mjs";
import {
	installationRunRequest,
	validateInstallationRunContext,
} from "./installation-run-context.mjs";
import { targetForEnvironment } from "./target-environments.mjs";
import { cloudflareEnv, loadTarget, root } from "./target.mjs";
import { validateBuildContext } from "./workers-builds-config.mjs";

function run(command, args, env) {
	const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: false });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`CLOUDFLARE_BUILD_COMMAND_FAILED:${command}:${result.status}`);
}

export function validationEnvironment(env) {
	return Object.fromEntries(
		Object.entries(env).filter(
			([name]) =>
				!name.startsWith("SUPERBOARD_") &&
				!name.startsWith("CLOUDFLARE_") &&
				!name.startsWith("WRANGLER_"),
		),
	);
}

export async function buildInstance(env = process.env, execute = run) {
	const context = env.SUPERBOARD_INSTALLATION_RUN_ID
		? validateInstallationRunContext(env)
		: validateBuildContext(env);
	let { target } = await loadTarget(context.target, env);
	let deploymentEnv = cloudflareEnv(target, env);
	if (deploymentEnv.CLOUDFLARE_ACCOUNT_ID !== context.accountId)
		throw new Error("BUILD_ACCOUNT_MISMATCH");
	const manifest = `infra/generated/${context.target}-${context.environment}-deployments.json`;
	const receiptPath = resolve(root, `${manifest}.build.json`);
	await rm(receiptPath, { force: true });
	const testEnv = validationEnvironment(env);
	await execute("pnpm", ["--filter", "@emdash-cms/admin...", "build"], testEnv);
	await execute("pnpm", ["--dir", "sdks/web", "build"], testEnv);
	for (const script of [
		"build",
		// Astro generates the declarations required by typed lint during its type check.
		"typecheck",
		"lint",
		"lint:contracts",
		"cloudflare:test:services",
		"test:plugins:local",
		"cloudflare:builds:test",
	])
		await execute("pnpm", [script], testEnv);
	if (env.SUPERBOARD_INSTALLATION_RUN_ID) {
		const authorization = await installationRunRequest(env, "context");
		env.CLOUDFLARE_API_TOKEN = authorization.token;
		env.SUPERBOARD_SETUP_API_TOKEN = authorization.token;
		deploymentEnv = cloudflareEnv(target, env);
	}
	if (env.SUPERBOARD_INITIAL_INSTALL === "1") {
		target = await initializeInstance(env);
		deploymentEnv = cloudflareEnv(target, env);
	}
	await execute(
		"pnpm",
		["cloudflare:prepare", "--target", context.target, "--environment", context.environment],
		deploymentEnv,
	);
	await mkdir(resolve(root, "infra/generated"), { recursive: true });
	await writeFile(
		receiptPath,
		`${JSON.stringify({
			...context,
			targetChecksum: checksum(target),
			manifestChecksum: await sha256File(resolve(root, manifest)),
		})}\n`,
		{ mode: 0o600 },
	);
	if (env.SUPERBOARD_INITIAL_INSTALL === "1") {
		await writeFile(
			resolve(root, `${manifest}.installation.json`),
			JSON.stringify({ target, keys: env.SUPERBOARD_INSTALLATION_KEYS }),
			{ mode: 0o600 },
		);
	}
	return { ...context, manifest };
}

function checksum(value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function assertBuildReceipt(receipt, context, target, manifestChecksum) {
	for (const [key, value] of Object.entries(context))
		if (receipt[key] !== value) throw new Error(`BUILD_RECEIPT_MISMATCH:${key}`);
	if (receipt.targetChecksum !== checksum(target) || receipt.manifestChecksum !== manifestChecksum)
		throw new Error("BUILD_RECEIPT_ARTIFACT_MISMATCH");
}

export async function retainProductionBackups({
	target,
	context,
	directory,
	env,
	execute = run,
	backup = createD1Backup,
}) {
	const bucket = env.SUPERBOARD_BACKUP_R2_BUCKET;
	if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(bucket ?? ""))
		throw new Error("BUILD_BACKUP_BUCKET_REQUIRED");
	const key = backupEncryptionKey(env.SUPERBOARD_BACKUP_ENCRYPTION_KEY);
	const descriptors = targetD1Descriptors(target, context.target, context.environment, "all");
	for (const descriptor of descriptors) {
		const result = await backup({ descriptor, outputDirectory: directory, env });
		const encrypted = await encryptBackupFile(result.paths.sql, key);
		const object = `${bucket}/superboard/${context.target}/${context.revision}/${descriptor.service}/${Date.now()}.sql.enc`;
		await execute(
			"pnpm",
			["exec", "wrangler", "r2", "object", "put", object, "--file", encrypted, "--remote"],
			env,
		);
		const downloaded = `${encrypted}.verified`;
		await execute(
			"pnpm",
			["exec", "wrangler", "r2", "object", "get", object, "--file", downloaded, "--remote"],
			env,
		);
		if ((await sha256File(downloaded)) !== (await sha256File(encrypted)))
			throw new Error("BUILD_BACKUP_VERIFICATION_FAILED");
		await rm(downloaded);
	}
}

export async function deployInstance(env = process.env, execute = run) {
	const context = env.SUPERBOARD_INSTALLATION_RUN_ID
		? validateInstallationRunContext(env)
		: validateBuildContext(env);
	const manifest = `infra/generated/${context.target}-${context.environment}-deployments.json`;
	if (env.SUPERBOARD_INITIAL_INSTALL === "1") {
		const initial = JSON.parse(
			await readFile(resolve(root, `${manifest}.installation.json`), "utf8"),
		);
		env = {
			...env,
			SUPERBOARD_TARGET_MANIFEST: JSON.stringify(initial.target),
			SUPERBOARD_INSTALLATION_KEYS: initial.keys,
		};
	}
	const { target } = await loadTarget(context.target, env);
	const deploymentEnv = await installationDeploymentEnvironment(
		cloudflareEnv(target, env),
		manifest,
	);
	if (deploymentEnv.CLOUDFLARE_ACCOUNT_ID !== context.accountId)
		throw new Error("BUILD_ACCOUNT_MISMATCH");
	const receipt = JSON.parse(await readFile(resolve(root, `${manifest}.build.json`), "utf8"));
	assertBuildReceipt(receipt, context, target, await sha256File(resolve(root, manifest)));
	const directory = await mkdtemp(join(tmpdir(), "superboard-build-backup-"));
	try {
		if (context.environment === "production")
			await retainProductionBackups({ target, context, directory, env: deploymentEnv, execute });
		await execute(
			process.execPath,
			[
				"scripts/cloudflare/deploy-all.mjs",
				"--target",
				context.target,
				"--environment",
				context.environment,
				"--prepared-deployment",
				manifest,
				"--backup-directory",
				directory,
				...(env.SUPERBOARD_INITIAL_INSTALL === "1" ? ["--initial-install"] : []),
			],
			{ ...deploymentEnv, DEPLOY_SHA: context.revision },
		);
		const configured = targetForEnvironment(target, context.environment);
		for (const lang of ["fr", "en"]) {
			const response = await fetch(`https://${configured.domains.site}/?lang=${lang}`, {
				signal: AbortSignal.timeout(30_000),
			});
			await response.body?.cancel();
			if (!response.ok) throw new Error(`BUILD_CONSOLE_HTTP_FAILED:${lang}:${response.status}`);
		}
		if (env.SUPERBOARD_SETUP_API_TOKEN && target.freshInstallation)
			await finishInstanceInitialization(env);
	} finally {
		await rm(directory, { recursive: true, force: true });
		await rm(resolve(root, `${manifest}.installation.json`), { force: true });
	}
	return { ...context, status: "deployed" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const operation = process.argv[2];
	if (!new Set(["build", "deploy"]).has(operation)) throw new Error("Expected build or deploy");
	console.log(
		JSON.stringify(await (operation === "build" ? buildInstance() : deployInstance()), null, 2),
	);
}
