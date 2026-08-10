#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  d1Descriptor,
  localMigrationFiles,
} from "./cloudflare-d1-registry.mjs";
import {
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

export const IDENTITY_CUTOVER_KIND = "opengrow-identity-project-cutover";
const MAX_RECEIPT_BYTES = 64 * 1024;
const IDENTITY_SCOPE_QUERY = `SELECT
  (SELECT COUNT(*) FROM application_users WHERE project_id IS NULL) AS users,
  (SELECT COUNT(*) FROM application_identities WHERE project_id IS NULL) AS identities,
  (SELECT COUNT(*) FROM application_sessions WHERE project_id IS NULL) AS sessions,
  (SELECT COUNT(*) FROM application_identity_tokens WHERE project_id IS NULL) AS tokens,
  (SELECT COUNT(*) FROM d1_migrations WHERE name = ?) AS migration_applied`;

export async function verifyIdentityProjectCutover({
  target,
  targetName,
  environment,
  accountId,
  revision,
  receiptDirectory,
  env = process.env,
  execute = executeCommand,
  now = new Date(),
}) {
  const descriptor = d1Descriptor(target, targetName, environment, "identity");
  if (!descriptor?.databaseId) {
    throw new Error(
      "Identity cutover requires a provisioned target D1 database",
    );
  }
  const migrations = await localMigrationFiles(descriptor);
  const migration = migrations.at(-1);
  if (!migration) throw new Error("Identity has no reviewed migration");
  const normalizedRevision = exactRevision(revision);
  const result = execute(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      descriptor.databaseName,
      "--remote",
      "--json",
      "--config",
      descriptor.configPath,
      "--command",
      IDENTITY_SCOPE_QUERY.replace("?", sqlLiteral(migration)),
    ],
    { capture: true, env },
  );
  const evidence = parseIdentityScopeEvidence(result.stdout);
  if (evidence.migrationApplied !== 1) {
    throw new Error(
      `Identity cutover blocked: reviewed migration ${migration} is not applied remotely`,
    );
  }
  if (evidence.unscopedRows !== 0) {
    throw new Error(
      `Identity cutover blocked: ${evidence.unscopedRows} legacy rows have no project_id; run the explicit reviewed backfill before deployment`,
    );
  }
  const receipt = validateIdentityCutoverReceipt({
    schemaVersion: 1,
    kind: IDENTITY_CUTOVER_KIND,
    complete: true,
    target: targetName,
    environment,
    accountId,
    database: {
      name: descriptor.databaseName,
      id: descriptor.databaseId,
    },
    migration,
    revision: normalizedRevision,
    verifiedAt: now.toISOString(),
    evidence,
    resolution: "remote-unscoped-zero",
  });
  const path = await writeIdentityCutoverReceipt(
    receiptDirectory ??
      resolve(tmpdir(), `opengrow-identity-cutover-${process.pid}`),
    receipt,
  );
  const contents = await readFile(path);
  return {
    receipt,
    path,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

export function parseIdentityScopeEvidence(output) {
  let parsed;
  try {
    parsed = JSON.parse(String(output || ""));
  } catch {
    throw new Error("Identity cutover received invalid Wrangler JSON");
  }
  const statements = Array.isArray(parsed) ? parsed : [];
  if (
    statements.length !== 1 ||
    statements[0]?.success !== true ||
    !Array.isArray(statements[0]?.results) ||
    statements[0].results.length !== 1
  ) {
    throw new Error("Identity cutover received ambiguous remote D1 evidence");
  }
  const row = statements[0].results[0];
  const users = count(row?.users, "users");
  const identities = count(row?.identities, "identities");
  const sessions = count(row?.sessions, "sessions");
  const tokens = count(row?.tokens, "tokens");
  const migrationApplied = count(row?.migration_applied, "migration_applied");
  if (migrationApplied > 1) {
    throw new Error("Identity cutover migration evidence is invalid");
  }
  return {
    users,
    identities,
    sessions,
    tokens,
    migrationApplied,
    unscopedRows: users + identities + sessions + tokens,
  };
}

export async function writeIdentityCutoverReceipt(directory, receipt) {
  validateIdentityCutoverReceipt(receipt);
  const destination = await protectedDirectory(directory, { create: true });
  const stamp = receipt.verifiedAt.replaceAll(":", "-");
  const path = resolve(
    destination,
    `${stamp}-${receipt.target}-${receipt.environment}-${receipt.revision.slice(0, 12)}-identity-cutover.receipt.json`,
  );
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}

export async function readIdentityCutoverReceipt(path, expected = {}) {
  const source = resolve(path);
  await protectedDirectory(dirname(source));
  const sourceMetadata = await lstat(source);
  if (sourceMetadata.isSymbolicLink()) {
    throw new Error("Identity cutover receipt must not be a symbolic link");
  }
  if ((await realpath(source)) !== source) {
    throw new Error("Identity cutover receipt path must not traverse symlinks");
  }
  const metadata = await stat(source);
  if (
    !metadata.isFile() ||
    metadata.size === 0 ||
    metadata.size > MAX_RECEIPT_BYTES
  ) {
    throw new Error("Identity cutover receipt size is invalid");
  }
  const contents = await readFile(source);
  if (expected.sha256) {
    if (!/^[a-f0-9]{64}$/u.test(expected.sha256)) {
      throw new Error("Identity cutover receipt digest is invalid");
    }
    const actual = createHash("sha256").update(contents).digest("hex");
    if (actual !== expected.sha256) {
      throw new Error("Identity cutover receipt digest does not match");
    }
  }
  let value;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error("Identity cutover receipt JSON is invalid");
  }
  return validateIdentityCutoverReceipt(value, expected);
}

export async function enforceIdentityProjectCutover({
  suppliedReceipt,
  expected,
  verification,
}) {
  if (suppliedReceipt) {
    await readIdentityCutoverReceipt(suppliedReceipt.path, {
      ...expected,
      sha256: suppliedReceipt.sha256,
    });
  }
  // Caller-provided receipts are audit evidence only. A fresh remote read is
  // mandatory immediately before activating the Identity Worker.
  const remote = await verifyIdentityProjectCutover(verification);
  await readIdentityCutoverReceipt(remote.path, {
    ...expected,
    sha256: remote.sha256,
  });
  return remote;
}

export function validateIdentityCutoverReceipt(value, expected = {}) {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== IDENTITY_CUTOVER_KIND ||
    value.complete !== true ||
    typeof value.target !== "string" ||
    !["development", "production"].includes(value.environment) ||
    !/^[a-f0-9]{32}$/iu.test(value.accountId || "") ||
    !record(value.database) ||
    typeof value.database.name !== "string" ||
    !/^[a-f0-9-]{36}$/iu.test(value.database.id || "") ||
    !/^\d+[a-z0-9_-]*\.sql$/iu.test(value.migration || "") ||
    !/^[a-f0-9]{40}$/iu.test(value.revision || "") ||
    typeof value.verifiedAt !== "string" ||
    value.resolution !== "remote-unscoped-zero" ||
    !record(value.evidence) ||
    value.evidence.unscopedRows !== 0 ||
    value.evidence.migrationApplied !== 1
  ) {
    throw new Error("Identity cutover receipt contract is invalid");
  }
  for (const field of ["users", "identities", "sessions", "tokens"]) {
    if (value.evidence[field] !== 0) {
      throw new Error("Identity cutover receipt contains unscoped rows");
    }
  }
  const comparisons = [
    ["target", expected.targetName, value.target],
    ["environment", expected.environment, value.environment],
    ["account", expected.accountId, value.accountId],
    ["database name", expected.databaseName, value.database.name],
    ["database id", expected.databaseId, value.database.id],
    ["migration", expected.migration, value.migration],
    ["revision", expected.revision, value.revision],
  ];
  for (const [label, wanted, actual] of comparisons) {
    if (wanted !== undefined && wanted !== actual) {
      throw new Error(`Identity cutover receipt belongs to another ${label}`);
    }
  }
  return value;
}

