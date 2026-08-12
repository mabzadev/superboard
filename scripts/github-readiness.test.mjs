import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectReleaseProtection,
  inspectRepository,
  loadGitHubControlPlane,
  readinessPlan,
  remoteBranchHistoryState,
  validateEnvironmentProtections,
  tagRulesetMatches,
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

function securityPolicy() {
  return {
    vulnerabilityAlerts: true,
    dependabotSecurityUpdates: true,
  };
}

function releaseProtection() {
  return { immutableReleases: true };
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
  assert.equal(manifest.schemaVersion, 9);
  assert.deepEqual(manifest.owner, { login: "mabzadev", type: "user" });
  assert.equal(
    manifest.repositories.platform.nameWithOwner,
    "mabzadev/superboard",
  );
  assert.match(manifest.repositories.platform.description, /SuperBoard/u);
  assert.deepEqual(manifest.repositories.platform.settings, settings());
  assert.deepEqual(
    manifest.repositories.platform.workflowPermissions,
    workflowPermissions(),
  );
  assert.deepEqual(manifest.repositories.platform.security, securityPolicy());
  assert.equal(
    manifest.repositories.platform.releaseProtection.immutableReleases,
    true,
  );
  assert.deepEqual(
    manifest.repositories.platform.releaseProtection.tagRuleset.rules,
    ["update", "deletion"],
  );
  assert.equal(manifest.repositories.platform.visibility, "public");
  assert.deepEqual(Object.keys(manifest.repositories), ["platform"]);
  assert.equal(
    manifest.repositories.platform.branches.dev.requiredCheck,
    "CI gate",
  );
  assert.deepEqual(
    manifest.repositories.platform.environments.development.protection
      .deploymentPolicies,
    [{ type: "branch", pattern: "dev" }],
  );
  assert.equal(
    manifest.repositories.platform.environments.production.protection
      .enforcement,
    "pending-external",
  );
  assert.equal(
    manifest.repositories.platform.environments.production.protection
      .minimumEligibleReviewers,
    2,
  );
  assert.equal(
    manifest.repositories.platform.environments.production.protection.reviewers
      .length,
    1,
  );
  assert.equal(
    manifest.repositories.platform.environments[
      "sdk-release"
    ].protection.deploymentPolicies.filter(({ type }) => type === "tag").length,
    7,
  );
  assert.doesNotMatch(
    serialized,
    /ghp_|github_pat_|api[_-]?token\s*[:=]\s*[A-Za-z0-9]/i,
  );
});

test("offline GitHub readiness plan exposes no secret values and includes protection intent", async () => {
  const plan = readinessPlan(await loadGitHubControlPlane());
  assert.equal(
    plan.repositories.platform.description,
    "Canonical SuperBoard monorepo: back-office, Cloudflare Workers, SDKs and reference application",
  );
  assert.deepEqual(plan.repositories.platform.settings, settings());
  assert.deepEqual(plan.repositories.platform.security, securityPolicy());
  assert.equal(
    plan.repositories.platform.releaseProtection.immutableReleases,
    true,
  );
  const development = plan.repositories.platform.environments.find(
    ({ name }) => name === "development",
  );
  assert.deepEqual(development.variables, ["SUPERBOARD_TARGET"]);
  assert.deepEqual(development.secrets, []);
  const flutterFlowLibrary = plan.repositories.platform.environments.find(
    ({ name }) => name === "flutterflow-library",
  );
  assert.deepEqual(flutterFlowLibrary.variables, ["FF_LIBRARY_PROJECT_ID"]);
  assert.deepEqual(flutterFlowLibrary.secrets, ["FF_API_KEY"]);
  const sdkRelease = plan.repositories.platform.environments.find(
    ({ name }) => name === "sdk-release",
  );
  assert.deepEqual(sdkRelease.variables, []);
  assert.deepEqual(sdkRelease.secrets, []);
  assert.equal(sdkRelease.protection.enforcement, "pending-external");
  assert.equal(sdkRelease.protection.preventSelfReview, true);
  assert.equal(sdkRelease.protection.allowAdminBypass, false);
  assert.deepEqual(sdkRelease.protection.reviewers, [
    { type: "User", name: "mabzadev" },
  ]);
  assert.equal("values" in development, false);
  assert.equal("values" in flutterFlowLibrary, false);
});

