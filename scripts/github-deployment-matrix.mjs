#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function loadDeploymentMatrix() {
  const configuration = await readJson(
    resolve(root, "config", "cloudflare-deployments.json"),
  );
  validateDeploymentConfiguration(configuration);
  validateDeploymentUniqueness(configuration.deployments);
  return configuration;
}

export function validateDeploymentConfiguration(configuration) {
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration) ||
    configuration.schemaVersion !== 3 ||
    !Array.isArray(configuration.deployments) ||
    configuration.deployments.length === 0
  ) {
    throw new Error("Invalid Cloudflare deployment matrix root");
  }
  const rootKeys = Object.keys(configuration).filter(
    (key) => key !== "$schema",
  );
  if (
    rootKeys.length !== 2 ||
    !rootKeys.includes("schemaVersion") ||
    !rootKeys.includes("deployments")
  ) {
    throw new Error(
      "Cloudflare deployment matrix contains unknown root fields",
    );
  }
  const safeName = /^[a-z][a-z0-9-]{1,62}$/u;
  const targetName = /^[a-z][a-z0-9-]{1,30}$/u;
  const expectedKeys = [
    "automaticDeployment",
    "branch",
    "cloudflareEnvironment",
    "githubEnvironment",
    "id",
    "referenceAcceptance",
    "target",
  ];
  for (const deployment of configuration.deployments) {
    if (
      !deployment ||
      typeof deployment !== "object" ||
      Array.isArray(deployment) ||
      JSON.stringify(Object.keys(deployment).sort()) !==
        JSON.stringify(expectedKeys)
    ) {
      throw new Error("Cloudflare deployment entry has an invalid shape");
    }
    if (
      !safeName.test(deployment.id) ||
      !safeName.test(deployment.githubEnvironment) ||
      !targetName.test(deployment.target)
    ) {
      throw new Error("Cloudflare deployment names are invalid");
    }
    if (!new Set(["dev", "main"]).has(deployment.branch)) {
      throw new Error("Cloudflare deployment branch is invalid");
    }
    if (
      !new Set(["development", "production"]).has(
        deployment.cloudflareEnvironment,
      )
    ) {
      throw new Error("Cloudflare environment is invalid");
    }
    const expectedEnvironment =
      deployment.branch === "dev" ? "development" : "production";
    if (deployment.cloudflareEnvironment !== expectedEnvironment) {
      throw new Error(
        `${deployment.branch} must deploy only ${expectedEnvironment}`,
      );
    }
    const authority = deployment.automaticDeployment?.authority;
    if (
      !new Set(["cloudflare-workers-builds", "github-actions"]).has(authority)
    ) {
      throw new Error("Cloudflare deployment authority is invalid");
    }
    if (authority === "cloudflare-workers-builds") {
      const expectedBuildCommand =
        "git clone --depth 1 --branch dev https://github.com/mbzadev/superboard-reference.git ../superboard-reference && node --test scripts/backoffice-policy.test.mjs scripts/github-deployment-matrix.test.mjs scripts/github-deployment-workflow.test.mjs && npm run cloudflare:test:services && npm run typecheck && npm test && npm run custom:check";
      const expectedDeployCommand =
        'npm run cloudflare:deploy:all -- --target "$SUPERBOARD_TARGET" --environment "$SUPERBOARD_ENVIRONMENT"';
      const expectedBuildVariables = [
        "CLOUDFLARE_ACCOUNT_ID",
        "SUPERBOARD_ENVIRONMENT",
        "SUPERBOARD_TARGET",
      ];
      if (
        deployment.branch !== "dev" ||
        deployment.cloudflareEnvironment !== "development" ||
        deployment.automaticDeployment.controllerService !== "dashboard" ||
        deployment.automaticDeployment.buildCommand !== expectedBuildCommand ||
        deployment.automaticDeployment.deployCommand !==
          expectedDeployCommand ||
        JSON.stringify(deployment.automaticDeployment.buildVariables) !==
          JSON.stringify(expectedBuildVariables) ||
        deployment.automaticDeployment.nonProductionBranchBuilds !== false ||
        Object.keys(deployment.automaticDeployment).length !== 6
      ) {
        throw new Error(
          "Cloudflare Workers Builds must be the single dashboard-controlled development authority",
        );
      }
    } else if (Object.keys(deployment.automaticDeployment).length !== 1) {
      throw new Error(
        "GitHub Actions deployment authority contains unsupported settings",
      );
    }
    if (typeof deployment.referenceAcceptance !== "boolean") {
      throw new Error("referenceAcceptance must be boolean");
    }
    if (deployment.referenceAcceptance && deployment.branch !== "dev") {
      throw new Error("Reference acceptance must belong to a dev deployment");
    }
  }
  return true;
}

