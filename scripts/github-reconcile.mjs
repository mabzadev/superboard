import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  githubJsonRequest,
  repositorySettingsBody,
  runGitHubMutation,
} from "./github-api.mjs";
import {
  inspectRepository,
  loadGitHubControlPlane,
} from "./github-readiness.mjs";

export function reconciliationConfirmation(plan, manifest) {
  const mutations = plan.repositories
    .flatMap((repositoryPlan) => {
      const repository = Object.values(manifest.repositories).find(
        (candidate) => candidate.nameWithOwner === repositoryPlan.nameWithOwner,
      );
      if (!repository) return [];
      return repositoryPlan.operations.map((operation) => {
        const request = mutationRequest(repository, operation);
        return {
          repository: repository.nameWithOwner,
          operation: operation.type,
          args: request.args,
          body: request.body,
        };
      });
    })
    .sort((left, right) =>
      `${left.repository}:${left.operation}`.localeCompare(
        `${right.repository}:${right.operation}`,
      ),
    );
  const schemaVersion = plan.schemaVersion ?? manifest.schemaVersion;
  const digest = createHash("sha256")
    .update(JSON.stringify({ schemaVersion, mutations }))
    .digest("hex")
    .slice(0, 12);
  return `GITHUB:RECONCILE:${schemaVersion}:${digest}`;
}

export function buildGitHubReconcilePlan(manifest, inspections) {
  const byName = new Map(
    inspections.map((inspection) => [inspection.nameWithOwner, inspection]),
  );
  const repositories = Object.values(manifest.repositories).map(
    (repository) => {
      const state = byName.get(repository.nameWithOwner);
      const operations = [];
      const blockers = [];
      const manual = [];

      if (!state || state.status === "missing-or-inaccessible") {
        blockers.push({
          type: "repository-access",
          message:
            "Create the declared repository or grant administration access, then push its dev branch.",
        });
        return {
          nameWithOwner: repository.nameWithOwner,
          operations,
          blockers,
          manual,
        };
      }

      if (
        !Array.isArray(state.branches) ||
        !Array.isArray(state.environments) ||
        typeof state.settingsMatch !== "boolean" ||
        typeof state.workflowPermissionsMatch !== "boolean"
      ) {
        blockers.push({
          type: "remote-state",
          message:
            "GitHub returned an incomplete repository response; no mutation is safe.",
        });
        return {
          nameWithOwner: repository.nameWithOwner,
          operations,
          blockers,
          manual,
        };
      }

      if (state.visibility !== repository.visibility) {
        blockers.push({
          type: "repository-visibility",
          expected: repository.visibility,
          actual: state.visibility,
        });
      }
      if (!state.settingsMatch) {
        operations.push({ type: "update-repository-settings" });
      }
      if (!state.workflowPermissionsMatch) {
        operations.push({ type: "set-workflow-permissions" });
      }

      const branches = new Map(
        state.branches.map((branch) => [branch.name, branch]),
      );
      for (const [branchName, policy] of Object.entries(repository.branches)) {
        const branch = branches.get(branchName);
        if (!branch?.exists) {
          blockers.push({
            type: "missing-branch",
            branch: branchName,
            message: "Push this branch before reconciling branch protection.",
          });
        } else if (!branch.protectionMatches) {
          operations.push({
            type: "put-branch-protection",
            branch: branchName,
            requiredCheck: policy.requiredCheck,
            requiredApprovals: policy.requiredApprovals,
            requireCodeOwnerReviews: policy.requireCodeOwnerReviews,
          });
        }
      }

      if (state.defaultBranch !== repository.defaultBranch) {
        if (branches.get(repository.defaultBranch)?.exists) {
          operations.push({
            type: "set-default-branch",
            branch: repository.defaultBranch,
          });
        } else {
          blockers.push({
            type: "default-branch-unavailable",
            branch: repository.defaultBranch,
          });
        }
      }

      const environments = new Map(
        state.environments.map((environment) => [
          environment.name,
          environment,
        ]),
      );
      for (const [environmentName, expected] of Object.entries(
        repository.environments,
      )) {
        const environment = environments.get(environmentName);
        if (!environment?.exists) {
          operations.push({
            type: "put-environment",
            environment: environmentName,
          });
        }
        const variables = new Map(
          (environment?.variables || []).map((variable) => [
            variable.name,
            variable,
          ]),
        );
        for (const variableName of Object.keys(expected.variables)) {
          const variable = variables.get(variableName);
          if (!variable?.configured) {
            operations.push({
              type: variable?.exists
                ? "update-environment-variable"
                : "create-environment-variable",
              environment: environmentName,
              name: variableName,
            });
          }
        }
        for (const secret of environment?.secrets ||
          expected.secrets.map((name) => ({ name, configured: false }))) {
          if (!secret.configured) {
            manual.push({
              type: "set-environment-secret",
              environment: environmentName,
              name: secret.name,
            });
          }
        }
      }

      for (const secret of state.repositorySecrets ||
        repository.repositorySecrets.map((name) => ({
          name,
          configured: false,
        }))) {
        if (!secret.configured)
          manual.push({ type: "set-repository-secret", name: secret.name });
      }

      return {
        nameWithOwner: repository.nameWithOwner,
        operations,
        blockers,
        manual,
      };
    },
  );

  const plan = {
    mode: "remote-reconciliation-plan",
    schemaVersion: manifest.schemaVersion,
    ready: repositories.every(
      (repository) =>
        repository.operations.length === 0 &&
        repository.blockers.length === 0 &&
        repository.manual.length === 0,
    ),
    repositories,
  };
  return { ...plan, confirmation: reconciliationConfirmation(plan, manifest) };
}

