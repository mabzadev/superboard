#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTarget, parseArgs, root } from "./cloudflare-target.mjs";

export function selectLegacyMessagingTarget(targets, requestedTarget = null) {
  const candidates = targets.flatMap((target) =>
    Object.entries(target.environments ?? {})
      .filter(
        ([environment, resources]) =>
          Boolean(target.workers?.messaging?.[environment]) &&
          Boolean(resources.messagingD1) &&
          Boolean(resources.messagingR2) &&
          Boolean(resources.queues?.messaging) &&
          Boolean(resources.queues?.messagingDlq),
      )
      .map(([environment]) => ({ targetName: target.target, environment })),
  );
  const selected = requestedTarget
    ? candidates.filter(({ targetName }) => targetName === requestedTarget)
    : candidates;
  if (selected.length !== 1) {
    const qualifier = requestedTarget ? ` for ${requestedTarget}` : "";
    throw new Error(
      `Expected exactly one declarative Legacy Messaging profile${qualifier}; found ${selected.length}`,
    );
  }
  return selected[0];
}

export async function discoverLegacyMessagingTarget(requestedTarget = null) {
  const entries = await readdir(resolve(root, "deploy", "targets"), {
    withFileTypes: true,
  });
  const targets = [];
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".json") ||
      entry.name === "schema.json"
    ) {
      continue;
    }
    targets.push((await loadTarget(entry.name.slice(0, -5))).target);
  }
  return selectLegacyMessagingTarget(targets, requestedTarget);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  const args = parseArgs();
  const mode = String(args.mode ?? "");
  if (!new Set(["runtime-test", "dry-run"]).has(mode)) {
    throw new Error("--mode must be runtime-test or dry-run");
  }
  const requestedTarget =
    String(
      args.target ?? process.env.OPENGROW_LEGACY_MESSAGING_TARGET ?? "",
    ).trim() || null;
  const selection = await discoverLegacyMessagingTarget(requestedTarget);
  const selectionArgs = [
    "--service",
    "messaging",
    "--target",
    selection.targetName,
    "--environment",
    selection.environment,
    "--allow-disabled",
  ];
  if (mode === "dry-run") {
    run(process.execPath, [
      resolve(root, "scripts", "cloudflare-dry-run.mjs"),
      ...selectionArgs,
    ]);
    return;
  }
  run(process.execPath, [
    resolve(root, "scripts", "cloudflare-config.mjs"),
    ...selectionArgs,
  ]);
  const configPath = resolve(
    root,
    "deploy",
    "generated",
    `${selection.targetName}-messaging-${selection.environment}.jsonc`,
  );
	run(
		"pnpm",
		["--dir", "workers/messaging", "exec", "vitest", "run", "--config", "vitest.runtime.config.ts"],
    {
      env: {
        ...process.env,
        OPENGROW_LEGACY_MESSAGING_CONFIG: configPath,
      },
    },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
