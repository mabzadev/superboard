import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  publicApiUrl,
  publicAuthUrl,
  publicDashboardUrl,
  publicMcpUrl,
  publicSdkUrl,
  publicShortlinkUrl,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";
import { assertServiceForTarget } from "./cloudflare-services.mjs";
import {
  D1_SCHEMA_OWNERS,
  d1Descriptor,
  localMigrationFiles,
} from "./cloudflare-d1-registry.mjs";
import { migrationConfirmation } from "./cloudflare-d1-converge.mjs";
import { readMigrationBatchReceipt } from "./cloudflare-migration-batch.mjs";
import { runtimeBridgeDeploymentBlockers } from "./cloudflare-deploy-plan.mjs";
import {
  enforceIdentityProjectCutover,
  resolveDeploymentRevision,
} from "./cloudflare-identity-cutover.mjs";

const args = parseArgs();
const targetName = targetNameFromArgs(args);
const environment = environmentFromArgs(args);
const service = args.service ?? "api";
const uploadOnly = Boolean(args["upload-only"] || args.preflight);

const { target } = await loadTarget(targetName);
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
const backupDirectory =
  args["backup-directory"] ?? process.env.OPENGROW_BACKUP_DIRECTORY;
if (args["skip-backup"]) {
  throw new Error(
    "--skip-backup has been removed: production D1 backups are mandatory",
  );
}
if (schemaOwner && environment === "production" && args["skip-migrations"]) {
  throw new Error(
    "Production deploys of D1 schema owners cannot use --skip-migrations",
  );
}
let migrationsConvergedByBatch = false;
if (
  Boolean(args["identity-cutover-receipt"]) !==
  Boolean(args["identity-cutover-sha256"])
) {
  throw new Error(
    "--identity-cutover-receipt and --identity-cutover-sha256 are required together",
  );
}
if (
  Boolean(args["migration-batch-receipt"]) !==
  Boolean(args["migration-batch-sha256"])
) {
  throw new Error(
    "--migration-batch-receipt and --migration-batch-sha256 are required together",
  );
}

let suppliedIdentityCutover = null;
if (args["identity-cutover-receipt"]) {
  if (service !== "identity" || uploadOnly) {
    throw new Error(
      "--identity-cutover-receipt is valid only for an active Identity deployment",
    );
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
  "deploy",
  "generated",
  `${targetName}-${service}-${environment}.jsonc`,
);
generateServiceConfig();

if (service === "site") {
  run(
    process.execPath,
    [
      resolve(root, "scripts", "cloudflare-site-build.mjs"),
      "--target",
      targetName,
      "--environment",
      environment,
      ...(args["site-preview-route"] ? ["--site-preview-route"] : []),
    ],
    targetCloudflareEnv,
  );
}

if (service === "dashboard") {
  const apiUrl = publicApiUrl(target);
  const appUrl = publicDashboardUrl(target);
  const publicEnvironment = {
    ...targetCloudflareEnv,
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_AUTH_URL: publicAuthUrl(target),
    NEXT_PUBLIC_API_PATH: "/api/v1",
    NEXT_PUBLIC_CLIENT_ID: target.oauth.dashboardClientId,
    NEXT_PUBLIC_APP_URL: appUrl,
    NEXT_PUBLIC_SDK_URL: publicSdkUrl(target),
    NEXT_PUBLIC_SHORTLINK_URL: publicShortlinkUrl(target),
    NEXT_PUBLIC_MCP_URL: publicMcpUrl(target),
    NEXT_PUBLIC_DOCS_URL: target.operator.docsUrl,
    ...(target.operator.supportEmail
      ? { NEXT_PUBLIC_SUPPORT_EMAIL: target.operator.supportEmail }
      : {}),
    NEXT_PUBLIC_ENV: environment,
    NEXT_PUBLIC_REGISTRATION_MODE: target.registrationMode,
    NEXT_PUBLIC_SSO_ENABLED: String(target.ssoEnabled),
  };
  run(
    "npx",
    ["opennextjs-cloudflare", "build", "--config", configPath],
    publicEnvironment,
    resolve(root, "apps", "dashboard"),
  );
}

if (service === "identity") {
  run(
    "npm",
    ["run", "build:client"],
    targetCloudflareEnv,
    resolve(root, "workers", "identity"),
  );
}

if (
  schemaOwner &&
  !uploadOnly &&
  !args["skip-migrations"] &&
  !migrationsConvergedByBatch
) {
  run(
    process.execPath,
    [
      resolve(root, "scripts", "cloudflare-d1-converge.mjs"),
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
        resolve(root, "scripts", "superboard-allowlist.mjs"),
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

if (service === "dashboard") {
  run(
    "npx",
    [
      "opennextjs-cloudflare",
      uploadOnly ? "upload" : "deploy",
      "--config",
      configPath,
    ],
    targetCloudflareEnv,
    resolve(root, "apps", "dashboard"),
  );
} else if (service === "site") {
  run(
    "npx",
    [
      "wrangler",
      ...(uploadOnly ? ["versions", "upload"] : ["deploy"]),
      "--config",
      resolve(root, "apps/site/dist/server/wrangler.json"),
    ],
    targetCloudflareEnv,
  );
} else {
  run(
    "npx",
    [
      "wrangler",
      ...(uploadOnly ? ["versions", "upload"] : ["deploy"]),
      "--config",
      configPath,
    ],
    targetCloudflareEnv,
  );
}

function generateServiceConfig() {
  run(
    "node",
    [
      resolve(root, "scripts", "cloudflare-config.mjs"),
      "--target",
      targetName,
      "--service",
      service,
      "--environment",
      environment,
      ...(args["no-routes"] ? ["--no-routes"] : []),
      ...(args["site-preview-route"] ? ["--site-preview-route"] : []),
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
