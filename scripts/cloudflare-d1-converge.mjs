#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createD1Backup } from "./cloudflare-d1-backup.mjs";
import {
  localMigrationFiles,
  targetD1Descriptors,
} from "./cloudflare-d1-registry.mjs";
import {
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

export function migrationConfirmation(
  targetName,
  environment,
  serviceSelector,
) {
  return `MIGRATE:${targetName}:${environment}:${serviceSelector}`;
}

const ANSI_ESCAPE_PATTERN =
  /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu;

export function parseWranglerD1MigrationList(output) {
  const normalized = String(output ?? "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r/gu, "")
    .trim();
  if (!normalized) {
    throw new Error("Wrangler returned an empty D1 migration list");
  }

  const reportsNoPendingMigrations =
    /(?:^|\n)\s*(?:✅\s*)?No migrations to apply!?(?:\s*|$)/iu.test(normalized);
  const pendingMigrations = [];
  for (const line of normalized.split("\n")) {
    const tableCell = line.match(/│\s*([^│]*?\.sql)\s*│/iu)?.[1]?.trim();
    if (tableCell && /^\d+[a-z0-9_-]*\.sql$/iu.test(tableCell)) {
      pendingMigrations.push(tableCell);
    }
  }

  if (new Set(pendingMigrations).size !== pendingMigrations.length) {
    throw new Error("Wrangler returned duplicate D1 migration names");
  }
  if (reportsNoPendingMigrations && pendingMigrations.length > 0) {
    throw new Error("Wrangler returned an ambiguous D1 migration list");
  }
  if (!reportsNoPendingMigrations && pendingMigrations.length === 0) {
    throw new Error("Wrangler returned an unrecognized D1 migration list");
  }

  return {
    converged: pendingMigrations.length === 0,
    pending_migrations: pendingMigrations,
    pending_migration_count: pendingMigrations.length,
  };
}

export function assertMigrationApplySafety({
  targetName,
  environment,
  serviceSelector,
  apply,
  confirm,
  backupDirectory,
}) {
  if (apply !== true) throw new Error("Refusing D1 mutation without --apply");
  const expected = migrationConfirmation(
    targetName,
    environment,
    serviceSelector,
  );
  if (confirm !== expected)
    throw new Error(`Refusing D1 mutation: pass --confirm ${expected}`);
  if (environment === "production" && !backupDirectory) {
    throw new Error(
      "Production D1 migration requires --backup-directory outside the Git repository",
    );
  }
  return true;
}

export async function buildD1ConvergencePlan({
  target,
  targetName,
  environment,
  serviceSelector = "all",
}) {
  const descriptors = targetD1Descriptors(
    target,
    targetName,
    environment,
    serviceSelector,
  );
  const databases = [];
  for (const descriptor of descriptors) {
    const migrations = await localMigrationFiles(descriptor);
    databases.push({
      service: descriptor.service,
      binding: descriptor.binding,
      database_name: descriptor.databaseName,
      provisioned: Boolean(descriptor.databaseId),
      migrations_directory: descriptor.migrationsDirectory,
      local_migrations: migrations,
      local_migration_count: migrations.length,
    });
  }
  return {
    schema_version: 1,
    mode: "plan",
    target: targetName,
    environment,
    service_selector: serviceSelector,
    ready: databases.every(({ provisioned }) => provisioned),
    remote_read: false,
    converged: null,
    pending_migration_count: null,
    databases,
  };
}

export async function attachRemoteMigrationStatus({
  plan,
  target,
  targetName,
  environment,
  serviceSelector,
  env,
  execute = executeCommand,
}) {
  const descriptors = targetD1Descriptors(
    target,
    targetName,
    environment,
    serviceSelector,
  );
  for (const descriptor of descriptors) {
    if (!descriptor.databaseId)
      throw new Error(`${descriptor.service} database is not provisioned`);
    generateConfig(descriptor, targetName, environment, env, execute);
    const result = execute(
      "npx",
      [
        "wrangler",
        "d1",
        "migrations",
        "list",
        descriptor.databaseName,
        "--remote",
        "--config",
        descriptor.configPath,
      ],
      { env, capture: true },
    );
    const database = plan.databases.find(
      ({ service }) => service === descriptor.service,
    );
    const remoteStatus = String(result.stdout || result.stderr || "").trim();
    const parsed = parseWranglerD1MigrationList(remoteStatus);
    const unexpected = parsed.pending_migrations.filter(
      (migration) => !database.local_migrations.includes(migration),
    );
    if (unexpected.length > 0) {
      throw new Error(
        `${descriptor.service} reported migrations outside the reviewed local chain: ${unexpected.join(", ")}`,
      );
    }
    database.remote_read = true;
    database.remote_status = remoteStatus;
    database.remote_converged = parsed.converged;
    database.pending_migrations = parsed.pending_migrations;
    database.pending_migration_count = parsed.pending_migration_count;
  }
  plan.mode = "remote-plan";
  plan.remote_read = true;
  plan.converged = plan.databases.every(
    ({ remote_converged }) => remote_converged === true,
  );
  plan.pending_migration_count = plan.databases.reduce(
    (total, database) => total + database.pending_migration_count,
    0,
  );
  return plan;
}

export async function applyD1Convergence({
  target,
  targetName,
  environment,
  serviceSelector = "all",
  backupDirectory,
  env,
  execute = executeCommand,
  backup = createD1Backup,
  now = new Date(),
}) {
  const descriptors = targetD1Descriptors(
    target,
    targetName,
    environment,
    serviceSelector,
  );
  for (const descriptor of descriptors) {
    if (!descriptor.databaseId)
      throw new Error(`${descriptor.service} database is not provisioned`);
    generateConfig(descriptor, targetName, environment, env, execute);
  }

  // Back up every selected production database before the first schema write.
  const backupReceipts = [];
  if (environment === "production" || backupDirectory) {
    for (const descriptor of descriptors) {
      const result = await backup({
        descriptor,
        outputDirectory: backupDirectory,
        env,
        now,
      });
      backupReceipts.push({
        service: descriptor.service,
        path: result.paths.receipt,
        bytes: result.receipt.artifact.bytes,
        sha256: result.receipt.artifact.sha256,
      });
    }
  }

  const results = [];
  for (const descriptor of descriptors) {
    execute(
      "npx",
      [
        "wrangler",
        "d1",
        "migrations",
        "apply",
        descriptor.databaseName,
        "--remote",
        "--config",
        descriptor.configPath,
      ],
      { env, capture: true },
    );
    const verification = execute(
      "npx",
      [
        "wrangler",
        "d1",
        "migrations",
        "list",
        descriptor.databaseName,
        "--remote",
        "--config",
        descriptor.configPath,
      ],
      { env, capture: true },
    );
    const remoteStatus = String(
      verification.stdout || verification.stderr || "",
    ).trim();
    const parsed = parseWranglerD1MigrationList(remoteStatus);
    if (!parsed.converged) {
      throw new Error(
        `${descriptor.service} D1 migration verification still reports: ${parsed.pending_migrations.join(", ")}`,
      );
    }
    results.push({
      service: descriptor.service,
      database_name: descriptor.databaseName,
      verified_at: now.toISOString(),
      remote_status: remoteStatus,
      converged: true,
      pending_migrations: [],
      pending_migration_count: 0,
    });
  }
  return {
    schema_version: 1,
    mode: "apply",
    target: targetName,
    environment,
    service_selector: serviceSelector,
    converged: true,
    pending_migration_count: 0,
    backups: backupReceipts,
    databases: results,
  };
}

function generateConfig(descriptor, targetName, environment, env, execute) {
  execute(
    process.execPath,
    [
      resolve(root, "scripts", "cloudflare-config.mjs"),
      "--target",
      targetName,
      "--service",
      descriptor.service,
      "--environment",
      environment,
      "--no-routes",
    ],
    { env, capture: true },
  );
}

function executeCommand(
  command,
  args,
  { env = process.env, capture = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    const details = capture
      ? String(result.stderr || result.stdout || "").trim()
      : "";
    throw new Error(`${command} failed${details ? `: ${details}` : ""}`);
  }
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const command = ["plan", "apply"].includes(argv[0]) ? argv[0] : "plan";
  if (
    argv[0] &&
    !argv[0].startsWith("--") &&
    !["plan", "apply"].includes(argv[0])
  ) {
    throw new Error("Command must be plan or apply");
  }
  const args = parseArgs(command === argv[0] ? argv.slice(1) : argv);
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const serviceSelector = String(args.service || "all");
  const { target } = await loadTarget(targetName);

  if (command === "plan") {
    const plan = await buildD1ConvergencePlan({
      target,
      targetName,
      environment,
      serviceSelector,
    });
    if (args["remote-read"]) {
      await attachRemoteMigrationStatus({
        plan,
        target,
        targetName,
        environment,
        serviceSelector,
        env: cloudflareEnv(target),
      });
    }
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (!plan.ready) process.exitCode = 2;
    return;
  }

  assertMigrationApplySafety({
    targetName,
    environment,
    serviceSelector,
    apply: Boolean(args.apply),
    confirm: args.confirm,
    backupDirectory: args["backup-directory"],
  });
  const result = await applyD1Convergence({
    target,
    targetName,
    environment,
    serviceSelector,
    backupDirectory: args["backup-directory"],
    env: cloudflareEnv(target),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
