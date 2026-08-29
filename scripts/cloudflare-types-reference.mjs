#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DOMAIN_SERVICES } from "./cloudflare-services.mjs";
import { selectedCustomWorkerTypeSelections } from "./custom-worker-check.mjs";
import { parseArgs, targetSelectionFromArgs } from "./cloudflare-target.mjs";
import { superboardEnvironmentValue } from "./superboard-environment.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const services = [
  "billing",
  "email",
  "identity",
  "files",
  "observability",
  "mcp",
  ...DOMAIN_SERVICES,
];
export async function cloudflareTypesMode(args, env = process.env) {
  if (args.reference) {
    const selection = await targetSelectionFromArgs(args, env, {
      allowReference: true,
    });
    return {
      ...selection,
      mode: "reference",
      generatorArgs: ["--reference"],
      customSelectionArgs: { all: true },
      customSelectionEnv: {},
    };
  }

  if (!args.target || !args.environment) {
    throw new Error(
      "Cloudflare type generation requires either --reference or an explicit --target and --environment",
    );
  }
  const configuredTarget = superboardEnvironmentValue("SUPERBOARD_TARGET", env);
  const configuredEnvironment = superboardEnvironmentValue(
    "SUPERBOARD_ENVIRONMENT",
    env,
  );
  if (configuredTarget && configuredTarget !== args.target) {
    throw new Error(
      `--target ${args.target} does not match OPENGROW_TARGET/SUPERBOARD_TARGET configured value ${configuredTarget}`,
    );
  }
  if (configuredEnvironment && configuredEnvironment !== args.environment) {
    throw new Error(
      `--environment ${args.environment} does not match OPENGROW_ENVIRONMENT/SUPERBOARD_ENVIRONMENT configured value ${configuredEnvironment}`,
    );
  }
  const selection = await targetSelectionFromArgs(args, env, {
    allowReference: true,
  });
  return {
    ...selection,
    mode: "target",
    generatorArgs: [
      "--target",
      selection.targetName,
      "--environment",
      selection.environment,
    ],
    customSelectionArgs: {
      target: selection.targetName,
      environment: selection.environment,
    },
    customSelectionEnv: env,
  };
}

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  execute = run,
) {
  const args = parseArgs(argv);
  const check = Boolean(args.check);
  const mode = await cloudflareTypesMode(args, env);
  const compareReferenceOutputs = check && mode.mode === "reference";
  const customSelections = await selectedCustomWorkerTypeSelections(
    mode.customSelectionArgs,
    mode.customSelectionEnv,
  );
  const managedSelections = customSelections.flatMap((selection) =>
    selection.managedServices.map((service) => ({ ...selection, service })),
  );
  const outputs = [
    resolve(root, "workers/api/src/generated-env.d.ts"),
    ...services.map((service) =>
      resolve(root, "workers", service, "worker-configuration.d.ts"),
    ),
    ...customSelections.map(({ packagePath }) =>
      resolve(root, packagePath, "worker-configuration.d.ts"),
    ),
    ...managedSelections.map(({ managedPackages, service }) =>
      resolve(root, managedPackages[service], "worker-configuration.d.ts"),
    ),
  ];
  const before = compareReferenceOutputs
    ? new Map(
        await Promise.all(
          outputs.map(async (path) => [path, await file(path)]),
        ),
      )
    : new Map();

  execute(process.execPath, [
    resolve(root, "scripts/cloudflare-api-types.mjs"),
    ...mode.generatorArgs,
    "--allow-unprovisioned",
  ]);
  for (const service of services) {
    execute(process.execPath, [
      resolve(root, "scripts/cloudflare-types.mjs"),
      "--service",
      service,
      ...mode.generatorArgs,
      "--allow-disabled",
      "--allow-unprovisioned",
    ]);
  }
  for (const selection of customSelections) {
    execute(process.execPath, [
      resolve(root, "scripts/cloudflare-types.mjs"),
      "--service",
      "custom",
      "--target",
      selection.targetName,
      "--environment",
      selection.environment,
      "--allow-unprovisioned",
    ]);
    for (const service of selection.managedServices) {
      execute(process.execPath, [
        resolve(root, "scripts/cloudflare-types.mjs"),
        "--service",
        service,
        "--target",
        selection.targetName,
        "--environment",
        selection.environment,
        "--allow-unprovisioned",
      ]);
    }
  }

  if (compareReferenceOutputs) {
    const stale = [];
    for (const path of outputs) {
      if (before.get(path) !== (await file(path))) {
        stale.push(path.slice(root.length + 1));
      }
    }
    if (stale.length) {
      throw new Error(
        `Generated Cloudflare binding types were stale:\n${stale.join("\n")}`,
      );
    }
  }

  const result = {
    schema_version: 1,
    status: "ok",
    mode: mode.mode,
    target: mode.targetName,
    environment: mode.environment,
    checked: check,
    reference_outputs_checked: compareReferenceOutputs,
    generated: outputs.map((path) => path.slice(root.length + 1)),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

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

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
