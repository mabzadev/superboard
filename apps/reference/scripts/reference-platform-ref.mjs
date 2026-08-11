import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { safeGitBranch } from "./reference-history-bridge.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;

function exactString(value, field) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error(`${field} must be an exact string.`);
  }
  return value;
}

function exactSha(value, field) {
  const sha = exactString(value, field);
  if (!shaPattern.test(sha)) {
    throw new Error(`${field} must be a lowercase 40-character commit SHA.`);
  }
  return sha;
}

export function selectOfficialPlatformRef({
  eventName,
  refName = "",
  baseRef = "",
  dispatchPlatformSha = "",
  deploymentBranch,
  productionBranch,
  historyBridgeValidated = "",
}) {
  const exactEventName = exactString(eventName, "eventName");
  const safeDeploymentBranch = safeGitBranch(
    deploymentBranch,
    "deploymentBranch",
  );
  const safeProductionBranch = safeGitBranch(
    productionBranch,
    "productionBranch",
  );
  if (safeProductionBranch === safeDeploymentBranch) {
    throw new Error("Production and development branches must differ.");
  }
  const bridgeState = exactString(
    historyBridgeValidated,
    "historyBridgeValidated",
  );
  if (!["", "false", "true"].includes(bridgeState)) {
    throw new Error(
      'historyBridgeValidated must be exactly "true", "false" or empty.',
    );
  }
  const validatedBridge = bridgeState === "true";
  if (validatedBridge && exactEventName !== "pull_request") {
    throw new Error("A validated history bridge must be a pull request.");
  }

  if (exactEventName === "repository_dispatch") {
    return {
      ref: exactSha(dispatchPlatformSha, "dispatchPlatformSha"),
      source: "dispatch-exact-sha",
    };
  }
  if (exactEventName === "pull_request") {
    const safeBaseRef = safeGitBranch(baseRef, "baseRef");
    if (validatedBridge) {
      return {
        ref: safeDeploymentBranch,
        source: "validated-history-bridge-development",
      };
    }
    const targetsProduction = safeBaseRef === safeProductionBranch;
    return {
      ref: targetsProduction ? safeProductionBranch : safeDeploymentBranch,
      source: targetsProduction
        ? "pull-request-production"
        : "pull-request-development",
    };
  }
  if (["push", "workflow_dispatch"].includes(exactEventName)) {
    const safeRefName = safeGitBranch(refName, "refName");
    return {
      ref:
        safeRefName === safeProductionBranch
          ? safeProductionBranch
          : safeDeploymentBranch,
      source:
        safeRefName === safeProductionBranch
          ? "workflow-production"
          : "workflow-development",
    };
  }
  throw new Error(`Unsupported GitHub event ${exactEventName || "<empty>"}.`);
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("reference-platform-ref.mjs accepts no arguments.");
  }
  const result = selectOfficialPlatformRef({
    eventName: environmentValue("SUPERBOARD_GITHUB_EVENT_NAME"),
    refName: environmentValue("SUPERBOARD_GITHUB_REF_NAME"),
    baseRef: environmentValue("SUPERBOARD_GITHUB_BASE_REF"),
    dispatchPlatformSha: environmentValue("SUPERBOARD_DISPATCH_PLATFORM_SHA"),
    deploymentBranch: environmentValue("SUPERBOARD_DEPLOYMENT_BRANCH"),
    productionBranch: environmentValue("SUPERBOARD_PRODUCTION_BRANCH"),
    historyBridgeValidated:
      environmentValue("SUPERBOARD_HISTORY_BRIDGE_VALIDATED"),
  });
  process.stdout.write(`ref=${result.ref}\n`);
  process.stdout.write(`source=${result.source}\n`);
}

function environmentValue(canonicalName) {
  const legacyName = canonicalName.replace(/^SUPERBOARD_/u, "OPENGROW_");
  return process.env[canonicalName] ?? process.env[legacyName] ?? "";
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