test("enforced self-review protection fails closed until two reviewers are declared", () => {
  const protection = {
    enforcement: "enforced",
    pendingReason: null,
    waitTimerMinutes: 0,
    preventSelfReview: true,
    allowAdminBypass: false,
    minimumEligibleReviewers: 2,
    reviewers: [{ type: "User", id: 95926658, name: "mabzadev" }],
    deploymentPolicies: [{ type: "branch", pattern: "main" }],
  };
  assert.throws(
    () =>
      validateEnvironmentProtections({
        repositories: {
          platform: {
            nameWithOwner: "mabzadev/superboard-platform",
            environments: { production: { protection } },
          },
        },
      }),
    /enforced protection declares 1 of 2 required eligible reviewers/u,
  );
  protection.enforcement = "pending-external";
  protection.pendingReason = "A second trusted human reviewer is required.";
  assert.doesNotThrow(() =>
    validateEnvironmentProtections({
      repositories: {
        platform: {
          nameWithOwner: "mabzadev/superboard-platform",
          environments: { production: { protection } },
        },
      },
    }),
  );
});

test("remote GitHub inspection reports an inaccessible repository without leaking command errors", () => {
  const repository = {
    nameWithOwner: "mabzadev/missing",
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
      nameWithOwner: "mabzadev/missing",
      status: "missing-or-inaccessible",
      ready: false,
    },
  );
});

test("remote GitHub inspection requires branches, protection, variables and secret names", () => {
  const repository = {
    nameWithOwner: "mabzadev/ready",
    description: "OpenGrow test repository",
    settings: settings(),
    workflowPermissions: workflowPermissions(),
    security: securityPolicy(),
    releaseProtection: releaseProtection(),
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
        variables: { SUPERBOARD_TARGET: "mbza-development" },
        secrets: ["CLOUDFLARE_API_TOKEN"],
      },
    },
  };
  const payloads = new Map([
    [
      `${repositoryApiPrefix} repos/mabzadev/ready`,
      repositoryPayload("mabzadev/ready"),
    ],
    [
      "api repos/mabzadev/ready/actions/permissions/workflow",
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: true,
      },
    ],
    ["api repos/mabzadev/ready/vulnerability-alerts", {}],
    [
      "api repos/mabzadev/ready/automated-security-fixes",
      { enabled: true, paused: false },
    ],
    [
      "api repos/mabzadev/ready/immutable-releases",
      { enabled: true, enforced_by_owner: false },
    ],
    ["api repos/mabzadev/ready/releases?per_page=100", []],
    [
      "api repos/mabzadev/ready/branches/dev",
      { name: "dev", commit: { sha: "d".repeat(40) } },
    ],
    [
      "api repos/mabzadev/ready/branches/main",
      { name: "main", commit: { sha: "a".repeat(40) } },
    ],
    [
      "api repos/mabzadev/ready/compare/main...dev",
      { merge_base_commit: { sha: "c".repeat(40) } },
    ],
    [
      "api repos/mabzadev/ready/branches/dev/protection",
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
      "api repos/mabzadev/ready/branches/main/protection",
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
      "api repos/mabzadev/ready/environments",
      { environments: [{ name: "development" }] },
    ],
    [
      "api repos/mabzadev/ready/environments/development/variables",
      {
        variables: [{ name: "SUPERBOARD_TARGET", value: "mbza-development" }],
      },
    ],
    [
      "api repos/mabzadev/ready/environments/development/secrets",
      {
        secrets: [{ name: "CLOUDFLARE_API_TOKEN" }],
      },
    ],
    [
      "api repos/mabzadev/ready/actions/secrets",
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
  assert.deepEqual(state.branchHistory, {
    required: true,
    ready: true,
    status: "connected",
    mainSha: "a".repeat(40),
    devSha: "d".repeat(40),
    mergeBase: "c".repeat(40),
  });
  assert.equal(state.settingsMatch, true);
  assert.equal(state.workflowPermissionsMatch, true);
  assert.equal(state.security.ready, true);
  assert.equal(state.releaseProtection.ready, true);
  assert.equal(JSON.stringify(state).includes("mbza-development"), false);
  assert.equal(state.environments[0].variables[0].configured, true);
  assert.equal(state.environments[0].variables[0].exists, true);
  assert.equal(state.environments[0].secrets[0].configured, true);
  assert.equal(
    state.branches.every((branch) => branch.protectionMatches),
    true,
  );

  payloads.delete("api repos/mabzadev/ready/vulnerability-alerts");
  payloads.set("api repos/mabzadev/ready/automated-security-fixes", {
    enabled: true,
    paused: true,
  });
  const insecure = inspectRepository(repository, run);
  assert.equal(insecure.ready, false);
  assert.equal(insecure.security.ready, false);
  assert.equal(insecure.security.vulnerabilityAlerts.enabled, false);
  assert.equal(insecure.security.dependabotSecurityUpdates.paused, true);
});

