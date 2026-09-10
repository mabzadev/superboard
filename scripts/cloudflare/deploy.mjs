import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { migrationConfirmation } from "../database/d1-converge.mjs";
import { D1_SCHEMA_OWNERS, d1Descriptor, localMigrationFiles } from "../database/d1-registry.mjs";
import {
	enforceIdentityProjectCutover,
	resolveDeploymentRevision,
} from "../database/identity-cutover.mjs";
import { readMigrationBatchReceipt } from "../database/migration-batch.mjs";
import { verifyConsoleArtifact } from "./console-artifact.mjs";
import { runtimeBridgeDeploymentBlockers } from "./deploy-plan.mjs";
import { assertPublicRoutingReady } from "./public-routing-gate.mjs";
import { assertServiceForTarget } from "./services.mjs";
import { resolveSitePreviewRoute, resolveSiteReleaseOperations } from "./site-preview.mjs";
import { compiledTargetFromArgs } from "./target-compiler.mjs";
import {
	cloudflareEnv,
	environmentFromArgs,
	loadTarget,
	parseArgs,
	root,
	targetNameFromArgs,
} from "./target.mjs";

const args = parseArgs();
const targetName = targetNameFromArgs(args);
const environment = environmentFromArgs(args);
const service = args.service ?? "api";
const uploadOnly = Boolean(args["upload-only"] || args.preflight);
if (service === "site" && !args["prepared-deployment"]) {
	throw new Error(
		"PREPARED_DEPLOYMENT_REQUIRED: prepare and validate the console before deployment",
	);
}
const preparedManifest =
	service === "site"
		? JSON.parse(await readFile(resolve(args["prepared-deployment"]), "utf8"))
		: null;
const consoleArtifact = preparedManifest?.consoleArtifact;
if (preparedManifest) {
	if (preparedManifest.target !== targetName || preparedManifest.environment !== environment) {
		throw new Error("PREPARED_DEPLOYMENT_TARGET_MISMATCH");
	}
	if (!consoleArtifact) throw new Error("PREPARED_CONSOLE_ARTIFACT_REQUIRED");
	const consoleGroup = preparedManifest.groups?.find((group) => group.id === "console");
	if (!consoleGroup || resolve(root, consoleGroup.configPath) !== consoleArtifact.configPath) {
		throw new Error("PREPARED_CONSOLE_CONFIG_MISMATCH");
	}
	await verifyConsoleArtifact(consoleArtifact);
}

const { target } = await loadTarget(targetName);
await compiledTargetFromArgs(target, environment, args);
const sitePreviewRoute = resolveSitePreviewRoute({
	requested: Boolean(args["site-preview-route"]),
	service,
	environment,
	hostname: target.domains.site,
	noRoutes: Boolean(args["no-routes"]),
	preflight: Boolean(args.preflight),
});
const siteReleaseOperations = resolveSiteReleaseOperations({
	requested: Boolean(args["release-operations"]),
	service,
	environment,
	sitePreviewRoute,
	publicRoutesEnabled:
		assertPublicRoutingReady(target, environment).routesEnabled &&
		!args["no-routes"] &&
		!args.preflight,
	readOnly: Boolean(args["read-only-console"]),
});
assertServiceForTarget(target, service);
const blockers = runtimeBridgeDeploymentBlockers({
	target,
	environment,
	services: [service],
	uploadOnly,
});
if (blockers.length > 0) {
	throw new Error(
		`Refusing active deployment: ${blockers
			.map(({ id, action }) => `${id}: ${action}`)
			.join(" | ")}`,
	);
}
const targetCloudflareEnv = cloudflareEnv(target);
const schemaOwner = D1_SCHEMA_OWNERS.includes(service)
	? d1Descriptor(target, targetName, environment, service)
	: null;
const backupDirectory = args["backup-directory"] ?? process.env.SUPERBOARD_BACKUP_DIRECTORY;
if (args["skip-backup"]) {
	throw new Error("--skip-backup has been removed: production D1 backups are mandatory");
}
if (schemaOwner && environment === "production" && args["skip-migrations"]) {
	throw new Error("Production deploys of D1 schema owners cannot use --skip-migrations");
}
let migrationsConvergedByBatch = false;
if (Boolean(args["identity-cutover-receipt"]) !== Boolean(args["identity-cutover-sha256"])) {
	throw new Error("--identity-cutover-receipt and --identity-cutover-sha256 are required together");
}
if (Boolean(args["migration-batch-receipt"]) !== Boolean(args["migration-batch-sha256"])) {
	throw new Error("--migration-batch-receipt and --migration-batch-sha256 are required together");
}

