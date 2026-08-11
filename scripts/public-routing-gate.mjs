#!/usr/bin/env node
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";
import { verifyFlutterFlowClientReceipt } from "./flutterflow-client-release.mjs";

export function assertPublicRoutingReady(
  target,
  environment,
  {
    repositoryRoot = root,
    verifyReceipt = verifyFlutterFlowClientReceipt,
  } = {},
) {
  const routing = target.environments?.[environment]?.publicRouting;
  if (routing === "staged") {
    return {
      schemaVersion: 1,
      ready: true,
      routesEnabled: false,
      target: target.target,
      environment,
      mode: "staged-private-workers",
      clientReceiptVerified: false,
    };
  }
  if (routing !== "active") {
    throw new Error(
      `Target ${target.target}/${environment} has no valid publicRouting mode`,
    );
  }
  if (environment !== "production") {
    return {
      schemaVersion: 1,
      ready: true,
      routesEnabled: true,
      target: target.target,
      environment,
      mode: "active-development",
      clientReceiptVerified: false,
    };
  }
  const cutover = target.productionCutover;
  if (!cutover) {
    throw new Error(
      `Production public routing for ${target.target} requires a reviewed client cutover receipt`,
    );
  }
  const manifestPath = repositoryPath(
    repositoryRoot,
    cutover.snapshot,
    "config/flutterflow-sources",
  );
  const receiptPath = repositoryPath(
    repositoryRoot,
    cutover.clientReceipt,
    "config/flutterflow-releases",
  );
  const receipt = verifyReceipt({ manifestPath, receiptPath });
  if (!receipt?.ready || receipt.application !== cutover.application) {
    throw new Error(
      `Production public routing for ${target.target} has an invalid client cutover receipt`,
    );
  }
  return {
    schemaVersion: 1,
    ready: true,
    routesEnabled: true,
    target: target.target,
    environment,
    mode: "active-production",
    application: receipt.application,
    flutterflowCommitId: receipt.flutterflowCommitId,
    clientReceiptVerified: true,
  };
}

function repositoryPath(repositoryRoot, relativePath, requiredPrefix) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.startsWith(`${requiredPrefix}/`)
  ) {
    throw new Error(`Cutover path must be below ${requiredPrefix}`);
  }
  const base = resolve(repositoryRoot);
  const path = resolve(base, relativePath);
  if (!path.startsWith(`${base}${sep}`)) {
    throw new Error("Cutover path escapes the repository");
  }
  return path;
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const result = assertPublicRoutingReady(target, environment);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
