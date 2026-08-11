import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGitHubReconcilePlan,
  buildGitHubReconcilePlan,
  mutationRequest,
  reconciliationConfirmation,
} from "./github-reconcile.mjs";

function manifest() {
  return {
    schemaVersion: 8,
    repositories: {
      platform: {
        nameWithOwner: "mbzadev/superboard-platform",
        description: "OpenGrow platform",
        settings: {
          issues: true,
          projects: false,
          wiki: false,
          downloads: false,
          squashMerge: true,
          mergeCommit: false,
          rebaseMerge: false,
          deleteBranchOnMerge: true,
        },
        visibility: "public",
        defaultBranch: "dev",
        workflowPermissions: {
          default: "read",
          canApprovePullRequestReviews: true,
        },
        security: {
          vulnerabilityAlerts: true,
          dependabotSecurityUpdates: true,
        },
        releaseProtection: {
          immutableReleases: true,
          tagRuleset: {
            name: "SuperBoard immutable SDK tags",
            enforcement: "active",
            include: ["refs/tags/sdk-*-v*"],
            rules: ["update", "deletion"],
          },
        },
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
        repositorySecrets: ["READ_TOKEN"],
      },
    },
  };
}

function secureState() {
  return {
    ready: true,
    vulnerabilityAlerts: { enabled: true },
    dependabotSecurityUpdates: { enabled: true, paused: false },
  };
}

function releaseState() {
  return {
    ready: true,
    immutableReleases: { enabled: true },
    tagRuleset: { ready: true, status: "active" },
    releaseInventoryReadable: true,
    mutablePublishedReleases: [],
  };
}

test("reconciliation blocks a missing repository and never invents a creation mutation", () => {
  const plan = buildGitHubReconcilePlan(manifest(), [
    {
      nameWithOwner: "mbzadev/superboard-platform",
      status: "missing-or-inaccessible",
      ready: false,
    },
  ]);
  assert.equal(plan.ready, false);
  assert.equal(plan.repositories[0].operations.length, 0);
  assert.deepEqual(
    plan.repositories[0].blockers.map(({ type }) => type),
    ["repository-access"],
  );
  assert.equal(JSON.stringify(plan).includes("create-repository"), false);
});

test("reconciliation plans structure but leaves every secret value manual", () => {
  const plan = buildGitHubReconcilePlan(manifest(), [
    {
      nameWithOwner: "mbzadev/superboard-platform",
      status: "incomplete",
      ready: false,
      visibility: "public",
      settingsMatch: true,
      workflowPermissionsMatch: true,
      security: secureState(),
      releaseProtection: releaseState(),
      defaultBranch: "main",
      branches: [
        { name: "dev", exists: true, protectionMatches: false },
        { name: "main", exists: true, protectionMatches: true },
      ],
      environments: [
        {
          name: "development",
          exists: true,
          variables: [
            { name: "SUPERBOARD_TARGET", exists: true, configured: false },
          ],
          secrets: [{ name: "CLOUDFLARE_API_TOKEN", configured: false }],
        },
      ],
      repositorySecrets: [{ name: "READ_TOKEN", configured: false }],
    },
  ]);
  assert.deepEqual(
    plan.repositories[0].operations.map(({ type }) => type),
    [
      "put-branch-protection",
      "set-default-branch",
      "update-environment-variable",
    ],
  );
  assert.deepEqual(
    plan.repositories[0].manual.map(({ name }) => name),
    ["CLOUDFLARE_API_TOKEN", "READ_TOKEN"],
  );
  assert.equal(JSON.stringify(plan).includes("mbza-development"), false);
});

test("reconciliation converges declarative repository settings", () => {
  const configuration = manifest();
  const plan = buildGitHubReconcilePlan(configuration, [
    {
      nameWithOwner: "mbzadev/superboard-platform",
      status: "incomplete",
      ready: false,
      visibility: "public",
      settingsMatch: false,
      workflowPermissionsMatch: true,
      security: secureState(),
      releaseProtection: releaseState(),
      defaultBranch: "dev",
      branches: [
        { name: "dev", exists: true, protectionMatches: true },
        { name: "main", exists: true, protectionMatches: true },
      ],
      environments: [
        {
          name: "development",
          exists: true,
          variables: [
            { name: "SUPERBOARD_TARGET", exists: true, configured: true },
          ],
          secrets: [{ name: "CLOUDFLARE_API_TOKEN", configured: true }],
        },
      ],
      repositorySecrets: [{ name: "READ_TOKEN", configured: true }],
    },
  ]);
  assert.deepEqual(plan.repositories[0].operations, [
    {
      type: "update-repository-settings",
    },
  ]);
  assert.equal(plan.repositories[0].blockers.length, 0);
  assert.equal(plan.repositories[0].manual.length, 0);

  const request = mutationRequest(configuration.repositories.platform, {
    type: "update-repository-settings",
  });
  assert.deepEqual(request.body, {
    description: "OpenGrow platform",
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    has_downloads: false,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
  });
  const firstConfirmation = reconciliationConfirmation(plan, configuration);
  const changed = structuredClone(configuration);
  changed.repositories.platform.settings.wiki = true;
  assert.notEqual(firstConfirmation, reconciliationConfirmation(plan, changed));
});

