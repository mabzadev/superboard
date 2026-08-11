#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { d1Descriptor } from "./cloudflare-d1-registry.mjs";
import {
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

export function assertProtectedBackupDirectory(value) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error("--output-directory must be an absolute path outside the Git repository");
  }
  const destination = resolve(value);
  const fromRepository = relative(root, destination);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
    throw new Error("Refusing to store a D1 backup inside the Git repository");
  }
  return destination;
}

export function backupPaths(outputDirectory, descriptor, now = new Date()) {
  const rootDirectory = assertProtectedBackupDirectory(outputDirectory);
  const stamp = now.toISOString().replaceAll(":", "-");
  const safeDatabase = descriptor.databaseName.replace(/[^a-zA-Z0-9._-]+/gu, "-");
  const directory = join(rootDirectory, descriptor.target, descriptor.environment, descriptor.service);
  const prefix = `${stamp}-${safeDatabase}`;
  return {
    directory,
    sql: join(directory, `${prefix}.sql`),
    receipt: join(directory, `${prefix}.receipt.json`),
  };
}

export async function createD1Backup({
  descriptor,
  outputDirectory,
  env,
  now = new Date(),
  execute = executeWranglerExport,
}) {
  if (!descriptor?.databaseId) {
    throw new Error(`${descriptor?.service || "D1"} database is not provisioned in the target manifest`);
  }
  const paths = backupPaths(outputDirectory, descriptor, now);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await chmod(paths.directory, 0o700);
  await execute({ descriptor, output: paths.sql, env });
  await chmod(paths.sql, 0o600);
  const exported = await stat(paths.sql);
  if (!exported.isFile() || exported.size === 0) throw new Error("D1 backup export is empty");
  const receipt = {
    schema_version: 1,
    kind: "cloudflare-d1-export",
    target: descriptor.target,
    environment: descriptor.environment,
    service: descriptor.service,
    database: { name: descriptor.databaseName, id: descriptor.databaseId },
    created_at: now.toISOString(),
    artifact: {
      path: basename(paths.sql),
      bytes: exported.size,
      sha256: await sha256File(paths.sql),
    },
  };
  await writeFile(paths.receipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { paths, receipt };
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function executeWranglerExport({ descriptor, output, env }) {
  const result = spawnSync("npx", [
    "wrangler", "d1", "export", descriptor.databaseId,
    "--remote", "--output", output,
  ], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env,
  });
  if (result.status !== 0) throw new Error(`D1 export failed for ${descriptor.service}`);
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const service = args.service || legacyDatabaseService(args.database) || "api";
  if (!args["output-directory"]) throw new Error("--output-directory is required");
  const { target } = await loadTarget(targetName);
  const descriptor = d1Descriptor(target, targetName, environment, service);
  if (!descriptor) throw new Error(`${service} is disabled or does not own a D1 schema for ${targetName}`);
  const result = await createD1Backup({
    descriptor,
    outputDirectory: args["output-directory"],
    env: cloudflareEnv(target),
  });
  process.stdout.write(`${JSON.stringify({
    completed: true,
    backup: result.paths.sql,
    receipt: result.paths.receipt,
    bytes: result.receipt.artifact.bytes,
    sha256: result.receipt.artifact.sha256,
    offsite_retention_required: true,
  }, null, 2)}\n`);
}

function legacyDatabaseService(value) {
  if (!value) return null;
  if (value === "d1") return "api";
  if (value === "messagingD1") return "messaging";
  throw new Error("--database is deprecated; use --service with a D1 schema owner");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