test("remote GitHub inspection compares Environment reviewers, timers, bypass and branch-tag policies", () => {
  const reviewers = [
    { type: "User", id: 11, name: "release-one" },
    { type: "User", id: 22, name: "release-two" },
  ];
  const repository = {
    nameWithOwner: "mabzadev/protected",
    description: "OpenGrow test repository",
    settings: settings(),
    workflowPermissions: workflowPermissions(),
    security: securityPolicy(),
    releaseProtection: releaseProtection(),
    visibility: "public",
    defaultBranch: "dev",
    repositorySecrets: [],
    branches: {},
    environments: {
      production: {
        variables: {},
        secrets: [],
        protection: {
          enforcement: "enforced",
          pendingReason: null,
          waitTimerMinutes: 5,
          preventSelfReview: true,
          allowAdminBypass: false,
          minimumEligibleReviewers: 2,
          reviewers,
          deploymentPolicies: [
            { type: "branch", pattern: "main" },
            { type: "tag", pattern: "sdk-android-v*" },
          ],
        },
      },
    },
  };
  const payloads = new Map([
    [
      `${repositoryApiPrefix} repos/mabzadev/protected`,
      repositoryPayload("mabzadev/protected"),
    ],
    [
      "api repos/mabzadev/protected/actions/permissions/workflow",
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: true,
      },
    ],
    ["api repos/mabzadev/protected/vulnerability-alerts", {}],
    [
      "api repos/mabzadev/protected/automated-security-fixes",
      { enabled: true, paused: false },
    ],
    ["api repos/mabzadev/protected/immutable-releases", { enabled: true }],
    ["api repos/mabzadev/protected/releases?per_page=100", []],
    [
      "api repos/mabzadev/protected/environments",
      { environments: [{ name: "production" }] },
    ],
    [
      "api repos/mabzadev/protected/environments/production/variables",
      { variables: [] },
    ],
    [
      "api repos/mabzadev/protected/environments/production/secrets",
      { secrets: [] },
    ],
    [
      "api repos/mabzadev/protected/environments/production",
      {
        can_admins_bypass: false,
        protection_rules: [
          {
            type: "wait_timer",
            wait_timer: 5,
          },
          {
            type: "required_reviewers",
            prevent_self_review: true,
            reviewers: reviewers.map(({ type, id, name }) => ({
              type,
              reviewer: { id, login: name },
            })),
          },
          { type: "branch_policy" },
        ],
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      },
    ],
    [
      "api repos/mabzadev/protected/environments/production/deployment-branch-policies",
      {
        branch_policies: [
          { id: 1, type: "branch", name: "main" },
          { id: 2, type: "tag", name: "sdk-android-v*" },
        ],
      },
    ],
    [
      "api repos/mabzadev/protected/collaborators/release-one/permission",
      { permission: "read", user: { id: 11, login: "release-one" } },
    ],
    [
      "api repos/mabzadev/protected/collaborators/release-two/permission",
      { permission: "maintain", user: { id: 22, login: "release-two" } },
    ],
  ]);
  const state = inspectRepository(repository, (args) => {
    const payload = payloads.get(args.join(" "));
    return payload
      ? { ok: true, stdout: JSON.stringify(payload) }
      : { ok: false, stdout: "" };
  });
  assert.equal(state.ready, true);
  assert.equal(state.environments[0].protection.matches, true);
  assert.equal(state.environments[0].protection.ready, true);
  assert.equal(state.environments[0].protection.eligibleReviewerCount, 2);
  assert.deepEqual(
    state.environments[0].protection.remote.deploymentPolicies.map(
      ({ type, pattern }) => ({ type, pattern }),
    ),
    [
      { type: "branch", pattern: "main" },
      { type: "tag", pattern: "sdk-android-v*" },
    ],
  );

  payloads.set(
    "api repos/mabzadev/protected/collaborators/release-two/permission",
    { permission: "maintain", user: { id: 23, login: "renamed-account" } },
  );
  const identityDrift = inspectRepository(repository, (args) => {
    const payload = payloads.get(args.join(" "));
    return payload
      ? { ok: true, stdout: JSON.stringify(payload) }
      : { ok: false, stdout: "" };
  });
  assert.equal(identityDrift.ready, false);
  assert.equal(
    identityDrift.environments[0].protection.eligibleReviewerCount,
    1,
  );
  assert.equal(
    identityDrift.environments[0].protection.eligibleReviewersReady,
    false,
  );
});

