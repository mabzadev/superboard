#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

const DEFAULT_OVERLAP_MINUTES = 30;

export function buildOauthRotationPlan({
  targetName,
  target,
  environment,
  overlapMinutes = DEFAULT_OVERLAP_MINUTES,
}) {
  if (!target.environments?.[environment]) {
    throw new Error(`${targetName} does not define ${environment}`);
  }
  if (!Number.isInteger(overlapMinutes) || overlapMinutes < 5 || overlapMinutes > 120) {
    throw new Error("--overlap-minutes must be an integer between 5 and 120");
  }
  const apiWorker = target.workers?.api?.[environment];
  const dashboardWorker = target.workers?.dashboard?.[environment];
  const clientId = String(target.oauth?.dashboardClientId ?? "").trim();
  if (!apiWorker || !dashboardWorker || !clientId) {
    throw new Error(`OAuth rotation configuration is incomplete for ${targetName}/${environment}`);
  }
  const plan = {
    schemaVersion: 1,
    mode: "value-free-rotation-plan",
    target: targetName,
    environment,
    valuesIncluded: false,
    clientId,
    apiWorker,
    dashboardWorker,
    overlapMinutes,
    requiredMigration: "0056_oauth_client_secret_overlap.sql",
    steps: [
      "verify-overlap-schema",
      "upload-inactive-dashboard-secret-version",
      "move-current-verifier-to-bounded-previous-slot",
      "activate-tagged-dashboard-version",
      "rollback-database-verifier-if-activation-fails",
    ],
  };
  return { ...plan, confirmation: oauthRotationConfirmation(plan) };
}

export function oauthRotationConfirmation(plan) {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      schemaVersion: plan.schemaVersion,
      target: plan.target,
      environment: plan.environment,
      clientId: plan.clientId,
      apiWorker: plan.apiWorker,
      dashboardWorker: plan.dashboardWorker,
      overlapMinutes: plan.overlapMinutes,
      requiredMigration: plan.requiredMigration,
      steps: plan.steps,
    }))
    .digest("hex")
    .slice(0, 12);
  return `CLOUDFLARE:OAUTH-ROTATE:${plan.target}:${plan.environment}:${digest}`;
}

export function oauthRotationSql({ clientId, secretDigest, overlapMinutes }) {
  if (!/^[a-f0-9]{64}$/u.test(secretDigest)) {
    throw new Error("OAuth secret digest must be SHA-256 hex");
  }
  if (!Number.isInteger(overlapMinutes) || overlapMinutes < 5 || overlapMinutes > 120) {
    throw new Error("OAuth overlap must be between 5 and 120 minutes");
  }
  const uid = sql(clientId);
  const digest = sql(secretDigest);
  return {
    apply: `
INSERT INTO oauth_applications (
  name, uid, secret, previous_secret, previous_secret_expires_at,
  redirect_uri, scopes
)
VALUES (
  'OpenGrow Dashboard', '${uid}', '${digest}', NULL, NULL,
  'urn:ietf:wg:oauth:2.0:oob', 'read write'
)
ON CONFLICT(uid) DO UPDATE SET
  previous_secret = oauth_applications.secret,
  previous_secret_expires_at = datetime('now', '+${overlapMinutes} minutes'),
  secret = excluded.secret,
  name = excluded.name,
  updated_at = datetime('now');
`,
    rollback: `
UPDATE oauth_applications
SET secret = previous_secret,
    previous_secret = NULL,
    previous_secret_expires_at = NULL,
    updated_at = datetime('now')
WHERE uid = '${uid}'
  AND secret = '${digest}'
  AND previous_secret IS NOT NULL;
`,
  };
}

export function versionedOauthSecretArgs(config, tag, targetName, environment) {
  return [
    "wrangler",
    "versions",
    "secret",
    "bulk",
    "--config",
    config,
    "--tag",
    tag,
    "--message",
    `OpenGrow Dashboard OAuth rotation for ${targetName}/${environment}`,
  ];
}