export function resolveDeploymentRevision(
  env = process.env,
  execute = executeCommand,
) {
  const supplied = String(env.DEPLOY_SHA || "").trim();
  if (supplied) return exactRevision(supplied);
  const result = execute("git", ["rev-parse", "HEAD"], {
    capture: true,
    env,
  });
  return exactRevision(result.stdout);
}

async function protectedDirectory(directory, { create = false } = {}) {
  const supplied = String(directory || "");
  if (!isAbsolute(supplied)) {
    throw new Error("Identity cutover receipt directory must be absolute");
  }
  const destination = resolve(supplied);
  if (create) await mkdir(destination, { recursive: true, mode: 0o700 });
  const metadata = await lstat(destination);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(
      "Identity cutover receipt directory must be a real directory",
    );
  }
  const [actualDestination, actualRoot] = await Promise.all([
    realpath(destination),
    realpath(root),
  ]);
  const relation = relative(actualRoot, actualDestination);
  if (!relation.startsWith("..")) {
    throw new Error(
      "Identity cutover receipts must be written outside the Git repository",
    );
  }
  return actualDestination;
}

function exactRevision(value) {
  const revision = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error(
      "Identity cutover requires the exact 40-character deployment revision",
    );
  }
  return revision;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function count(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Identity cutover ${field} evidence is invalid`);
  }
  return number;
}

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function executeCommand(
  command,
  args,
  { capture = false, env = process.env } = {},
) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Identity cutover remote read failed${capture ? `: ${String(result.stderr || result.stdout || "").trim()}` : ""}`,
    );
  }
  return result;
}

async function main() {
  const args = parseArgs();
  if (args.apply || args.confirm || args.mapping) {
    throw new Error(
      "Identity cutover verification is read-only; execute a reviewed backfill separately with explicit operator confirmation",
    );
  }
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const runtimeEnv = cloudflareEnv(target);
  executeCommand(
    process.execPath,
    [
      resolve(root, "scripts", "cloudflare-config.mjs"),
      "--target",
      targetName,
      "--service",
      "identity",
      "--environment",
      environment,
      "--no-routes",
    ],
    { env: runtimeEnv },
  );
  const result = await verifyIdentityProjectCutover({
    target,
    targetName,
    environment,
    accountId: runtimeEnv.CLOUDFLARE_ACCOUNT_ID,
    revision: args.revision ?? resolveDeploymentRevision(runtimeEnv),
    receiptDirectory: args["receipt-directory"],
    env: runtimeEnv,
  });
  console.log(
    JSON.stringify(
      { ...result.receipt, receiptPath: result.path, sha256: result.sha256 },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