test("reconciliation enables least-privilege workflow PR creation explicitly", () => {
  const configuration = manifest();
  const plan = buildGitHubReconcilePlan(configuration, [
    {
      nameWithOwner: "mbzadev/superboard-platform",
      status: "incomplete",
      ready: false,
      visibility: "public",
      settingsMatch: true,
      workflowPermissionsMatch: false,
      security: secureState(),
      releaseProtection: releaseState(),
      defaultBranch: "dev",
      branches: [
        { name: "dev", exists: true, protectionMatches: true },
        { name: "main", exists: true, protectionMatches: true },
      ],
      environments: [
        {
          name: "development",
          exists: true,
          variables: [
            { name: "SUPERBOARD_TARGET", exists: true, configured: true },
          ],
          secrets: [{ name: "CLOUDFLARE_API_TOKEN", configured: true }],
        },
      ],
      repositorySecrets: [{ name: "READ_TOKEN", configured: true }],
    },
  ]);
  assert.deepEqual(plan.repositories[0].operations, [
    { type: "set-workflow-permissions" },
  ]);
  const request = mutationRequest(configuration.repositories.platform, {
    type: "set-workflow-permissions",
  });
  assert.equal(
    request.args.includes(
      "repos/mbzadev/superboard-platform/actions/permissions/workflow",
    ),
    true,
  );
  assert.deepEqual(request.body, {
    default_workflow_permissions: "read",
    can_approve_pull_request_reviews: true,
  });
});

test("reconciliation plans security and future immutable-release hardening without moving tags", () => {
  const configuration = manifest();
  const state = {
    nameWithOwner: "mbzadev/superboard-platform",
    status: "incomplete",
    ready: false,
    visibility: "public",
    settingsMatch: true,
    workflowPermissionsMatch: true,
    defaultBranch: "dev",
    security: {
      ready: false,
      vulnerabilityAlerts: { enabled: false },
      dependabotSecurityUpdates: { enabled: false, paused: false },
    },
    releaseProtection: {
      ready: false,
      immutableReleases: { enabled: false },
      tagRuleset: { ready: false, status: "missing" },
      releaseInventoryReadable: true,
      mutablePublishedReleases: [
        { id: 42, tagName: "sdk-flutter-v2.1.4", assetCount: 0 },
      ],
    },
    branches: [
      { name: "dev", exists: true, protectionMatches: true },
      { name: "main", exists: true, protectionMatches: true },
    ],
    environments: [
      {
        name: "development",
        exists: true,
        variables: [
          { name: "SUPERBOARD_TARGET", exists: true, configured: true },
        ],
        secrets: [{ name: "CLOUDFLARE_API_TOKEN", configured: true }],
      },
    ],
    repositorySecrets: [{ name: "READ_TOKEN", configured: true }],
  };
  const plan = buildGitHubReconcilePlan(configuration, [state]);
  assert.match(plan.confirmation, /^GITHUB:RECONCILE:8:[a-f0-9]{12}$/u);
  assert.deepEqual(
    plan.repositories[0].operations.map(({ type }) => type),
    [
      "enable-vulnerability-alerts",
      "enable-dependabot-security-updates",
      "enable-immutable-releases",
      "create-tag-ruleset",
    ],
  );
  assert.deepEqual(plan.repositories[0].blockers, []);

  const rulesetRequest = mutationRequest(configuration.repositories.platform, {
    type: "create-tag-ruleset",
  });
  assert.equal(rulesetRequest.args.includes("--method"), true);
  assert.equal(rulesetRequest.args.includes("POST"), true);
  assert.equal(
    rulesetRequest.args.includes("repos/mbzadev/superboard-platform/rulesets"),
    true,
  );
  assert.deepEqual(rulesetRequest.body.bypass_actors, []);
  assert.deepEqual(
    rulesetRequest.body.rules.map(({ type }) => type),
    ["update", "deletion"],
  );
  assert.equal(JSON.stringify(rulesetRequest).includes("refs/tags/"), true);
  assert.equal(JSON.stringify(rulesetRequest).includes("git/refs"), false);
  assert.equal(JSON.stringify(rulesetRequest).includes("releases/42"), false);
});