export function deployOauthVersionArgs(config, tag, targetName, environment) {
  return [
    "wrangler",
    "versions",
    "deploy",
    "--config",
    config,
    "--version-tag",
    `${tag}@100%`,
    "--message",
    `Activate OpenGrow Dashboard OAuth rotation for ${targetName}/${environment}`,
    "--yes",
  ];
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const overlapMinutes = args["overlap-minutes"] == null
    ? DEFAULT_OVERLAP_MINUTES
    : Number(args["overlap-minutes"]);
  const plan = buildOauthRotationPlan({
    targetName,
    target,
    environment,
    overlapMinutes,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!args.apply) return;
  if (args.confirm !== plan.confirmation) {
    throw new Error(
      `Refusing OAuth rotation: pass --confirm ${plan.confirmation}`,
    );
  }

  const childEnv = cloudflareEnv(target);
  const apiConfig = generateConfig(targetName, environment, "api", childEnv);
  const dashboardConfig = generateConfig(
    targetName,
    environment,
    "dashboard",
    childEnv,
  );
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--remote",
    "--command",
    "SELECT previous_secret, previous_secret_expires_at FROM oauth_applications LIMIT 0",
    "--config",
    apiConfig,
  ], { env: childEnv, label: "OAuth overlap schema verification" });

  const secret = randomBytes(48).toString("base64url");
  const secretDigest = createHash("sha256").update(secret).digest("hex");
  const tag = `oauth-${Date.now()}-${randomBytes(5).toString("hex")}`;
  const statements = oauthRotationSql({
    clientId: plan.clientId,
    secretDigest,
    overlapMinutes,
  });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "opengrow-oauth-"));
  const applyPath = join(temporaryDirectory, "apply.sql");
  const rollbackPath = join(temporaryDirectory, "rollback.sql");
  try {
    await Promise.all([
      writeFile(applyPath, statements.apply, { encoding: "utf8", mode: 0o600 }),
      writeFile(rollbackPath, statements.rollback, { encoding: "utf8", mode: 0o600 }),
    ]);
    run("npx", versionedOauthSecretArgs(
      dashboardConfig,
      tag,
      targetName,
      environment,
    ), {
      env: childEnv,
      input: JSON.stringify({ CLIENT_SECRET: secret }),
      label: "inactive Dashboard OAuth secret upload",
    });
    run("npx", [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--file",
      applyPath,
      "--config",
      apiConfig,
    ], { env: childEnv, label: "OAuth verifier overlap update" });
    try {
      run("npx", deployOauthVersionArgs(
        dashboardConfig,
        tag,
        targetName,
        environment,
      ), { env: childEnv, label: "Dashboard OAuth version activation" });
    } catch (activationError) {
      run("npx", [
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--remote",
        "--file",
        rollbackPath,
        "--config",
        apiConfig,
      ], { env: childEnv, label: "OAuth verifier rollback" });
      throw activationError;
    }
    process.stdout.write(`${JSON.stringify({
      mode: "applied",
      target: targetName,
      environment,
      valuesIncluded: false,
      dashboardVersionTag: tag,
      overlapMinutes,
      rollback: "previous verifier remains valid only for the bounded overlap",
    }, null, 2)}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function generateConfig(targetName, environment, service, env) {
  run(process.execPath, [
    resolve(root, "scripts", "cloudflare-config.mjs"),
    "--target",
    targetName,
    "--environment",
    environment,
    "--service",
    service,
    "--no-routes",
  ], { env, label: `${service} configuration generation` });
  return resolve(
    root,
    "deploy",
    "generated",
    `${targetName}-${service}-${environment}.jsonc`,
  );
}

function sql(value) {
  return String(value).replaceAll("'", "''");
}

function run(command, commandArgs, { env, input, label } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: env ?? process.env,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${label ?? command} failed`);
  }
  return result;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
