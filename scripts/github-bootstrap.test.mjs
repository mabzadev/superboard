import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGitHubBootstrapPlan,
  buildGitHubBootstrapPlan,
  githubBootstrapConfirmation,
  inspectRepositoryAvailability,
  repositoryCreationRequest,
} from "./github-bootstrap.mjs";

function manifest() {
  return {
    schemaVersion: 5,
    owner: {
      login: "mbzadev",
      type: "user",
    },
    repositories: {
      platform: {
        nameWithOwner: "mbzadev/opengrow-platform",
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
      },
      reference: {
        nameWithOwner: "mbzadev/opengrow-reference",
        description: "OpenGrow reference application",
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
      },
    },
  };
}

test("bootstrap plans only unavailable declared repositories", () => {
  const plan = buildGitHubBootstrapPlan(manifest(), [
    {
      nameWithOwner: "mbzadev/opengrow-platform",
      status: "missing-or-inaccessible",
      ready: false,
    },
    {
      nameWithOwner: "mbzadev/opengrow-reference",
      status: "present",
    },
  ]);
  assert.equal(plan.ready, false);
  assert.deepEqual(
    plan.repositories.flatMap(({ operations }) => operations),
    [
      {
        type: "create-repository",
        nameWithOwner: "mbzadev/opengrow-platform",
        description: "OpenGrow platform",
        visibility: "public",
        settings: manifest().repositories.platform.settings,
      },
    ],
  );
  assert.match(plan.confirmation, /^GITHUB:BOOTSTRAP:5:[a-f0-9]{12}$/u);
  assert.equal(plan.confirmation, githubBootstrapConfirmation(plan));
  assert.match(plan.repositories[0].warning, /HTTP 404/u);
});

test("bootstrap confirmation changes with declarative repository settings", () => {
  const configuration = manifest();
  const inspection = Object.values(configuration.repositories).map(
    (repository) => ({
      nameWithOwner: repository.nameWithOwner,
      status: "missing-or-inaccessible",
    }),
  );
  const first = buildGitHubBootstrapPlan(configuration, inspection);
  const changed = structuredClone(configuration);
  changed.repositories.platform.settings.wiki = true;
  const second = buildGitHubBootstrapPlan(changed, inspection);
  assert.notEqual(first.confirmation, second.confirmation);
});

test("bootstrap is ready when every declared repository exists", () => {
  const plan = buildGitHubBootstrapPlan(manifest(), [
    {
      nameWithOwner: "mbzadev/opengrow-platform",
      status: "present",
    },
    { nameWithOwner: "mbzadev/opengrow-reference", status: "present" },
  ]);
  assert.equal(plan.ready, true);
  assert.equal(
    plan.repositories.every(({ operations }) => operations.length === 0),
    true,
  );
});

test("bootstrap blocks absent or invalid inspection state", () => {
  const plan = buildGitHubBootstrapPlan(manifest(), [
    {
      nameWithOwner: "mbzadev/opengrow-platform",
      status: "inspection-failed",
    },
  ]);
  assert.deepEqual(
    plan.repositories.map(({ blockers }) => blockers.map(({ type }) => type)),
    [["repository-inspection-failed"], ["repository-not-inspected"]],
  );
});

test("availability inspection accepts only success or an explicit HTTP 404", () => {
  const repository = manifest().repositories.platform;
  assert.deepEqual(
    inspectRepositoryAvailability(repository, () => ({
      ok: true,
      httpStatus: 200,
    })),
    { nameWithOwner: repository.nameWithOwner, status: "present" },
  );
  assert.deepEqual(
    inspectRepositoryAvailability(repository, () => ({
      ok: false,
      httpStatus: 404,
    })),
    {
      nameWithOwner: repository.nameWithOwner,
      status: "missing-or-inaccessible",
    },
  );
});

test("availability inspection blocks authentication and network failures", () => {
  const repository = manifest().repositories.platform;
  for (const result of [
    { ok: false, httpStatus: 401 },
    { ok: false, httpStatus: 403 },
    { ok: false, httpStatus: null },
  ]) {
    assert.deepEqual(
      inspectRepositoryAvailability(repository, () => result),
      {
        nameWithOwner: repository.nameWithOwner,
        status: "inspection-failed",
      },
    );
  }
});

test("repository creation follows the declared public visibility and user owner", () => {
  const configuration = manifest();
  const request = repositoryCreationRequest(
    configuration.repositories.platform,
    configuration.owner,
  );
  assert.equal(request.args.includes("X-GitHub-Api-Version: 2026-03-10"), true);
  assert.equal(request.args.includes("user/repos"), true);
  assert.equal(request.args.at(-2), "--input");
  assert.equal(request.args.at(-1), "-");
  assert.deepEqual(request.body, {
    name: "opengrow-platform",
    description: "OpenGrow platform",
    visibility: "public",
    auto_init: false,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    has_downloads: false,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
  });
  assert.equal(JSON.stringify(request.body).includes("TOKEN"), false);
});

test("bootstrap refuses mutation without its plan-specific confirmation", () => {
  const configuration = manifest();
  const plan = buildGitHubBootstrapPlan(configuration, [
    {
      nameWithOwner: "mbzadev/opengrow-platform",
      status: "missing-or-inaccessible",
    },
    { nameWithOwner: "mbzadev/opengrow-reference", status: "present" },
  ]);
  let calls = 0;
  assert.throws(
    () =>
      applyGitHubBootstrapPlan(plan, configuration, {
        confirm: "GITHUB:BOOTSTRAP:5:wrong",
        run: () => {
          calls += 1;
          return { ok: true };
        },
      }),
    /pass --confirm GITHUB:BOOTSTRAP:5:/u,
  );
  assert.equal(calls, 0);
});

test("confirmed bootstrap creates only the planned repositories", () => {
  const configuration = manifest();
  const plan = buildGitHubBootstrapPlan(configuration, [
    {
      nameWithOwner: "mbzadev/opengrow-platform",
      status: "missing-or-inaccessible",
    },
    { nameWithOwner: "mbzadev/opengrow-reference", status: "present" },
  ]);
  const calls = [];
  const applied = applyGitHubBootstrapPlan(plan, configuration, {
    confirm: plan.confirmation,
    run: (args, body) => {
      calls.push({ args, body });
      return { ok: true };
    },
  });
  assert.deepEqual(applied, [
    {
      repository: "mbzadev/opengrow-platform",
      type: "create-repository",
    },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.name, "opengrow-platform");
});

test("bootstrap rejects an owner mismatch", () => {
  assert.throws(
    () =>
      repositoryCreationRequest(
        {
          nameWithOwner: "mbzadev/public-project",
          description: "Unsafe",
          visibility: "public",
        },
        {
          login: "another-owner",
          type: "user",
        },
      ),
    /Repository owner mismatch/u,
  );
});