test("pending external Environment protection is explicit and cannot report ready", () => {
  const repository = {
    nameWithOwner: "mabzadev/pending",
    description: "OpenGrow test repository",
    settings: settings(),
    workflowPermissions: workflowPermissions(),
    security: securityPolicy(),
    releaseProtection: releaseProtection(),
    visibility: "public",
    defaultBranch: "dev",
    repositorySecrets: [],
    branches: {},
    environments: {
      production: {
        variables: {},
        secrets: [],
        protection: {
          enforcement: "pending-external",
          pendingReason: "A second trusted human reviewer is required.",
          waitTimerMinutes: 5,
          preventSelfReview: true,
          allowAdminBypass: false,
          minimumEligibleReviewers: 2,
          reviewers: [{ type: "User", id: 11, name: "release-one" }],
          deploymentPolicies: [{ type: "branch", pattern: "main" }],
        },
      },
    },
  };
  const payloads = new Map([
    [
      `${repositoryApiPrefix} repos/mabzadev/pending`,
      repositoryPayload("mabzadev/pending"),
    ],
    [
      "api repos/mabzadev/pending/actions/permissions/workflow",
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: true,
      },
    ],
    ["api repos/mabzadev/pending/vulnerability-alerts", {}],
    [
      "api repos/mabzadev/pending/automated-security-fixes",
      { enabled: true, paused: false },
    ],
    ["api repos/mabzadev/pending/immutable-releases", { enabled: true }],
    ["api repos/mabzadev/pending/releases?per_page=100", []],
    [
      "api repos/mabzadev/pending/environments",
      { environments: [{ name: "production" }] },
    ],
    [
      "api repos/mabzadev/pending/environments/production/variables",
      { variables: [] },
    ],
    [
      "api repos/mabzadev/pending/environments/production/secrets",
      { secrets: [] },
    ],
    [
      "api repos/mabzadev/pending/environments/production",
      {
        can_admins_bypass: true,
        protection_rules: [],
        deployment_branch_policy: null,
      },
    ],
    [
      "api repos/mabzadev/pending/collaborators/release-one/permission",
      { permission: "read", user: { id: 11, login: "release-one" } },
    ],
  ]);
  const state = inspectRepository(repository, (args) => {
    const payload = payloads.get(args.join(" "));
    return payload
      ? { ok: true, stdout: JSON.stringify(payload) }
      : { ok: false, stdout: "" };
  });
  assert.equal(state.ready, false);
  assert.equal(state.status, "incomplete");
  assert.equal(
    state.environments[0].protection.enforcement,
    "pending-external",
  );
  assert.equal(state.environments[0].protection.eligibleReviewersReady, false);
  assert.equal(state.environments[0].protection.ready, false);
});

test("remote branch history fails closed when GitHub cannot produce a main/dev merge base", () => {
  const state = remoteBranchHistoryState({
    required: true,
    mainSha: "a".repeat(40),
    devSha: "d".repeat(40),
    comparisonOk: false,
    comparison: null,
  });
  assert.deepEqual(state, {
    required: true,
    ready: false,
    status: "unrelated-or-inaccessible",
    mainSha: "a".repeat(40),
    devSha: "d".repeat(40),
    mergeBase: null,
  });
});