test("reconciliation fails closed when Dependabot security updates are paused", () => {
  const configuration = manifest();
  const plan = buildGitHubReconcilePlan(configuration, [
    {
      nameWithOwner: "mbzadev/superboard-platform",
      status: "incomplete",
      ready: false,
      visibility: "public",
      settingsMatch: true,
      workflowPermissionsMatch: true,
      defaultBranch: "dev",
      security: {
        ready: false,
        vulnerabilityAlerts: { enabled: true },
        dependabotSecurityUpdates: { enabled: true, paused: true },
      },
      releaseProtection: releaseState(),
      branches: [
        { name: "dev", exists: true, protectionMatches: true },
        { name: "main", exists: true, protectionMatches: true },
      ],
      environments: [
        {
          name: "development",
          exists: true,
          variables: [
            { name: "SUPERBOARD_TARGET", exists: true, configured: true },
          ],
          secrets: [{ name: "CLOUDFLARE_API_TOKEN", configured: true }],
        },
      ],
      repositorySecrets: [{ name: "READ_TOKEN", configured: true }],
    },
  ]);

  assert.deepEqual(
    plan.repositories[0].blockers.map(({ type }) => type),
    ["dependabot-security-updates-paused"],
  );
  assert.deepEqual(plan.repositories[0].operations, []);
  assert.equal(plan.ready, false);
});

test("reconciliation fails closed on drifted tag rules or legacy mutable assets", () => {
  const configuration = manifest();
  const plan = buildGitHubReconcilePlan(configuration, [
    {
      nameWithOwner: "mbzadev/superboard-platform",
      status: "incomplete",
      ready: false,
      visibility: "public",
      settingsMatch: true,
      workflowPermissionsMatch: true,
      defaultBranch: "dev",
      security: secureState(),
      releaseProtection: {
        ready: false,
        immutableReleases: { enabled: true },
        tagRuleset: { ready: false, status: "drifted" },
        releaseInventoryReadable: true,
        mutablePublishedReleases: [
          { id: 42, tagName: "sdk-flutter-v2.1.4", assetCount: 1 },
        ],
      },
      branches: [
        { name: "dev", exists: true, protectionMatches: true },
        { name: "main", exists: true, protectionMatches: true },
      ],
      environments: [
        {
          name: "development",
          exists: true,
          variables: [
            { name: "SUPERBOARD_TARGET", exists: true, configured: true },
          ],
          secrets: [{ name: "CLOUDFLARE_API_TOKEN", configured: true }],
        },
      ],
      repositorySecrets: [{ name: "READ_TOKEN", configured: true }],
    },
  ]);
  assert.deepEqual(
    plan.repositories[0].blockers.map(({ type }) => type),
    ["tag-ruleset-drift", "uncompensated-mutable-releases"],
  );
  assert.equal(plan.repositories[0].operations.length, 0);
});

test("reconciliation refuses every mutation without its exact confirmation", () => {
  const configuration = manifest();
  const plan = {
    schemaVersion: 1,
    repositories: [
      {
        nameWithOwner: "mbzadev/superboard-platform",
        blockers: [],
        operations: [{ type: "put-environment", environment: "development" }],
      },
    ],
  };
  let calls = 0;
  assert.throws(
    () =>
      applyGitHubReconcilePlan(plan, configuration, {
        confirm: "wrong",
        run: () => {
          calls += 1;
          return { ok: true };
        },
      }),
    /pass --confirm GITHUB:RECONCILE:1:[a-f0-9]{12}/u,
  );
  assert.equal(calls, 0);
  assert.match(
    reconciliationConfirmation(plan, configuration),
    /^GITHUB:RECONCILE:1:[a-f0-9]{12}$/u,
  );
});

