import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildReferenceCiMetadata } from "./reference-ci-metadata.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const developmentDeploymentDispatchAction = "platform-dev-updated";

function isExactString(value) {
  return typeof value === "string" && value.trim() === value;
}

export function evaluateDevelopmentDeploymentGate({
  eventName,
  refName,
  dispatchAction = "",
  defaultBranch = "",
  deploymentBranch,
}) {
  if (
    !isExactString(deploymentBranch) ||
    !/^[A-Za-z0-9._/-]+$/u.test(deploymentBranch)
  ) {
    throw new Error("deploymentBranch must be a safe, non-empty Git branch name.");
  }

  if (![eventName, refName, dispatchAction, defaultBranch].every(isExactString)) {
    throw new Error("GitHub deployment gate inputs must be exact strings.");
  }

  if (eventName === "push") {
    return {
      eligible: refName === deploymentBranch,
      reason:
        refName === deploymentBranch
          ? "push-development-branch"
          : "push-outside-development-branch",
    };
  }

  if (eventName === "repository_dispatch") {
    const eligible =
      dispatchAction === developmentDeploymentDispatchAction &&
      defaultBranch === deploymentBranch;
    return {
      eligible,
      reason: eligible
        ? "authorized-development-dispatch"
        : "unauthorized-development-dispatch",
    };
  }

  return { eligible: false, reason: "non-deployment-event" };
}

async function run() {
  if (process.argv.length !== 2) {
    throw new Error("reference-deployment-gate.mjs accepts no arguments.");
  }

  const project = JSON.parse(
    await readFile(path.join(root, "reference.project.json"), "utf8"),
  );
  const { deployment_branch: deploymentBranch } =
    buildReferenceCiMetadata(project);
  const decision = evaluateDevelopmentDeploymentGate({
    eventName: process.env.OPENGROW_GITHUB_EVENT_NAME ?? "",
    refName: process.env.OPENGROW_GITHUB_REF_NAME ?? "",
    dispatchAction: process.env.OPENGROW_GITHUB_EVENT_ACTION ?? "",
    defaultBranch: process.env.OPENGROW_GITHUB_DEFAULT_BRANCH ?? "",
    deploymentBranch,
  });

  process.stdout.write(`eligible=${decision.eligible ? "true" : "false"}\n`);
  process.stdout.write(`reason=${decision.reason}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  run().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