let suppliedIdentityCutover = null;
if (args["identity-cutover-receipt"]) {
	if (service !== "identity" || uploadOnly) {
		throw new Error("--identity-cutover-receipt is valid only for an active Identity deployment");
	}
	suppliedIdentityCutover = {
		path: args["identity-cutover-receipt"],
		sha256: args["identity-cutover-sha256"],
	};
}
if (args["migration-batch-receipt"] && args["migration-batch-sha256"]) {
	if (environment !== "production" || !schemaOwner || uploadOnly) {
		throw new Error(
			"--migration-batch-receipt is valid only for an active production D1 schema owner deployment",
		);
	}
	await readMigrationBatchReceipt(args["migration-batch-receipt"], {
		targetName,
		environment,
		service,
		sha256: args["migration-batch-sha256"],
	});
	migrationsConvergedByBatch = true;
}
const configPath = resolve(
	root,
	"infra",
	"generated",
	`${targetName}-${service}-${environment}.jsonc`,
);
generateServiceConfig();

if (service === "identity") {
	run(
		"npm",
		["run", "build:client"],
		targetCloudflareEnv,
		resolve(root, "packages/plugins/supbrd-plug-identity/worker"),
	);
}

if (schemaOwner && !uploadOnly && !args["skip-migrations"] && !migrationsConvergedByBatch) {
	run(
		process.execPath,
		[
			resolve(root, "scripts/database/d1-converge.mjs"),
			"apply",
			"--target",
			targetName,
			"--environment",
			environment,
			"--service",
			service,
			"--apply",
			"--confirm",
			migrationConfirmation(targetName, environment, service),
			...(backupDirectory ? ["--backup-directory", backupDirectory] : []),
		],
		targetCloudflareEnv,
	);
	if (service === "api" && target.registrationMode === "allowlist") {
		run(
			"node",
			[
				resolve(root, "scripts/cloudflare/allowlist.mjs"),
				"bootstrap",
				"--target",
				targetName,
				"--environment",
				environment,
				...(args["no-routes"] ? ["--no-routes"] : []),
			],
			targetCloudflareEnv,
		);
	}
}

if (service === "identity" && !uploadOnly) {
	const migration = (await localMigrationFiles(schemaOwner)).at(-1);
	const revision = resolveDeploymentRevision(targetCloudflareEnv);
	const expected = {
		targetName,
		environment,
		accountId: targetCloudflareEnv.CLOUDFLARE_ACCOUNT_ID,
		databaseName: schemaOwner.databaseName,
		databaseId: schemaOwner.databaseId,
		migration,
		revision,
	};
	await enforceIdentityProjectCutover({
		suppliedReceipt: suppliedIdentityCutover,
		expected,
		verification: {
			target,
			targetName,
			environment,
			accountId: targetCloudflareEnv.CLOUDFLARE_ACCOUNT_ID,
			revision,
			receiptDirectory: args["identity-cutover-directory"] ?? backupDirectory,
			env: targetCloudflareEnv,
		},
	});
}

// D1 convergence and other read-only verification helpers intentionally
// generate a route-free Wrangler configuration at the canonical generated
// path. Recreate the requested deployment configuration after those helpers
// so an active deploy can never detach a public route or queue consumer.
generateServiceConfig();

if (service === "site") {
	await verifyConsoleArtifact(consoleArtifact);
	run(
		"npx",
		[
			"wrangler",
			...(uploadOnly ? ["versions", "upload"] : ["deploy"]),
			"--config",
			consoleArtifact.configPath,
		],
		targetCloudflareEnv,
	);
} else {
	run(
		"npx",
		["wrangler", ...(uploadOnly ? ["versions", "upload"] : ["deploy"]), "--config", configPath],
		targetCloudflareEnv,
	);
}

function generateServiceConfig() {
	if (service === "site") return;
	run(
		"node",
		[
			resolve(root, "scripts/cloudflare/config.mjs"),
			"--target",
			targetName,
			"--service",
			service,
			"--environment",
			environment,
			...(args["target-artifact"] && args["target-artifact-checksum"]
				? [
						"--target-artifact",
						args["target-artifact"],
						"--target-artifact-checksum",
						args["target-artifact-checksum"],
					]
				: []),
			...(args["no-routes"] ? ["--no-routes"] : []),
			...(sitePreviewRoute?.cliArgs ?? []),
			...siteReleaseOperations.cliArgs,
			...(args["read-only-console"] ? ["--read-only-console"] : []),
			...(args.preflight ? ["--preflight"] : []),
		],
		targetCloudflareEnv,
	);
}

function run(command, commandArgs, env = process.env, cwd = root) {
	const result = spawnSync(command, commandArgs, {
		cwd,
		env,
		stdio: "inherit",
		shell: false,
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}
