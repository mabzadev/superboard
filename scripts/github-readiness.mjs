import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  GITHUB_REST_API_VERSION,
  repositorySettingsMatch,
  repositorySettingsState,
} from "./github-api.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

export async function loadGitHubControlPlane() {
  const manifest = JSON.parse(
    await readFile(resolve(root, "config/github-control-plane.json"), "utf8"),
  );
  const schema = JSON.parse(
    await readFile(
      resolve(root, "schemas/github-control-plane.schema.json"),
      "utf8",
    ),
  );
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  if (!validate(manifest)) {
    throw new Error(
      `Invalid GitHub control-plane manifest: ${JSON.stringify(validate.errors)}`,
    );
  }
  return manifest;
}

export function readinessPlan(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    repositories: Object.fromEntries(
      Object.entries(manifest.repositories).map(([role, repository]) => [
        role,
        {
          nameWithOwner: repository.nameWithOwner,
          description: repository.description,
          settings: repository.settings,
          workflowPermissions: repository.workflowPermissions,
          visibility: repository.visibility,
          defaultBranch: repository.defaultBranch,
          branches: Object.entries(repository.branches).map(
            ([name, policy]) => ({
              name,
              requiredCheck: policy.requiredCheck,
              requirePullRequest: policy.requirePullRequest,
              requiredApprovals: policy.requiredApprovals,
            }),
          ),
          environments: Object.entries(repository.environments).map(
            ([name, environment]) => ({
              name,
              variables: Object.keys(environment.variables).sort(),
              secrets: [...environment.secrets].sort(),
            }),
          ),
          repositorySecrets: [...repository.repositorySecrets].sort(),
        },
      ]),
    ),
  };
}

