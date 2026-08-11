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
  validateEnvironmentProtections(manifest);
  return manifest;
}

export function validateEnvironmentProtections(manifest) {
  for (const repository of Object.values(manifest.repositories || {})) {
    for (const [environmentName, environment] of Object.entries(
      repository.environments || {},
    )) {
      const protection = environment.protection;
      if (!protection) continue;
      const reviewerKeys = protection.reviewers.map(
        (reviewer) => `${reviewer.type}:${reviewer.id}`,
      );
      if (new Set(reviewerKeys).size !== reviewerKeys.length) {
        throw new Error(
          `Invalid GitHub Environment protection ${repository.nameWithOwner}/${environmentName}: reviewer identities must be unique`,
        );
      }
      const policyKeys = protection.deploymentPolicies.map(
        (policy) => `${policy.type}:${policy.pattern}`,
      );
      if (new Set(policyKeys).size !== policyKeys.length) {
        throw new Error(
          `Invalid GitHub Environment protection ${repository.nameWithOwner}/${environmentName}: deployment policies must be unique`,
        );
      }
      const eligible = protection.reviewers.length;
      if (
        protection.enforcement === "enforced" &&
        eligible < protection.minimumEligibleReviewers
      ) {
        throw new Error(
          `Invalid GitHub Environment protection ${repository.nameWithOwner}/${environmentName}: enforced protection declares ${eligible} of ${protection.minimumEligibleReviewers} required eligible reviewers`,
        );
      }
      if (
        protection.enforcement === "enforced" &&
        protection.preventSelfReview &&
        protection.minimumEligibleReviewers < 2
      ) {
        throw new Error(
          `Invalid GitHub Environment protection ${repository.nameWithOwner}/${environmentName}: self-review prevention requires at least two eligible reviewers`,
        );
      }
    }
  }
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
          security: repository.security,
          releaseProtection: repository.releaseProtection,
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
              protection: environment.protection
                ? {
                    enforcement: environment.protection.enforcement,
                    pendingReason: environment.protection.pendingReason,
                    waitTimerMinutes: environment.protection.waitTimerMinutes,
                    preventSelfReview: environment.protection.preventSelfReview,
                    allowAdminBypass: environment.protection.allowAdminBypass,
                    minimumEligibleReviewers:
                      environment.protection.minimumEligibleReviewers,
                    reviewers: environment.protection.reviewers.map(
                      ({ type, name }) => ({ type, name }),
                    ),
                    deploymentPolicies: [
                      ...environment.protection.deploymentPolicies,
                    ],
                  }
                : null,
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
  const vulnerabilityAlertsResult = run([
    "api",
    `repos/${repository.nameWithOwner}/vulnerability-alerts`,
  ]);
  const dependabotSecurityUpdatesResult = run([
    "api",
    `repos/${repository.nameWithOwner}/automated-security-fixes`,
  ]);
  const dependabotSecurityUpdatesPayload = resultJson(
    dependabotSecurityUpdatesResult,
  );
  const security = {
    vulnerabilityAlerts: {
      required: repository.security.vulnerabilityAlerts,
      enabled: vulnerabilityAlertsResult.ok,
    },
    dependabotSecurityUpdates: {
      required: repository.security.dependabotSecurityUpdates,
      enabled:
        dependabotSecurityUpdatesResult.ok &&
        (dependabotSecurityUpdatesPayload === null ||
          dependabotSecurityUpdatesPayload.enabled === true),
      paused:
        dependabotSecurityUpdatesPayload?.paused === true
          ? true
          : dependabotSecurityUpdatesPayload?.paused === false
            ? false
            : null,
    },
  };
  security.ready =
    security.vulnerabilityAlerts.enabled ===
      security.vulnerabilityAlerts.required &&
    security.dependabotSecurityUpdates.enabled ===
      security.dependabotSecurityUpdates.required &&
    (!security.dependabotSecurityUpdates.required ||
      security.dependabotSecurityUpdates.paused !== true);
  const releaseProtection = inspectReleaseProtection(repository, run);

  const branches = Object.entries(repository.branches).map(
    ([name, expected]) => {
      const branch = run([
        "api",
        `repos/${repository.nameWithOwner}/branches/${name}`,
      ]);
      const branchPayload = resultJson(branch);
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
        sha: branchPayload?.commit?.sha || null,
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
  const mainBranch = branches.find(({ name }) => name === "main");
  const devBranch = branches.find(({ name }) => name === "dev");
  const historyRequired = Boolean(mainBranch && devBranch);
  const comparisonResult = historyRequired
    ? run(["api", `repos/${repository.nameWithOwner}/compare/main...dev`])
    : { ok: true, stdout: "" };
  const branchHistory = remoteBranchHistoryState({
    required: historyRequired,
    mainSha: mainBranch?.sha,
    devSha: devBranch?.sha,
    comparisonOk: comparisonResult.ok,
    comparison: resultJson(comparisonResult),
  });
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
      const environmentDetails =
        exists && expected.protection
          ? resultJson(
              run([
                "api",
                `repos/${repository.nameWithOwner}/environments/${name}`,
              ]),
            )
          : null;
      const deploymentPoliciesPayload =
        environmentDetails?.deployment_branch_policy?.custom_branch_policies ===
        true
          ? resultJson(
              run([
                "api",
                `repos/${repository.nameWithOwner}/environments/${name}/deployment-branch-policies`,
              ]),
            )
          : { branch_policies: [] };
      const reviewerAccess = expected.protection
        ? expected.protection.reviewers.map((reviewer) =>
            environmentReviewerAccess(repository, reviewer, run),
          )
        : [];
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
      const protection = expected.protection
        ? environmentProtectionState(
            expected.protection,
            environmentDetails,
            deploymentPoliciesPayload,
            reviewerAccess,
          )
        : null;
      return {
        name,
        exists,
        variables,
        secrets,
        ready:
          exists &&
          variables.every((variable) => variable.configured) &&
          secrets.every((secret) => secret.configured) &&
          (!protection || protection.ready),
        protection,
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
    security.ready &&
    releaseProtection.ready &&
    branches.every((branch) => branch.exists && branch.protectionMatches) &&
    branchHistory.ready &&
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
    security,
    releaseProtection,
    branches,
    branchHistory,
    environments,
    repositorySecrets,
    note: "Secret values are never requested or returned; only configured names are compared.",
  };
}

function environmentProtectionState(
  expected,
  environmentDetails,
  deploymentPoliciesPayload,
  reviewerAccess,
) {
  const protectionRules = environmentDetails?.protection_rules || [];
  const reviewerRule = protectionRules.find(
    (rule) => rule.type === "required_reviewers",
  );
  const waitRule = protectionRules.find((rule) => rule.type === "wait_timer");
  const remoteReviewers = (reviewerRule?.reviewers || [])
    .map((entry) => ({
      type: entry.type,
      id: Number(entry.reviewer?.id),
      name:
        entry.type === "Team"
          ? entry.reviewer?.slug || entry.reviewer?.name || null
          : entry.reviewer?.login || null,
    }))
    .filter((reviewer) => reviewer.type && reviewer.id > 0)
    .sort((left, right) =>
      `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`),
    );
  const expectedReviewers = [...expected.reviewers].sort((left, right) =>
    `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`),
  );
  const reviewersMatch =
    JSON.stringify(remoteReviewers.map(({ type, id }) => ({ type, id }))) ===
    JSON.stringify(expectedReviewers.map(({ type, id }) => ({ type, id })));
  const waitTimerMinutes = Number(waitRule?.wait_timer || 0);
  const waitTimerMatches = waitTimerMinutes === expected.waitTimerMinutes;
  const preventSelfReview = reviewerRule?.prevent_self_review === true;
  const preventSelfReviewMatches =
    preventSelfReview === expected.preventSelfReview;
  const allowAdminBypass = environmentDetails?.can_admins_bypass === true;
  const adminBypassMatches = allowAdminBypass === expected.allowAdminBypass;
  const remotePolicies = (deploymentPoliciesPayload?.branch_policies || [])
    .map((policy) => ({
      id: Number(policy.id),
      type: policy.type || "branch",
      pattern: policy.name,
    }))
    .filter((policy) => policy.pattern)
    .sort((left, right) =>
      `${left.type}:${left.pattern}`.localeCompare(
        `${right.type}:${right.pattern}`,
      ),
    );
  const expectedPolicies = [...expected.deploymentPolicies].sort(
    (left, right) =>
      `${left.type}:${left.pattern}`.localeCompare(
        `${right.type}:${right.pattern}`,
      ),
  );
  const deploymentPoliciesMatch =
    environmentDetails?.deployment_branch_policy?.protected_branches ===
      false &&
    environmentDetails?.deployment_branch_policy?.custom_branch_policies ===
      true &&
    JSON.stringify(
      remotePolicies.map(({ type, pattern }) => ({ type, pattern })),
    ) === JSON.stringify(expectedPolicies);
  const eligibleReviewerCount = reviewerAccess.filter(
    (reviewer) => reviewer.eligible,
  ).length;
  const eligibleReviewersReady =
    eligibleReviewerCount >= expected.minimumEligibleReviewers;
  const matches =
    environmentDetails !== null &&
    eligibleReviewersReady &&
    reviewersMatch &&
    waitTimerMatches &&
    preventSelfReviewMatches &&
    adminBypassMatches &&
    deploymentPoliciesMatch;
  return {
    enforcement: expected.enforcement,
    pendingReason: expected.pendingReason,
    eligibleReviewersReady,
    protectionDetailsAvailable: environmentDetails !== null,
    expectedMinimumEligibleReviewers: expected.minimumEligibleReviewers,
    configuredEligibleReviewers: expected.reviewers.length,
    eligibleReviewerCount,
    reviewerAccess,
    reviewersMatch,
    waitTimerMatches,
    preventSelfReviewMatches,
    adminBypassMatches,
    customDeploymentPoliciesEnabled:
      environmentDetails?.deployment_branch_policy?.protected_branches ===
        false &&
      environmentDetails?.deployment_branch_policy?.custom_branch_policies ===
        true,
    deploymentPoliciesMatch,
    matches,
    ready: expected.enforcement === "enforced" && matches,
    remote: {
      reviewers: remoteReviewers,
      waitTimerMinutes,
      preventSelfReview,
      allowAdminBypass,
      deploymentPolicies: remotePolicies,
    },
  };
}

