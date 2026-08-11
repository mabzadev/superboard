#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyRenderedChatwoot,
  loadRenderedChatwoot,
  validateChatwootApplySafety,
} from "./chatwoot-cutover/apply.mjs";
import { environmentFromArgs, loadTarget, parseArgs, targetNameFromArgs } from "./cloudflare-target.mjs";
import { readJson } from "./module-cutover/core.mjs";

async function main() {
  const args = parseArgs();
  if (!args.apply) throw new Error("Chatwoot apply requires --apply");
  for (const flag of ["rendered", "window", "checkpoint", "confirm"]) {
    if (!args[flag]) throw new Error(`Chatwoot apply requires --${flag}`);
  }
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const rendered = await loadRenderedChatwoot(args.rendered);
  const projectId = Number(rendered.plan.destination.project_id);
  validateChatwootApplySafety({
    targetName,
    environment,
    projectId,
    window: await readJson(resolve(args.window)),
    confirm: args.confirm,
    allowProduction: Boolean(args["allow-production"]),
  });
  const result = await applyRenderedChatwoot({
    rendered,
    target,
    targetName,
    environment,
    checkpointPath: args.checkpoint,
  });
  process.stdout.write(`${JSON.stringify({ completed: true, ...result }, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
