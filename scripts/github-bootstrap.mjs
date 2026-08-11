#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GITHUB_REST_API_VERSION,
  githubJsonRequest,
  repositorySettingsBody,
  runGitHubMutation,
} from "./github-api.mjs";
import { loadGitHubControlPlane } from "./github-readiness.mjs";

export function inspectRepositoryAvailability(
  repository,
  run = runGitHubAvailability,
) {
  const result = run([
    "api",
    "--include",
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    `X-GitHub-Api-Version: ${GITHUB_REST_API_VERSION}`,
    `repos/${repository.nameWithOwner}`,
  ]);
  if (result?.ok) {
    return {
      nameWithOwner: repository.nameWithOwner,
      status: "present",
    };
  }
  if (result?.httpStatus === 404) {
    return {
      nameWithOwner: repository.nameWithOwner,
      status: "missing-or-inaccessible",
    };
  }
  return {
    nameWithOwner: repository.nameWithOwner,
    status: "inspection-failed",
  };
}

export function buildGitHubBootstrapPlan(manifest, inspections) {
  const byName = new Map(
    inspections.map((inspection) => [inspection.nameWithOwner, inspection]),
  );
  const repositories = Object.values(manifest.repositories).map(
    (repository) => {
      const state = byName.get(repository.nameWithOwner);
      if (!state) {
        return {
          nameWithOwner: repository.nameWithOwner,
          state: "not-inspected",
          operations: [],
          blockers: [
            {
              type: "repository-not-inspected",
              message:
                "The repository must be inspected before a creation plan is safe.",
            },
          ],
        };
      }
      if (state.status === "missing-or-inaccessible") {
        return {
          nameWithOwner: repository.nameWithOwner,
          state: "missing-or-inaccessible",
          operations: [
            {
              type: "create-repository",
              nameWithOwner: repository.nameWithOwner,
              description: repository.description,
              visibility: repository.visibility,
              settings: repository.settings,
            },
          ],
          blockers: [],
          warning:
            "An HTTP 404 can represent a missing repository or an inaccessible path. A confirmed creation fails safely without overwriting a repository whose name already exists.",
        };
      }
      if (state.status !== "present") {
        return {
          nameWithOwner: repository.nameWithOwner,
          state: state.status,
          operations: [],
          blockers: [
            {
              type: "repository-inspection-failed",
              message:
                "GitHub availability was not established by a successful response or an explicit HTTP 404; no creation is safe.",
            },
          ],
        };
      }
      return {
        nameWithOwner: repository.nameWithOwner,
        state: "present",
        operations: [],
        blockers: [],
      };
    },
  );
  const plan = {
    mode: "remote-bootstrap-plan",
    schemaVersion: manifest.schemaVersion,
    apiVersion: GITHUB_REST_API_VERSION,
    ready: repositories.every(
      (repository) =>
        repository.operations.length === 0 && repository.blockers.length === 0,
    ),
    repositories,
  };
  return { ...plan, confirmation: githubBootstrapConfirmation(plan) };
}

export function githubBootstrapConfirmation(plan) {
  const operations = plan.repositories
    .flatMap((repository) => repository.operations)
    .map((operation) => ({
      type: operation.type,
      nameWithOwner: operation.nameWithOwner,
      description: operation.description,
      visibility: operation.visibility,
      settings: Object.fromEntries(
        Object.entries(operation.settings || {}).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    }))
    .sort((left, right) =>
      left.nameWithOwner.localeCompare(right.nameWithOwner),
    );
  const digest = createHash("sha256")
    .update(JSON.stringify({ schemaVersion: plan.schemaVersion, operations }))
    .digest("hex")
    .slice(0, 12);
  return `GITHUB:BOOTSTRAP:${plan.schemaVersion}:${digest}`;
}

export function repositoryCreationRequest(repository, owner) {
  const [repositoryOwner, name, extra] = repository.nameWithOwner.split("/");
  if (!repositoryOwner || !name || extra) {
    throw new Error(`Invalid repository name ${repository.nameWithOwner}`);
  }
  if (!owner || owner.login !== repositoryOwner) {
    throw new Error(
      `Repository owner mismatch for ${repository.nameWithOwner}`,
    );
  }
  if (!new Set(["public", "private"]).has(repository.visibility)) {
    throw new Error(
      `Unsupported repository visibility ${repository.visibility}`,
    );
  }
  const endpoint =
    owner.type === "user"
      ? "user/repos"
      : owner.type === "organization"
        ? `orgs/${owner.login}/repos`
        : null;
  if (!endpoint) {
    throw new Error(`Unsupported GitHub owner type ${owner.type}`);
  }
  return githubJsonRequest("POST", endpoint, {
    name,
    ...repositorySettingsBody(repository),
    visibility: repository.visibility,
    auto_init: false,
  });
}

export function applyGitHubBootstrapPlan(
  plan,
  manifest,
  { confirm, run = runGitHubMutation } = {},
) {
  if (confirm !== plan.confirmation) {
    throw new Error(
      `Refusing GitHub repository creation: pass --confirm ${plan.confirmation}`,
    );
  }
  const blockers = plan.repositories.flatMap(
    (repository) => repository.blockers,
  );
  if (blockers.length > 0) {
    throw new Error(
      "Refusing GitHub repository creation while inspection blockers remain",
    );
  }
  const repositories = new Map(
    Object.values(manifest.repositories).map((repository) => [
      repository.nameWithOwner,
      repository,
    ]),
  );
  const applied = [];
  for (const repositoryPlan of plan.repositories) {
    for (const operation of repositoryPlan.operations) {
      if (operation.type !== "create-repository") {
        throw new Error(
          `Unsupported GitHub bootstrap operation: ${operation.type}`,
        );
      }
      const repository = repositories.get(operation.nameWithOwner);
      if (!repository) {
        throw new Error(`Unknown repository ${operation.nameWithOwner}`);
      }
      const request = repositoryCreationRequest(repository, manifest.owner);
      const result = run(request.args, request.body);
      if (!result?.ok) {
        throw new Error(
          `GitHub repository creation failed for ${repository.nameWithOwner}; verify owner administration access and whether the name already exists`,
        );
      }
      applied.push({
        repository: repository.nameWithOwner,
        type: operation.type,
      });
    }
  }
  return applied;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function runGitHubAvailability(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const diagnostic = `${result.stdout || ""}\n${result.stderr || ""}`;
  const status = diagnostic.match(/(?:HTTP\/\S+\s+|HTTP\s+)(\d{3})/u);
  return {
    ok: result.status === 0,
    httpStatus: status ? Number(status[1]) : null,
  };
}

async function main() {
  const manifest = await loadGitHubControlPlane();
  const inspections = Object.values(manifest.repositories).map((repository) =>
    inspectRepositoryAvailability(repository),
  );
  const plan = buildGitHubBootstrapPlan(manifest, inspections);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!process.argv.includes("--apply")) {
    if (!plan.ready) process.exitCode = 2;
    return;
  }
  const applied = applyGitHubBootstrapPlan(plan, manifest, {
    confirm: optionValue("--confirm"),
  });
  process.stdout.write(
    `${JSON.stringify({ mode: "applied", applied }, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
