#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DOMAIN_SERVICES } from "./cloudflare-services.mjs";
import { selectedCustomWorkerTypeSelections } from "./custom-worker-check.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const check = process.argv.includes("--check");
const services = [
  "billing",
  "email",
  "identity",
  "files",
  "observability",
  "mcp",
  ...DOMAIN_SERVICES,
];
const customSelections = await selectedCustomWorkerTypeSelections(
  { all: true },
  {},
);
const outputs = [
  resolve(root, "workers/api/src/generated-env.d.ts"),
  ...services.map((service) => resolve(root, "workers", service, "worker-configuration.d.ts")),
  ...customSelections.map(({ packagePath }) =>
    resolve(root, packagePath, "worker-configuration.d.ts")
  ),
];
const before = check
  ? new Map(await Promise.all(outputs.map(async (path) => [path, await file(path)])))
  : new Map();

run(process.execPath, [
  resolve(root, "scripts/cloudflare-api-types.mjs"),
  "--reference",
  "--allow-unprovisioned",
]);
for (const service of services) {
  run(process.execPath, [
    resolve(root, "scripts/cloudflare-types.mjs"),
    "--service",
    service,
    "--reference",
    "--allow-unprovisioned",
  ]);
}
for (const selection of customSelections) {
  run(process.execPath, [
    resolve(root, "scripts/cloudflare-types.mjs"),
    "--service",
    "custom",
    "--target",
    selection.targetName,
    "--environment",
    selection.environment,
    "--allow-unprovisioned",
  ]);
}

if (check) {
  const stale = [];
  for (const path of outputs) {
    if (before.get(path) !== await file(path)) stale.push(path.slice(root.length + 1));
  }
  if (stale.length) {
    throw new Error(`Generated Cloudflare binding types were stale:\n${stale.join("\n")}`);
  }
}

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  status: "ok",
  checked: check,
  generated: outputs.map((path) => path.slice(root.length + 1)),
}, null, 2)}\n`);

async function file(path) {
  return readFile(path, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (result.status === 0) return;
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