export function applyGitHubReconcilePlan(
  plan,
  manifest,
  { confirm, run = runGitHubMutation } = {},
) {
  const expected = reconciliationConfirmation(plan, manifest);
  if (confirm !== expected) {
    throw new Error(`Refusing GitHub mutation: pass --confirm ${expected}`);
  }
  const blockers = plan.repositories.flatMap(
    (repository) => repository.blockers,
  );
  if (blockers.length > 0) {
    throw new Error(
      "Refusing partial GitHub mutation while structural blockers remain",
    );
  }

  const applied = [];
  for (const repositoryPlan of plan.repositories) {
    const repository = Object.values(manifest.repositories).find(
      (candidate) => candidate.nameWithOwner === repositoryPlan.nameWithOwner,
    );
    if (!repository)
      throw new Error(`Unknown repository ${repositoryPlan.nameWithOwner}`);
    for (const operation of repositoryPlan.operations) {
      const request = mutationRequest(repository, operation);
      const result = run(request.args, request.body);
      if (!result?.ok) {
        throw new Error(
          `GitHub reconciliation failed for ${repository.nameWithOwner}: ${operation.type}`,
        );
      }
      applied.push({
        repository: repository.nameWithOwner,
        type: operation.type,
        branch: operation.branch,
        environment: operation.environment,
        name: operation.name,
      });
    }
  }
  return applied;
}

export function mutationRequest(repository, operation) {
  const base = `repos/${repository.nameWithOwner}`;
  switch (operation.type) {
    case "update-repository-settings":
      return githubJsonRequest(
        "PATCH",
        base,
        repositorySettingsBody(repository),
      );
    case "set-default-branch":
      return githubJsonRequest("PATCH", base, {
        default_branch: operation.branch,
      });
    case "set-workflow-permissions":
      return githubJsonRequest("PUT", `${base}/actions/permissions/workflow`, {
        default_workflow_permissions: repository.workflowPermissions.default,
        can_approve_pull_request_reviews:
          repository.workflowPermissions.canApprovePullRequestReviews,
      });
    case "put-branch-protection":
      return githubJsonRequest(
        "PUT",
        `${base}/branches/${operation.branch}/protection`,
        {
          required_status_checks: {
            strict: true,
            contexts: [operation.requiredCheck],
          },
          enforce_admins: true,
          required_pull_request_reviews: {
            dismiss_stale_reviews: true,
            require_code_owner_reviews:
              operation.requireCodeOwnerReviews === true,
            required_approving_review_count: operation.requiredApprovals,
            require_last_push_approval: false,
          },
          restrictions: null,
          required_linear_history: true,
          allow_force_pushes: false,
          allow_deletions: false,
          required_conversation_resolution: true,
        },
      );
    case "put-environment":
      return githubJsonRequest(
        "PUT",
        `${base}/environments/${operation.environment}`,
        {},
      );
    case "create-environment-variable":
    case "update-environment-variable": {
      const value =
        repository.environments[operation.environment]?.variables[
          operation.name
        ];
      if (typeof value !== "string") {
        throw new Error(
          `Unknown GitHub variable ${operation.environment}/${operation.name}`,
        );
      }
      const method =
        operation.type === "create-environment-variable" ? "POST" : "PATCH";
      const suffix = method === "PATCH" ? `/${operation.name}` : "";
      return githubJsonRequest(
        method,
        `${base}/environments/${operation.environment}/variables${suffix}`,
        { name: operation.name, value },
      );
    }
    default:
      throw new Error(
        `Unsupported GitHub reconciliation operation: ${operation.type}`,
      );
  }
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const manifest = await loadGitHubControlPlane();
  const inspections = Object.values(manifest.repositories).map((repository) =>
    inspectRepository(repository),
  );
  const plan = buildGitHubReconcilePlan(manifest, inspections);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!process.argv.includes("--apply")) {
    if (!plan.ready) process.exitCode = 2;
    return;
  }

  const applied = applyGitHubReconcilePlan(plan, manifest, {
    confirm: optionValue("--confirm"),
  });
  process.stdout.write(
    `${JSON.stringify({ mode: "applied", applied }, null, 2)}\n`,
  );
  if (plan.repositories.some((repository) => repository.manual.length > 0))
    process.exitCode = 2;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