test("confirmed reconciliation uses JSON stdin and never mutates secrets", () => {
  const configuration = manifest();
  const plan = {
    schemaVersion: 1,
    repositories: [
      {
        nameWithOwner: "mbzadev/superboard-platform",
        blockers: [],
        manual: [
          {
            type: "set-environment-secret",
            environment: "development",
            name: "CLOUDFLARE_API_TOKEN",
          },
        ],
        operations: [
          { type: "put-environment", environment: "development" },
          {
            type: "create-environment-variable",
            environment: "development",
            name: "SUPERBOARD_TARGET",
          },
          {
            type: "put-branch-protection",
            branch: "dev",
            requiredCheck: "CI gate",
            requiredApprovals: 1,
            requireCodeOwnerReviews: true,
          },
        ],
      },
    ],
  };
  const calls = [];
  const applied = applyGitHubReconcilePlan(plan, configuration, {
    confirm: reconciliationConfirmation(plan, configuration),
    run: (args, body) => {
      calls.push({ args, body });
      return { ok: true };
    },
  });
  assert.equal(applied.length, 3);
  assert.equal(calls.length, 3);
  assert.equal(
    calls.every(({ args }) => args.includes("--input") && args.includes("-")),
    true,
  );
  assert.equal(
    calls.some(({ body }) => "CLOUDFLARE_API_TOKEN" in body),
    false,
  );
  assert.equal(calls[1].body.value, "mbza-development");
  assert.deepEqual(calls[2].body.required_status_checks.contexts, ["CI gate"]);
  assert.equal(
    calls[2].body.required_pull_request_reviews.require_code_owner_reviews,
    true,
  );
});

test("GitHub mutation requests use the current versioned REST contract", () => {
  const request = mutationRequest(manifest().repositories.platform, {
    type: "set-default-branch",
    branch: "dev",
  });
  assert.deepEqual(request.body, { default_branch: "dev" });
  assert.equal(request.args.includes("X-GitHub-Api-Version: 2026-03-10"), true);
  assert.equal(
    request.args.includes("repos/mbzadev/superboard-platform"),
    true,
  );
});

test("pending external Environment hardening is reported but never planned as a mutation", () => {
  const configuration = manifest();
  configuration.repositories.platform.environments.development.protection = {
    enforcement: "pending-external",
    pendingReason: "A second trusted human reviewer is required.",
    waitTimerMinutes: 5,
    preventSelfReview: true,
    allowAdminBypass: false,
    minimumEligibleReviewers: 2,
    reviewers: [{ type: "User", id: 11, name: "release-one" }],
    deploymentPolicies: [{ type: "branch", pattern: "dev" }],
  };
  const plan = buildGitHubReconcilePlan(configuration, [
    {
      nameWithOwner: "mbzadev/superboard-platform",
      status: "incomplete",
      ready: false,
      visibility: "public",
      settingsMatch: true,
      workflowPermissionsMatch: true,
      security: secureState(),
      releaseProtection: releaseState(),
      defaultBranch: "dev",
      branches: [
        { name: "dev", exists: true, protectionMatches: true },
        { name: "main", exists: true, protectionMatches: true },
      ],
      environments: [
        {
          name: "development",
          exists: true,
          variables: [
            { name: "SUPERBOARD_TARGET", exists: true, configured: true },
          ],
          secrets: [{ name: "CLOUDFLARE_API_TOKEN", configured: true }],
          protection: {
            enforcement: "pending-external",
            eligibleReviewersReady: false,
            eligibleReviewerCount: 1,
            remote: { deploymentPolicies: [] },
          },
        },
      ],
      repositorySecrets: [{ name: "READ_TOKEN", configured: true }],
    },
  ]);
  assert.deepEqual(plan.repositories[0].operations, []);
  assert.deepEqual(
    plan.repositories[0].manual.filter(
      ({ type }) => type === "activate-environment-protection",
    ),
    [
      {
        type: "activate-environment-protection",
        environment: "development",
        pendingReason: "A second trusted human reviewer is required.",
        minimumEligibleReviewers: 2,
        configuredEligibleReviewers: 1,
        remotelyEligibleReviewers: 1,
      },
    ],
  );
});