test("release readiness compensates asset-free legacy releases only with the exact no-bypass tag ruleset", () => {
  const expected = {
    name: "SuperBoard immutable SDK tags",
    enforcement: "active",
    include: ["refs/tags/sdk-flutter-v*"],
    rules: ["update", "deletion"],
  };
  const repository = {
    nameWithOwner: "mabzadev/release-ready",
    releaseProtection: {
      immutableReleases: true,
      tagRuleset: expected,
    },
  };
  const payloads = new Map([
    [
      "api repos/mabzadev/release-ready/immutable-releases",
      { enabled: true, enforced_by_owner: false },
    ],
    [
      "api repos/mabzadev/release-ready/rulesets?targets=tag&per_page=100",
      [{ id: 42, name: expected.name, target: "tag" }],
    ],
    [
      "api repos/mabzadev/release-ready/rulesets/42",
      {
        id: 42,
        name: expected.name,
        target: "tag",
        enforcement: "active",
        bypass_actors: [],
        conditions: {
          ref_name: { include: expected.include, exclude: [] },
        },
        rules: [{ type: "update" }, { type: "deletion" }],
      },
    ],
    [
      "api repos/mabzadev/release-ready/releases?per_page=100",
      [
        {
          id: 99,
          tag_name: "sdk-flutter-v2.1.4",
          draft: false,
          immutable: false,
          assets: [],
        },
      ],
    ],
  ]);
  const run = (args) => {
    const payload = payloads.get(args.join(" "));
    return payload === undefined
      ? { ok: false, stdout: "" }
      : { ok: true, stdout: JSON.stringify(payload) };
  };
  const state = inspectReleaseProtection(repository, run);
  assert.equal(state.ready, true);
  assert.equal(state.mutableReleaseCompensationReady, true);
  assert.deepEqual(state.mutablePublishedReleases, [
    { id: 99, tagName: "sdk-flutter-v2.1.4", assetCount: 0 },
  ]);

  const bypassed = structuredClone(state.tagRuleset.actual);
  bypassed.bypassActors = [{ actor_id: 1, actor_type: "RepositoryRole" }];
  assert.equal(tagRulesetMatches(expected, bypassed), false);
});

test("remote GitHub inspection rejects a superficially matching but weak branch rule", () => {
  const repository = {
    nameWithOwner: "mabzadev/weak",
    description: "OpenGrow test repository",
    settings: settings(),
    workflowPermissions: workflowPermissions(),
    security: securityPolicy(),
    releaseProtection: releaseProtection(),
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
      `${repositoryApiPrefix} repos/mabzadev/weak`,
      repositoryPayload("mabzadev/weak"),
    ],
    [
      "api repos/mabzadev/weak/actions/permissions/workflow",
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: true,
      },
    ],
    ["api repos/mabzadev/weak/vulnerability-alerts", {}],
    [
      "api repos/mabzadev/weak/automated-security-fixes",
      { enabled: true, paused: false },
    ],
    ["api repos/mabzadev/weak/immutable-releases", { enabled: true }],
    ["api repos/mabzadev/weak/releases?per_page=100", []],
    ["api repos/mabzadev/weak/branches/dev", { name: "dev" }],
    [
      "api repos/mabzadev/weak/branches/dev/protection",
      {
        required_status_checks: { strict: false, contexts: ["CI gate"] },
        required_pull_request_reviews: { required_approving_review_count: 1 },
      },
    ],
    ["api repos/mabzadev/weak/environments", { environments: [] }],
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
    nameWithOwner: "mabzadev/drifted",
    description: "OpenGrow test repository",
    settings: settings(),
    workflowPermissions: workflowPermissions(),
    security: securityPolicy(),
    releaseProtection: releaseProtection(),
    visibility: "public",
    defaultBranch: "dev",
    repositorySecrets: [],
    branches: {},
    environments: {},
  };
  const payloads = new Map([
    [
      `${repositoryApiPrefix} repos/mabzadev/drifted`,
      repositoryPayload("mabzadev/drifted", { allow_merge_commit: true }),
    ],
    [
      "api repos/mabzadev/drifted/actions/permissions/workflow",
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: true,
      },
    ],
    ["api repos/mabzadev/drifted/vulnerability-alerts", {}],
    [
      "api repos/mabzadev/drifted/automated-security-fixes",
      { enabled: true, paused: false },
    ],
    ["api repos/mabzadev/drifted/immutable-releases", { enabled: true }],
    ["api repos/mabzadev/drifted/releases?per_page=100", []],
    ["api repos/mabzadev/drifted/environments", { environments: [] }],
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
