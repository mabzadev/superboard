import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectRepository,
  loadGitHubControlPlane,
  readinessPlan,
} from "./github-readiness.mjs";

const repositoryApiPrefix =
  "api -H Accept: application/vnd.github+json -H X-GitHub-Api-Version: 2026-03-10";

function settings() {
  return {
    issues: true,
    projects: false,
    wiki: false,
    downloads: false,
    squashMerge: true,
    mergeCommit: false,
    rebaseMerge: false,
    deleteBranchOnMerge: true,
  };
}

function workflowPermissions() {
  return {
    default: "read",
    canApprovePullRequestReviews: true,
  };
}

function repositoryPayload(name, overrides = {}) {
  return {
    full_name: name,
    description: "OpenGrow test repository",
    visibility: "public",
    default_branch: "dev",
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    has_downloads: false,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
    ...overrides,
  };
}

test("GitHub control-plane manifest is strict and contains names, never secret values", async () => {
  const manifest = await loadGitHubControlPlane();
  const serialized = JSON.stringify(manifest);
  assert.equal(manifest.schemaVersion, 5);
  assert.deepEqual(manifest.owner, { login: "mbzadev", type: "user" });
  assert.equal(
    manifest.repositories.platform.nameWithOwner,
    "mbzadev/opengrow-platform",
  );
  assert.match(manifest.repositories.platform.description, /OpenGrow/u);
  assert.deepEqual(manifest.repositories.platform.settings, settings());
  assert.deepEqual(
    manifest.repositories.platform.workflowPermissions,
    workflowPermissions(),
  );
  assert.equal(
    manifest.repositories.reference.nameWithOwner,
    "mbzadev/opengrow-reference",
  );
  assert.equal(manifest.repositories.platform.visibility, "public");
  assert.equal(manifest.repositories.reference.visibility, "public");
  assert.deepEqual(manifest.repositories.reference.repositorySecrets, []);
  assert.equal(
    manifest.repositories.platform.branches.dev.requiredCheck,
    "CI gate",
  );
  assert.equal(
    manifest.repositories.reference.branches.dev.requiredCheck,
    "Reference gate",
  );
  assert.doesNotMatch(
    serialized,
    /ghp_|github_pat_|api[_-]?token\s*[:=]\s*[A-Za-z0-9]/i,
  );
});

test("offline GitHub readiness plan exposes only variable and secret names", async () => {
  const plan = readinessPlan(await loadGitHubControlPlane());
  assert.equal(
    plan.repositories.platform.description,
    "OpenGrow multi-application back-office, Cloudflare Workers platform and reusable SDK libraries",
  );
  assert.deepEqual(plan.repositories.platform.settings, settings());
  const development = plan.repositories.platform.environments.find(
    ({ name }) => name === "development",
  );
  assert.deepEqual(development.variables, [
    "OPENGROW_REFERENCE_REPOSITORY",
    "OPENGROW_TARGET",
  ]);
  assert.deepEqual(development.secrets, [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "OPENGROW_REFERENCE_DISPATCH_TOKEN",
  ]);
  const flutterFlowLibrary = plan.repositories.platform.environments.find(
    ({ name }) => name === "flutterflow-library",
  );
  assert.deepEqual(flutterFlowLibrary.variables, ["FF_LIBRARY_PROJECT_ID"]);
  assert.deepEqual(flutterFlowLibrary.secrets, ["FF_API_KEY"]);
  const sdkRelease = plan.repositories.platform.environments.find(
    ({ name }) => name === "sdk-release",
  );
  assert.deepEqual(sdkRelease.variables, ["OPENGROW_REFERENCE_REPOSITORY"]);
  assert.deepEqual(sdkRelease.secrets, ["OPENGROW_REFERENCE_DISPATCH_TOKEN"]);
  const referenceDevelopment = plan.repositories.reference.environments.find(
    ({ name }) => name === "development",
  );
  assert.deepEqual(referenceDevelopment.variables, []);
  assert.deepEqual(referenceDevelopment.secrets, [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "OPENGROW_PROJECT_ID",
    "OPENGROW_PROJECT_KEY",
  ]);
  assert.equal("values" in development, false);
  assert.equal("values" in flutterFlowLibrary, false);
  assert.equal("values" in referenceDevelopment, false);
});

test("remote GitHub inspection reports an inaccessible repository without leaking command errors", () => {
  const repository = {
    nameWithOwner: "mbzadev/missing",
    visibility: "public",
    defaultBranch: "dev",
    branches: { dev: {}, main: {} },
    environments: { development: {} },
  };
  assert.deepEqual(
    inspectRepository(repository, () => ({
      ok: false,
      stdout: "sensitive stderr",
    })),
    {
      nameWithOwner: "mbzadev/missing",
      status: "missing-or-inaccessible",
      ready: false,
    },
  );
});

