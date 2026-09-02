import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";
import { buildDeploymentExecutionPlan } from "./cloudflare-deploy-plan.mjs";
import {
  applyD1Convergence,
  assertMigrationApplySafety,
  migrationConfirmation,
} from "./cloudflare-d1-converge.mjs";
import { targetD1Descriptors } from "./cloudflare-d1-registry.mjs";
import {
  buildMigrationBatchReceipt,
  writeMigrationBatchReceipt,
} from "./cloudflare-migration-batch.mjs";
import { sha256File } from "./cloudflare-d1-backup.mjs";
import {
  resolveDeploymentRevision,
  verifyIdentityProjectCutover,
} from "./cloudflare-identity-cutover.mjs";
import {
  compiledTargetFromArgs,
} from "./target-compiler.mjs";

const args = parseArgs();
if (args["skip-backup"]) {
  throw new Error(
    "--skip-backup has been removed: production D1 backups are mandatory",
  );
}
const targetName = targetNameFromArgs(args);
const environment = environmentFromArgs(args);
const { target } = await loadTarget(targetName);
const compiledTarget = await compiledTargetFromArgs(target, environment, args);
if (!target.environments[environment])
  throw new Error(`${targetName} does not define ${environment}`);
const plan = buildDeploymentExecutionPlan({
  target,
  environment,
  requestedServices: args.services,
  uploadOnly: Boolean(args["upload-only"]),
  preflight: Boolean(args.preflight),
  skipMigrations: Boolean(args["skip-migrations"]),
  compiledTarget,
});
const services = plan.services;

if (args.plan) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
const targetCloudflareEnv = cloudflareEnv(target);

if (plan.blockers.length > 0) {
  throw new Error(
    `Refusing active deployment: ${plan.blockers
      .map(({ id, action }) => `${id}: ${action}`)
      .join(" | ")}`,
  );
}

let migrationBatchReceipt = null;
let identityCutoverReceipt = null;
if (plan.migrationStrategy === "backup-and-migrate-all-before-workers") {
  const backupDirectory =
    args["backup-directory"] ?? process.env.OPENGROW_BACKUP_DIRECTORY;
  assertMigrationApplySafety({
    targetName,
    environment,
    serviceSelector: "all",
    apply: true,
    confirm: migrationConfirmation(targetName, environment, "all"),
    backupDirectory,
  });
  const descriptors = targetD1Descriptors(
    target,
    targetName,
    environment,
    "all",
  );
  const now = new Date();
  const result = await applyD1Convergence({
    target,
    targetName,
    environment,
    serviceSelector: "all",
    backupDirectory,
    env: targetCloudflareEnv,
    now,
    compiledTarget,
    targetArtifactPath: args["target-artifact"],
    targetArtifactChecksum: args["target-artifact-checksum"],
  });
  const receipt = buildMigrationBatchReceipt({
    targetName,
    environment,
    result,
    expectedServices: descriptors.map(({ service }) => service),
    now,
  });
  const receiptPath = await writeMigrationBatchReceipt(
    backupDirectory,
    receipt,
  );
  migrationBatchReceipt = {
    path: receiptPath,
    sha256: await sha256File(receiptPath),
  };
  console.log(`Verified complete D1 migration batch: ${receiptPath}`);
  if (services.includes("identity")) {
    identityCutoverReceipt = await verifyIdentityProjectCutover({
      target,
      targetName,
      environment,
      accountId: targetCloudflareEnv.CLOUDFLARE_ACCOUNT_ID,
      revision: resolveDeploymentRevision(targetCloudflareEnv),
      receiptDirectory: backupDirectory,
      env: targetCloudflareEnv,
    });
    console.log(
      `Verified Identity project cutover: ${identityCutoverReceipt.path}`,
    );
  }
}

for (const service of services) {
  console.log(`Deploying ${targetName}/${environment}/${service}`);
  const commandArgs = [
    resolve(root, "scripts", "cloudflare-deploy.mjs"),
    "--target",
    targetName,
    "--environment",
    environment,
    "--service",
    service,
    ...(args["target-artifact"] && args["target-artifact-checksum"]
      ? [
          "--target-artifact",
          args["target-artifact"],
          "--target-artifact-checksum",
          args["target-artifact-checksum"],
        ]
      : []),
    ...(args["no-routes"] ? ["--no-routes"] : []),
    ...(args.preflight ? ["--preflight"] : []),
    ...(args["upload-only"] ? ["--upload-only"] : []),
    ...(args["skip-migrations"] ? ["--skip-migrations"] : []),
    ...(migrationBatchReceipt && plan.schemaServices.includes(service)
      ? [
          "--migration-batch-receipt",
          migrationBatchReceipt.path,
          "--migration-batch-sha256",
          migrationBatchReceipt.sha256,
        ]
      : []),
    ...(identityCutoverReceipt && service === "identity"
      ? [
          "--identity-cutover-receipt",
          identityCutoverReceipt.path,
          "--identity-cutover-sha256",
          identityCutoverReceipt.sha256,
        ]
      : []),
    ...(args["backup-directory"]
      ? ["--backup-directory", args["backup-directory"]]
      : []),
  ];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