test("enforced Environment hardening plans reviewers, timer and missing branch-tag policies without deleting drift", () => {
  const configuration = manifest();
  configuration.repositories.platform.environments.development.protection = {
    enforcement: "enforced",
    pendingReason: null,
    waitTimerMinutes: 5,
    preventSelfReview: true,
    allowAdminBypass: false,
    minimumEligibleReviewers: 2,
    reviewers: [
      { type: "User", id: 11, name: "release-one" },
      { type: "User", id: 22, name: "release-two" },
    ],
    deploymentPolicies: [
      { type: "branch", pattern: "dev" },
      { type: "tag", pattern: "sdk-android-v*" },
    ],
  };
  const plan = buildGitHubReconcilePlan(configuration, [
    {
      nameWithOwner: "mbzadev/superboard-platform",
      status: "incomplete",
      ready: false,
      visibility: "public",
      settingsMatch: true,
      workflowPermissionsMatch: true,
      security: secureState(),
      releaseProtection: releaseState(),
      defaultBranch: "dev",
      branches: [
        { name: "dev", exists: true, protectionMatches: true },
        { name: "main", exists: true, protectionMatches: true },
      ],
      environments: [
        {
          name: "development",
          exists: true,
          variables: [
            { name: "SUPERBOARD_TARGET", exists: true, configured: true },
          ],
          secrets: [{ name: "CLOUDFLARE_API_TOKEN", configured: true }],
          protection: {
            eligibleReviewersReady: true,
            eligibleReviewerCount: 2,
            reviewersMatch: false,
            waitTimerMatches: false,
            preventSelfReviewMatches: false,
            adminBypassMatches: false,
            customDeploymentPoliciesEnabled: false,
            remote: {
              deploymentPolicies: [
                { id: 99, type: "branch", pattern: "legacy" },
              ],
            },
          },
        },
      ],
      repositorySecrets: [{ name: "READ_TOKEN", configured: true }],
    },
  ]);
  assert.deepEqual(
    plan.repositories[0].operations.map(({ type }) => type),
    [
      "put-environment-protection",
      "create-environment-deployment-policy",
      "create-environment-deployment-policy",
    ],
  );
  assert.equal(
    plan.repositories[0].manual.some(
      ({ type, pattern }) =>
        type === "review-unexpected-environment-deployment-policy" &&
        pattern === "legacy",
    ),
    true,
  );
  assert.equal(
    plan.repositories[0].manual.some(
      ({ type, allowAdminBypass }) =>
        type === "set-environment-admin-bypass" && allowAdminBypass === false,
    ),
    true,
  );

  const environmentRequest = mutationRequest(
    configuration.repositories.platform,
    plan.repositories[0].operations[0],
  );
  assert.deepEqual(environmentRequest.body, {
    wait_timer: 5,
    prevent_self_review: true,
    reviewers: [
      { type: "User", id: 11 },
      { type: "User", id: 22 },
    ],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  });
  const policyRequest = mutationRequest(
    configuration.repositories.platform,
    plan.repositories[0].operations[2],
  );
  assert.deepEqual(policyRequest.body, {
    name: "sdk-android-v*",
    type: "tag",
  });
});

test("a pending protection cannot be converted into a mutation request", () => {
  const configuration = manifest();
  configuration.repositories.platform.environments.development.protection = {
    enforcement: "pending-external",
    pendingReason: "A second trusted human reviewer is required.",
    waitTimerMinutes: 0,
    preventSelfReview: true,
    allowAdminBypass: false,
    minimumEligibleReviewers: 2,
    reviewers: [{ type: "User", id: 11, name: "release-one" }],
    deploymentPolicies: [{ type: "branch", pattern: "dev" }],
  };
  assert.throws(
    () =>
      mutationRequest(configuration.repositories.platform, {
        type: "put-environment-protection",
        environment: "development",
      }),
    /Environment protection is not enforceable/u,
  );
});

test("enforcement is structurally blocked when declared reviewers lack verified read access", () => {
  const configuration = manifest();
  configuration.repositories.platform.environments.development.protection = {
    enforcement: "enforced",
    pendingReason: null,
    waitTimerMinutes: 0,
    preventSelfReview: true,
    allowAdminBypass: false,
    minimumEligibleReviewers: 2,
    reviewers: [
      { type: "User", id: 11, name: "release-one" },
      { type: "User", id: 22, name: "release-two" },
    ],
    deploymentPolicies: [{ type: "branch", pattern: "dev" }],
  };
  const plan = buildGitHubReconcilePlan(configuration, [
    {
      nameWithOwner: "mbzadev/superboard-platform",
      status: "incomplete",
      ready: false,
      visibility: "public",
      settingsMatch: true,
      workflowPermissionsMatch: true,
      security: secureState(),
      releaseProtection: releaseState(),
      defaultBranch: "dev",
      branches: [
        { name: "dev", exists: true, protectionMatches: true },
        { name: "main", exists: true, protectionMatches: true },
      ],
      environments: [
        {
          name: "development",
          exists: true,
          variables: [
            { name: "SUPERBOARD_TARGET", exists: true, configured: true },
          ],
          secrets: [{ name: "CLOUDFLARE_API_TOKEN", configured: true }],
          protection: {
            eligibleReviewersReady: false,
            eligibleReviewerCount: 1,
            remote: { deploymentPolicies: [] },
          },
        },
      ],
      repositorySecrets: [{ name: "READ_TOKEN", configured: true }],
    },
  ]);
  assert.equal(
    plan.repositories[0].blockers.some(
      ({ type }) => type === "environment-reviewer-access",
    ),
    true,
  );
  assert.equal(
    plan.repositories[0].operations.some(
      ({ type }) => type === "put-environment-protection",
    ),
    false,
  );
});
