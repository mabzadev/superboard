#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertService, isServiceEnabled } from "./cloudflare-services.mjs";
import { loadTarget, parseArgs, root, targetSelectionFromArgs } from "./cloudflare-target.mjs";

const args = parseArgs();
const service = String(args.service || "");
assertService(service);
if (service === "dashboard") throw new Error("Use dashboard:cf-build for Dashboard validation");
const { targetName, environment } = await targetSelectionFromArgs(args, process.env, { allowReference: true });
const { target } = await loadTarget(targetName);
if (!isServiceEnabled(target, service) && !args["allow-disabled"]) throw new Error(`${service} is disabled for ${targetName}`);
const configPath = resolve(root, "deploy", "generated", `${targetName}-${service}-${environment}.jsonc`);
run(process.execPath, [
  resolve(root, "scripts", "cloudflare-config.mjs"),
  "--target", targetName,
  "--environment", environment,
  "--service", service,
  "--no-routes",
  ...(args["allow-disabled"] ? ["--allow-disabled"] : []),
  ...(args["allow-unprovisioned"] ? ["--allow-unprovisioned"] : []),
]);
run("npx", ["wrangler", "deploy", "--dry-run", "--config", configPath]);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