function environmentReviewerAccess(repository, reviewer, run) {
  const [owner, repositoryName] = repository.nameWithOwner.split("/");
  if (reviewer.type === "User") {
    const payload = resultJson(
      run([
        "api",
        `repos/${repository.nameWithOwner}/collaborators/${reviewer.name}/permission`,
      ]),
    );
    const permission = payload?.permission || null;
    const eligible =
      Number(payload?.user?.id) === reviewer.id &&
      ["read", "triage", "write", "maintain", "admin"].includes(permission);
    return { ...reviewer, permission, eligible };
  }
  const teamPayload = resultJson(
    run(["api", `orgs/${owner}/teams/${reviewer.name}`]),
  );
  const repositoryPayload = resultJson(
    run([
      "api",
      `orgs/${owner}/teams/${reviewer.name}/repos/${owner}/${repositoryName}`,
    ]),
  );
  const permission =
    repositoryPayload?.role_name || repositoryPayload?.permission || null;
  const eligible =
    Number(teamPayload?.id) === reviewer.id &&
    (repositoryPayload?.permissions?.pull === true ||
      ["read", "triage", "write", "maintain", "admin"].includes(permission));
  return { ...reviewer, permission, eligible };
}

export function remoteBranchHistoryState({
  required,
  mainSha,
  devSha,
  comparisonOk,
  comparison,
}) {
  if (!required) {
    return {
      required: false,
      ready: true,
      status: "not-required",
      mainSha: mainSha || null,
      devSha: devSha || null,
      mergeBase: null,
    };
  }
  const validSha = (value) => /^[0-9a-f]{40}$/u.test(String(value || ""));
  const mergeBase = comparison?.merge_base_commit?.sha || null;
  const branchesExist = validSha(mainSha) && validSha(devSha);
  const mergeBaseValid = validSha(mergeBase);
  const ready = branchesExist && comparisonOk === true && mergeBaseValid;
  return {
    required: true,
    ready,
    status: ready
      ? "connected"
      : !branchesExist
        ? "branches-missing-or-invalid"
        : comparisonOk !== true
          ? "unrelated-or-inaccessible"
          : "invalid-comparison-response",
    mainSha: validSha(mainSha) ? mainSha : null,
    devSha: validSha(devSha) ? devSha : null,
    mergeBase: mergeBaseValid ? mergeBase : null,
  };
}
export function inspectReleaseProtection(repository, run = runGh) {
  const base = `repos/${repository.nameWithOwner}`;
  const immutableResult = run(["api", `${base}/immutable-releases`]);
  const immutablePayload = resultJson(immutableResult);
  const immutableReleases = {
    required: repository.releaseProtection.immutableReleases,
    enabled:
      immutableResult.ok &&
      (immutablePayload === null || immutablePayload.enabled === true),
    enforcedByOwner: immutablePayload?.enforced_by_owner === true,
  };

  const expectedRuleset = repository.releaseProtection.tagRuleset || null;
  let tagRuleset = { required: false, ready: true, status: "not-required" };
  if (expectedRuleset) {
    const rulesetsPayload = resultJson(
      run(["api", `${base}/rulesets?targets=tag&per_page=100`]),
    );
    const candidate = Array.isArray(rulesetsPayload)
      ? rulesetsPayload.find(
          (ruleset) =>
            ruleset.name === expectedRuleset.name && ruleset.target === "tag",
        )
      : null;
    const detail = candidate?.id
      ? resultJson(run(["api", `${base}/rulesets/${candidate.id}`]))
      : null;
    const actual = detail
      ? {
          id: detail.id,
          name: detail.name,
          target: detail.target,
          enforcement: detail.enforcement,
          bypassActors: detail.bypass_actors || [],
          include: detail.conditions?.ref_name?.include || [],
          exclude: detail.conditions?.ref_name?.exclude || [],
          rules: (detail.rules || []).map(({ type }) => type),
        }
      : null;
    const ready = Boolean(actual) && tagRulesetMatches(expectedRuleset, actual);
    tagRuleset = {
      required: true,
      ready,
      status: ready ? "active" : actual ? "drifted" : "missing",
      expected: expectedRuleset,
      actual,
    };
  }

  const releasesResult = run(["api", `${base}/releases?per_page=100`]);
  const releasesPayload = resultJson(releasesResult);
  const releaseInventoryReadable =
    releasesResult.ok && Array.isArray(releasesPayload);
  const mutablePublishedReleases = releaseInventoryReadable
    ? releasesPayload
        .filter((release) => release.draft !== true && release.immutable !== true)
        .map((release) => ({
          id: release.id || null,
          tagName: release.tag_name || null,
          assetCount: Array.isArray(release.assets) ? release.assets.length : 0,
        }))
    : null;
  const mutableReleaseCompensationReady =
    releaseInventoryReadable &&
    mutablePublishedReleases.every(
      ({ tagName, assetCount }) =>
        assetCount === 0 &&
        expectedRuleset !== null &&
        tagRuleset.ready &&
        expectedRuleset.include.some((pattern) =>
          refPatternMatches(pattern, `refs/tags/${tagName || ""}`),
        ),
    );
  const ready =
    immutableReleases.enabled === immutableReleases.required &&
    tagRuleset.ready &&
    releaseInventoryReadable &&
    mutableReleaseCompensationReady;
  return {
    ready,
    immutableReleases,
    tagRuleset,
    releaseInventoryReadable,
    mutablePublishedReleases,
    mutableReleaseCompensationReady,
    note:
      "Immutable releases affect only future publications. Existing mutable releases are accepted only when they contain no assets and an exact active no-bypass tag ruleset blocks tag update and deletion.",
  };
}

export function tagRulesetMatches(expected, actual) {
  const same = (left, right) =>
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  return (
    actual.name === expected.name &&
    actual.target === "tag" &&
    actual.enforcement === expected.enforcement &&
    Array.isArray(actual.bypassActors) &&
    actual.bypassActors.length === 0 &&
    same(actual.include || [], expected.include) &&
    (actual.exclude || []).length === 0 &&
    same(actual.rules || [], expected.rules)
  );
}

function refPatternMatches(pattern, ref) {
  const escaped = String(pattern).replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`, "u").test(ref);
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
