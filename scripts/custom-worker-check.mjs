#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";
import { managedWorkerService } from "./cloudflare-services.mjs";
import { superboardEnvironmentValue } from "./superboard-environment.mjs";

export function customWorkerPackagePaths(targets) {
  return [
    ...new Set(
      targets
        .flatMap((target) => [
          target.customWorker?.packagePath,
          ...(target.customWorker?.managedWorkers ?? []).map(
            ({ packagePath }) => packagePath,
          ),
        ])
        .filter(Boolean)
        .map((packagePath) => validatedPackagePath(packagePath)),
    ),
  ].sort();
}

export function validatedPackagePath(packagePath) {
  const value = String(packagePath || "").trim();
  const absolute = resolve(root, value);
  const fromRoot = relative(root, absolute);
  if (
    !value ||
    value.split("/").includes("..") ||
    fromRoot.startsWith("..") ||
    fromRoot === "" ||
    !/^[A-Za-z0-9._/-]+$/u.test(value)
  ) {
    throw new Error(
      `Invalid custom Worker package path: ${value || "<empty>"}`,
    );
  }
  return fromRoot;
}

export async function selectedCustomWorkerPackages(args, env = process.env) {
  if (
    args.all &&
    (args.target || superboardEnvironmentValue("SUPERBOARD_TARGET", env))
  ) {
    throw new Error(
      "--all cannot be combined with --target or SUPERBOARD_TARGET (fallback OPENGROW_TARGET)",
    );
  }
  if (!args.all) {
    const { target } = await loadTarget(targetNameFromArgs(args, env));
    return customWorkerPackagePaths([target]);
  }

  const entries = await readdir(resolve(root, "deploy", "targets"), {
    withFileTypes: true,
  });
  const targets = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".json") &&
          entry.name !== "schema.json",
      )
      .map(async (entry) => (await loadTarget(entry.name.slice(0, -5))).target),
  );
  return customWorkerPackagePaths(targets);
}

export async function selectedCustomWorkerTypeSelections(
  args,
  env = process.env,
) {
  if (args.all) {
    const entries = await readdir(resolve(root, "deploy", "targets"), {
      withFileTypes: true,
    });
    return Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".json") &&
            entry.name !== "schema.json",
        )
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          const targetName = entry.name.slice(0, -5);
          const { target } = await loadTarget(targetName);
          if (!target.customWorker) return null;
          const environments = Object.keys(target.environments).sort();
          return {
            targetName,
            environment: environments.includes("development")
              ? "development"
              : environments[0],
            packagePath: validatedPackagePath(target.customWorker.packagePath),
            managedServices: (target.customWorker.managedWorkers ?? []).map(
              managedWorkerService,
            ),
            managedPackages: Object.fromEntries(
              (target.customWorker.managedWorkers ?? []).map((worker) => [
                managedWorkerService(worker),
                validatedPackagePath(worker.packagePath),
              ]),
            ),
          };
        }),
    ).then((selections) =>
      uniqueCustomWorkerTypeSelections(selections.filter(Boolean)),
    );
  }
  const targetName = targetNameFromArgs(args, env);
  const { target } = await loadTarget(targetName);
  if (!target.customWorker) return [];
  return [
    {
      targetName,
      environment: environmentFromArgs(args, env),
      packagePath: validatedPackagePath(target.customWorker.packagePath),
      managedServices: (target.customWorker.managedWorkers ?? []).map(
        managedWorkerService,
      ),
      managedPackages: Object.fromEntries(
        (target.customWorker.managedWorkers ?? []).map((worker) => [
          managedWorkerService(worker),
          validatedPackagePath(worker.packagePath),
        ]),
      ),
    },
  ];
}

export function uniqueCustomWorkerTypeSelections(selections) {
  const owners = new Map();
  for (const selection of selections) {
    const packages = [
      selection.packagePath,
      ...Object.values(selection.managedPackages ?? {}),
    ];
    for (const packagePath of packages) {
      const existingOwner = owners.get(packagePath);
      if (existingOwner && existingOwner !== selection.targetName) {
        throw new Error(
          `Custom Worker package ${packagePath} is owned by both ${existingOwner} and ${selection.targetName}; app-specific extension packages must have one target owner`,
        );
      }
      owners.set(packagePath, selection.targetName);
    }
  }
  return selections;
}

export function runCustomWorkerChecks(packagePaths, execute = executeCommand) {
  for (const packagePath of packagePaths) {
    execute("npm", ["--prefix", packagePath, "run", "typecheck"]);
    execute("npm", ["--prefix", packagePath, "test"]);
  }
  return packagePaths;
}

function executeCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const packagePaths = await selectedCustomWorkerPackages(args);
  if (packagePaths.length === 0) {
    process.stdout.write("No custom Worker is declared for this selection.\n");
    return;
  }
  const selections = await selectedCustomWorkerTypeSelections(args);
  for (const selection of selections) {
    executeCommand(process.execPath, [
      resolve(root, "scripts", "cloudflare-types.mjs"),
      "--service",
      "custom",
      "--target",
      selection.targetName,
      "--environment",
      selection.environment,
      "--allow-unprovisioned",
    ]);
    for (const service of selection.managedServices) {
      executeCommand(process.execPath, [
        resolve(root, "scripts", "cloudflare-types.mjs"),
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
  runCustomWorkerChecks(packagePaths);
  process.stdout.write(
    `Validated ${packagePaths.length} custom Worker package(s): ${packagePaths.join(", ")}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