export function inspectRepository(repository, run = runGh) {
  const view = run([
    "api",
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    `X-GitHub-Api-Version: ${GITHUB_REST_API_VERSION}`,
    `repos/${repository.nameWithOwner}`,
  ]);
  if (!view.ok) {
    return {
      nameWithOwner: repository.nameWithOwner,
      status: "missing-or-inaccessible",
      ready: false,
    };
  }

  const details = resultJson(view);
  if (!details) {
    return {
      nameWithOwner: repository.nameWithOwner,
      status: "invalid-remote-response",
      ready: false,
    };
  }
  const settingsMatch = repositorySettingsMatch(repository, details);
  const workflowPermissionsPayload = resultJson(
    run([
      "api",
      `repos/${repository.nameWithOwner}/actions/permissions/workflow`,
    ]),
  );
  const workflowPermissions = {
    default: workflowPermissionsPayload?.default_workflow_permissions || null,
    canApprovePullRequestReviews:
      workflowPermissionsPayload?.can_approve_pull_request_reviews === true,
  };
  const workflowPermissionsMatch =
    workflowPermissions.default === repository.workflowPermissions.default &&
    workflowPermissions.canApprovePullRequestReviews ===
      repository.workflowPermissions.canApprovePullRequestReviews;

  const branches = Object.entries(repository.branches).map(
    ([name, expected]) => {
      const branch = run([
        "api",
        `repos/${repository.nameWithOwner}/branches/${name}`,
      ]);
      const protectionResult = branch.ok
        ? run([
            "api",
            `repos/${repository.nameWithOwner}/branches/${name}/protection`,
          ])
        : { ok: false, stdout: "" };
      const protection = resultJson(protectionResult);
      const requiredChecks = new Set([
        ...(protection?.required_status_checks?.contexts || []),
        ...(protection?.required_status_checks?.checks || []).map(
          (check) => check.context,
        ),
      ]);
      const approvals = Number(
        protection?.required_pull_request_reviews
          ?.required_approving_review_count || 0,
      );
      const codeOwnerReviews =
        protection?.required_pull_request_reviews
          ?.require_code_owner_reviews === true;
      const secureSettingsMatch =
        protection?.required_status_checks?.strict === true &&
        protection?.enforce_admins?.enabled === true &&
        protection?.required_pull_request_reviews?.dismiss_stale_reviews ===
          true &&
        protection?.required_linear_history?.enabled === true &&
        protection?.allow_force_pushes?.enabled === false &&
        protection?.allow_deletions?.enabled === false &&
        protection?.required_conversation_resolution?.enabled === true;
      const policyMatches =
        protectionResult.ok &&
        requiredChecks.has(expected.requiredCheck) &&
        (!expected.requirePullRequest ||
          approvals >= expected.requiredApprovals) &&
        (!expected.requireCodeOwnerReviews || codeOwnerReviews) &&
        secureSettingsMatch;
      return {
        name,
        exists: branch.ok,
        protectionMatches: policyMatches,
        requiredCheckPresent: requiredChecks.has(expected.requiredCheck),
        approvalsMatch:
          !expected.requirePullRequest ||
          approvals >= expected.requiredApprovals,
        codeOwnerReviewsMatch:
          !expected.requireCodeOwnerReviews || codeOwnerReviews,
        secureSettingsMatch,
      };
    },
  );
  const environmentResult = run([
    "api",
    `repos/${repository.nameWithOwner}/environments`,
  ]);
  const environmentPayload = resultJson(environmentResult);
  const existingEnvironments = environmentPayload
    ? new Set(
        (environmentPayload.environments || []).map((entry) => entry.name),
      )
    : new Set();
  const environments = Object.entries(repository.environments).map(
    ([name, expected]) => {
      const exists = existingEnvironments.has(name);
      const variablesPayload = exists
        ? resultJson(
            run([
              "api",
              `repos/${repository.nameWithOwner}/environments/${name}/variables`,
            ]),
          )
        : null;
      const secretsPayload = exists
        ? resultJson(
            run([
              "api",
              `repos/${repository.nameWithOwner}/environments/${name}/secrets`,
            ]),
          )
        : null;
      const remoteVariables = new Map(
        (variablesPayload?.variables || []).map((variable) => [
          variable.name,
          String(variable.value),
        ]),
      );
      const remoteSecrets = new Set(
        (secretsPayload?.secrets || []).map((secret) => secret.name),
      );
      const variables = Object.entries(expected.variables).map(
        ([variableName, expectedValue]) => ({
          name: variableName,
          exists: remoteVariables.has(variableName),
          configured: remoteVariables.get(variableName) === expectedValue,
        }),
      );
      const secrets = expected.secrets.map((secretName) => ({
        name: secretName,
        configured: remoteSecrets.has(secretName),
      }));
      return {
        name,
        exists,
        variables,
        secrets,
        ready:
          exists &&
          variables.every((variable) => variable.configured) &&
          secrets.every((secret) => secret.configured),
      };
    },
  );
  const repositorySecretsPayload = repository.repositorySecrets.length
    ? resultJson(
        run(["api", `repos/${repository.nameWithOwner}/actions/secrets`]),
      )
    : { secrets: [] };
  const remoteRepositorySecrets = new Set(
    (repositorySecretsPayload?.secrets || []).map((secret) => secret.name),
  );
  const repositorySecrets = repository.repositorySecrets.map((name) => ({
    name,
    configured: remoteRepositorySecrets.has(name),
  }));
  const ready =
    details.visibility?.toLowerCase() === repository.visibility &&
    details.default_branch === repository.defaultBranch &&
    settingsMatch &&
    workflowPermissionsMatch &&
    branches.every((branch) => branch.exists && branch.protectionMatches) &&
    environments.every((environment) => environment.ready) &&
    repositorySecrets.every((secret) => secret.configured);

  return {
    nameWithOwner: repository.nameWithOwner,
    status: ready ? "ready" : "incomplete",
    ready,
    visibility: details.visibility?.toLowerCase() || null,
    defaultBranch: details.default_branch || null,
    ...repositorySettingsState(details),
    settingsMatch,
    workflowPermissions,
    workflowPermissionsMatch,
    branches,
    environments,
    repositorySecrets,
    note: "Secret values are never requested or returned; only configured names are compared.",
  };
}

function resultJson(result) {
  if (!result?.ok) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function runGh(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ok: result.status === 0, stdout: result.stdout || "" };
}

async function main() {
  const manifest = await loadGitHubControlPlane();
  const plan = readinessPlan(manifest);
  if (!process.argv.includes("--remote")) {
    process.stdout.write(
      `${JSON.stringify({ mode: "offline-plan", ...plan }, null, 2)}\n`,
    );
    return;
  }

  const repositories = Object.values(manifest.repositories).map((repository) =>
    inspectRepository(repository),
  );
  const ready = repositories.every((repository) => repository.ready);
  process.stdout.write(
    `${JSON.stringify({ mode: "remote-read-only", ready, repositories }, null, 2)}\n`,
  );
  if (!ready) process.exitCode = 2;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