export function selectDeployments(configuration, branch, { authority } = {}) {
  if (!new Set(["dev", "main"]).has(branch)) {
    throw new Error("Deployment branch must be dev or main");
  }
  if (
    authority != null &&
    !new Set(["cloudflare-workers-builds", "github-actions"]).has(authority)
  ) {
    throw new Error("Deployment authority is invalid");
  }
  const branchDeployments = configuration.deployments.filter(
    (deployment) => deployment.branch === branch,
  );
  if (branchDeployments.length === 0) {
    throw new Error(`No Cloudflare deployment is declared for ${branch}`);
  }
  const deployments = authority
    ? branchDeployments.filter(
        (deployment) => deployment.automaticDeployment.authority === authority,
      )
    : branchDeployments;
  if (deployments.length === 0) {
    throw new Error(
      `No ${authority} Cloudflare deployment is declared for ${branch}`,
    );
  }
  const reference = deployments.filter(
    (deployment) => deployment.referenceAcceptance,
  );
  if (reference.length > 1) {
    throw new Error(
      `${branch} declares more than one reference acceptance environment`,
    );
  }
  return {
    schemaVersion: configuration.schemaVersion,
    branch,
    matrix: {
      include: deployments.map((deployment) => ({
        id: deployment.id,
        target: deployment.target,
        deploymentAuthority: deployment.automaticDeployment.authority,
        githubEnvironment: deployment.githubEnvironment,
        cloudflareEnvironment: deployment.cloudflareEnvironment,
      })),
    },
    referenceEnvironment: reference[0]?.githubEnvironment ?? "",
  };
}

export function resolveDeploymentBranch({
  explicitBranch,
  githubRefName,
  currentBranch,
}) {
  const branch = String(
    explicitBranch || githubRefName || currentBranch || "",
  ).trim();
  if (!new Set(["dev", "main"]).has(branch)) {
    throw new Error(
      "Deployment branch must be dev or main; pass --branch or run from one of those branches",
    );
  }
  return branch;
}

export function validateControlPlaneCoverage(configuration, controlPlane) {
  const platformEnvironments =
    controlPlane.repositories?.platform?.environments ?? {};
  for (const deployment of configuration.deployments) {
    const environment = platformEnvironments[deployment.githubEnvironment];
    if (!environment) {
      throw new Error(
        `${deployment.id} references undeclared GitHub Environment ${deployment.githubEnvironment}`,
      );
    }
    if (environment.variables?.SUPERBOARD_TARGET == null) {
      throw new Error(
        `${deployment.githubEnvironment} must define SUPERBOARD_TARGET`,
      );
    }
    if (environment.variables.SUPERBOARD_TARGET !== deployment.target) {
      throw new Error(
        `${deployment.githubEnvironment} SUPERBOARD_TARGET must equal the versioned deployment target ${deployment.target}`,
      );
    }
    const cloudflareCredentialNames = [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
    ];
    if (deployment.automaticDeployment.authority === "github-actions") {
      for (const name of cloudflareCredentialNames) {
        if (!environment.secrets?.includes(name)) {
          throw new Error(
            `${deployment.githubEnvironment} must declare ${name}`,
          );
        }
      }
    } else {
      for (const name of cloudflareCredentialNames) {
        if (environment.secrets?.includes(name)) {
          throw new Error(
            `${deployment.githubEnvironment} must not declare ${name}; Cloudflare Workers Builds owns development deployment credentials`,
          );
        }
      }
    }
    if (
      deployment.cloudflareEnvironment === "production" &&
      !environment.secrets?.includes("SUPERBOARD_BACKUP_ENCRYPTION_KEY")
    ) {
      throw new Error(
        `${deployment.githubEnvironment} must declare SUPERBOARD_BACKUP_ENCRYPTION_KEY`,
      );
    }
  }
  return true;
}

function validateDeploymentUniqueness(deployments) {
  const ids = new Set();
  const environments = new Set();
  let referenceAcceptances = 0;
  for (const deployment of deployments) {
    if (ids.has(deployment.id)) {
      throw new Error(`Duplicate Cloudflare deployment id: ${deployment.id}`);
    }
    ids.add(deployment.id);
    if (environments.has(deployment.githubEnvironment)) {
      throw new Error(
        `GitHub Environment belongs to more than one deployment: ${deployment.githubEnvironment}`,
      );
    }
    environments.add(deployment.githubEnvironment);
    if (deployment.referenceAcceptance) referenceAcceptances += 1;
  }
  if (referenceAcceptances !== 1) {
    throw new Error(
      "Cloudflare deployment matrix must declare exactly one reference acceptance Environment",
    );
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArgs();
  const branch = resolveDeploymentBranch({
    explicitBranch: args.branch,
    githubRefName: process.env.GITHUB_REF_NAME,
    currentBranch: currentGitBranch(),
  });
  const configuration = await loadDeploymentMatrix();
  const controlPlane = await readJson(
    resolve(root, "config", "github-control-plane.json"),
  );
  validateControlPlaneCoverage(configuration, controlPlane);
  process.stdout.write(
    `${JSON.stringify(
      selectDeployments(configuration, branch, { authority: args.authority }),
    )}\n`,
  );
}

function currentGitBranch() {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