test("remote GitHub inspection requires branches, protection, variables and secret names", () => {
  const repository = {
    nameWithOwner: "mbzadev/ready",
    description: "OpenGrow test repository",
    settings: settings(),
    workflowPermissions: workflowPermissions(),
    visibility: "public",
    defaultBranch: "dev",
    repositorySecrets: ["READ_TOKEN"],
    branches: {
      dev: {
        requiredCheck: "CI gate",
        requirePullRequest: true,
        requireCodeOwnerReviews: true,
        requiredApprovals: 1,
      },
      main: {
        requiredCheck: "CI gate",
        requirePullRequest: true,
        requireCodeOwnerReviews: true,
        requiredApprovals: 1,
      },
    },
    environments: {
      development: {
        variables: { OPENGROW_TARGET: "mbza-development" },
        secrets: ["CLOUDFLARE_API_TOKEN"],
      },
    },
  };
  const payloads = new Map([
    [
      `${repositoryApiPrefix} repos/mbzadev/ready`,
      repositoryPayload("mbzadev/ready"),
    ],
    [
      "api repos/mbzadev/ready/actions/permissions/workflow",
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: true,
      },
    ],
    ["api repos/mbzadev/ready/branches/dev", { name: "dev" }],
    ["api repos/mbzadev/ready/branches/main", { name: "main" }],
    [
      "api repos/mbzadev/ready/branches/dev/protection",
      {
        required_status_checks: {
          strict: true,
          checks: [{ context: "CI gate" }],
        },
        enforce_admins: { enabled: true },
        required_pull_request_reviews: {
          dismiss_stale_reviews: true,
          require_code_owner_reviews: true,
          required_approving_review_count: 1,
        },
        required_linear_history: { enabled: true },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
        required_conversation_resolution: { enabled: true },
      },
    ],
    [
      "api repos/mbzadev/ready/branches/main/protection",
      {
        required_status_checks: { strict: true, contexts: ["CI gate"] },
        enforce_admins: { enabled: true },
        required_pull_request_reviews: {
          dismiss_stale_reviews: true,
          require_code_owner_reviews: true,
          required_approving_review_count: 1,
        },
        required_linear_history: { enabled: true },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
        required_conversation_resolution: { enabled: true },
      },
    ],
    [
      "api repos/mbzadev/ready/environments",
      { environments: [{ name: "development" }] },
    ],
    [
      "api repos/mbzadev/ready/environments/development/variables",
      {
        variables: [{ name: "OPENGROW_TARGET", value: "mbza-development" }],
      },
    ],
    [
      "api repos/mbzadev/ready/environments/development/secrets",
      {
        secrets: [{ name: "CLOUDFLARE_API_TOKEN" }],
      },
    ],
    [
      "api repos/mbzadev/ready/actions/secrets",
      { secrets: [{ name: "READ_TOKEN" }] },
    ],
  ]);
  const run = (args) => {
    const payload = payloads.get(args.join(" "));
    return payload
      ? { ok: true, stdout: JSON.stringify(payload) }
      : { ok: false, stdout: "" };
  };

  const state = inspectRepository(repository, run);
  assert.equal(state.ready, true);
  assert.equal(state.status, "ready");
  assert.equal(state.settingsMatch, true);
  assert.equal(state.workflowPermissionsMatch, true);
  assert.equal(JSON.stringify(state).includes("mbza-development"), false);
  assert.equal(state.environments[0].variables[0].configured, true);
  assert.equal(state.environments[0].variables[0].exists, true);
  assert.equal(state.environments[0].secrets[0].configured, true);
  assert.equal(
    state.branches.every((branch) => branch.protectionMatches),
    true,
  );
});

test("remote GitHub inspection rejects a superficially matching but weak branch rule", () => {
  const repository = {
    nameWithOwner: "mbzadev/weak",
    description: "OpenGrow test repository",
    settings: settings(),
    workflowPermissions: workflowPermissions(),
    visibility: "public",
    defaultBranch: "dev",
    repositorySecrets: [],
    branches: {
      dev: {
        requiredCheck: "CI gate",
        requirePullRequest: true,
        requireCodeOwnerReviews: true,
        requiredApprovals: 1,
      },
    },
    environments: {},
  };
  const payloads = new Map([
    [
      `${repositoryApiPrefix} repos/mbzadev/weak`,
      repositoryPayload("mbzadev/weak"),
    ],
    [
      "api repos/mbzadev/weak/actions/permissions/workflow",
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: true,
      },
    ],
    ["api repos/mbzadev/weak/branches/dev", { name: "dev" }],
    [
      "api repos/mbzadev/weak/branches/dev/protection",
      {
        required_status_checks: { strict: false, contexts: ["CI gate"] },
        required_pull_request_reviews: { required_approving_review_count: 1 },
      },
    ],
    ["api repos/mbzadev/weak/environments", { environments: [] }],
  ]);
  const run = (args) => {
    const payload = payloads.get(args.join(" "));
    return payload
      ? { ok: true, stdout: JSON.stringify(payload) }
      : { ok: false, stdout: "" };
  };

  const state = inspectRepository(repository, run);
  assert.equal(state.ready, false);
  assert.equal(state.branches[0].requiredCheckPresent, true);
  assert.equal(state.branches[0].approvalsMatch, true);
  assert.equal(state.branches[0].codeOwnerReviewsMatch, false);
  assert.equal(state.branches[0].secureSettingsMatch, false);
  assert.equal(state.branches[0].protectionMatches, false);
});

test("remote GitHub inspection rejects repository settings drift", () => {
  const repository = {
    nameWithOwner: "mbzadev/drifted",
    description: "OpenGrow test repository",
    settings: settings(),
    workflowPermissions: workflowPermissions(),
    visibility: "public",
    defaultBranch: "dev",
    repositorySecrets: [],
    branches: {},
    environments: {},
  };
  const payloads = new Map([
    [
      `${repositoryApiPrefix} repos/mbzadev/drifted`,
      repositoryPayload("mbzadev/drifted", { allow_merge_commit: true }),
    ],
    [
      "api repos/mbzadev/drifted/actions/permissions/workflow",
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: true,
      },
    ],
    ["api repos/mbzadev/drifted/environments", { environments: [] }],
  ]);
  const state = inspectRepository(repository, (args) => {
    const payload = payloads.get(args.join(" "));
    return payload
      ? { ok: true, stdout: JSON.stringify(payload) }
      : { ok: false, stdout: "" };
  });
  assert.equal(state.ready, false);
  assert.equal(state.settingsMatch, false);
  assert.equal(state.settings.mergeCommit, true);
});
