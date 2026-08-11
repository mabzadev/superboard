import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGitHubHistoryBridgePlan,
  buildGitHubHistoryPlan,
  buildGitHistoryBridgeProcedure,
  inspectGitHistory,
  remoteMatches,
} from "./github-history-plan.mjs";

const platform = {
  nameWithOwner: "mbzadev/superboard-platform",
};

test("history inspection detects unrelated remote main and its audit ref", () => {
  const head = "a".repeat(40);
  const remoteMain = "b".repeat(40);
  const results = new Map([
    ["branch --show-current", ok("dev")],
    ["rev-parse --verify HEAD", ok(head)],
    [
      "remote get-url origin",
      ok("https://github.com/mbzadev/superboard-platform.git"),
    ],
    ["rev-parse --verify refs/remotes/origin/main", ok(remoteMain)],
    ["rev-parse --verify refs/remotes/origin/dev", fail()],
    [
      `rev-parse --verify refs/remotes/origin/audit/pre-opengrow-main-${remoteMain.slice(0, 12)}`,
      fail(),
    ],
    [`merge-base ${head} ${remoteMain}`, fail()],
    ["status --porcelain=v1", ok("")],
  ]);
  const state = inspectGitHistory(
    "/workspace/platform",
    platform,
    (args) => results.get(args.join(" ")) ?? fail(),
  );
  assert.equal(state.remoteMatches, true);
  assert.equal(state.commonHistoryWithRemoteMain, false);
  assert.equal(state.remoteMainPreserved, false);
  assert.equal(state.clean, true);
});

test("plan preserves remote main before publishing dev", () => {
  const head = "a".repeat(40);
  const remoteMain = "b".repeat(40);
  const plan = buildGitHubHistoryPlan({ repositories: { platform } }, [
    {
      nameWithOwner: platform.nameWithOwner,
      branch: "dev",
      head,
      remoteUrl: "https://github.com/mbzadev/superboard-platform.git",
      remoteMatches: true,
      remoteMain,
      remoteDev: null,
      mergeBase: null,
      commonHistoryWithRemoteMain: false,
      clean: true,
      changedPaths: 0,
      archiveBranch: `audit/pre-opengrow-main-${remoteMain.slice(0, 12)}`,
      remoteArchive: null,
      remoteMainPreserved: false,
    },
  ]);
  assert.equal(plan.ready, false);
  assert.deepEqual(
    plan.repositories[0].operations.map(({ type }) => type),
    ["preserve-remote-main", "publish-dev"],
  );
  assert.equal(plan.repositories[0].unrelatedRemoteMain, true);
  assert.deepEqual(plan.repositories[0].blockers, []);
});

test("published remote main and dev without a merge base block readiness and emit a safe bridge procedure", () => {
  const head = "a".repeat(40);
  const remoteMain = "b".repeat(40);
  const archiveBranch = `audit/pre-opengrow-main-${remoteMain.slice(0, 12)}`;
  const plan = buildGitHubHistoryPlan({ repositories: { platform } }, [
    {
      nameWithOwner: platform.nameWithOwner,
      branch: "dev",
      head,
      remoteUrl: "https://github.com/mbzadev/superboard-platform.git",
      remoteMatches: true,
      remoteMain,
      remoteDev: head,
      remoteDevTree: "e".repeat(40),
      mergeBase: null,
      commonHistoryWithRemoteMain: false,
      remoteMainDevMergeBase: null,
      commonRemoteMainDevHistory: false,
      remoteDevMergeBase: head,
      remoteDevFastForward: true,
      clean: true,
      changedPaths: 0,
      archiveBranch,
      remoteArchive: remoteMain,
      remoteMainPreserved: true,
    },
  ]);

  assert.equal(plan.ready, false);
  assert.equal(plan.repositories[0].status, "blocked");
  assert.deepEqual(plan.repositories[0].blockers, [
    {
      type: "remote-main-dev-unrelated",
      main: remoteMain,
      dev: head,
      auditBranch: archiveBranch,
      auditPreserved: true,
    },
  ]);
  const bridge = plan.repositories[0].bridgeProcedure;
  assert.equal(bridge.status, "manual-bridge-required");
  assert.equal(bridge.remoteMutationPerformed, false);
  assert.deepEqual(bridge.requiredVerification.exactParentsInOrder, [
    head,
    remoteMain,
  ]);
  assert.equal(bridge.requiredVerification.exactTreeSha, "e".repeat(40));
  assert.equal(bridge.requiredVerification.treeSourceCommit, head);
  assert.match(bridge.bridgeBranch, /^history\/bridge-main-dev-/u);
  assert.equal(
    bridge.protectedMainProcedure.some((step) =>
      /squash or rebase/u.test(step),
    ),
    true,
  );

  const bridgePlan = buildGitHubHistoryBridgePlan(plan);
  assert.equal(bridgePlan.ready, false);
  assert.equal(bridgePlan.repositories[0].bridgeProcedure.mainSha, remoteMain);
  assert.match(bridgePlan.note, /performs no commit/u);
});

test("a shared remote merge base requires no bridge", () => {
  const remoteMain = "a".repeat(40);
  const remoteDev = "b".repeat(40);
  const mergeBase = "c".repeat(40);
  const bridge = buildGitHistoryBridgeProcedure({
    remoteMain,
    remoteDev,
    remoteMainDevMergeBase: mergeBase,
    commonRemoteMainDevHistory: true,
  });
  assert.equal(bridge, null);
});

test("dirty or unborn local histories block publication", () => {
  const plan = buildGitHubHistoryPlan({ repositories: { platform } }, [
    {
      nameWithOwner: platform.nameWithOwner,
      branch: "dev",
      head: null,
      remoteUrl: "git@github.com:mbzadev/superboard-platform.git",
      remoteMatches: true,
      remoteMain: "b".repeat(40),
      remoteDev: null,
      mergeBase: null,
      commonHistoryWithRemoteMain: null,
      clean: false,
      changedPaths: 32,
      archiveBranch: "audit/pre-opengrow-main-bbbbbbbbbbbb",
      remoteArchive: null,
      remoteMainPreserved: false,
    },
  ]);
  assert.deepEqual(
    plan.repositories[0].blockers.map(({ type }) => type),
    ["uncommitted-local-history", "local-history-missing"],
  );
  assert.deepEqual(plan.repositories[0].operations, []);
});

test("a blocked repository never emits a push command", () => {
  const head = "a".repeat(40);
  const remoteMain = "b".repeat(40);
  const plan = buildGitHubHistoryPlan({ repositories: { platform } }, [
    {
      nameWithOwner: platform.nameWithOwner,
      branch: "main",
      head,
      remoteUrl: "https://github.com/another/superboard-platform.git",
      remoteMatches: false,
      remoteMain,
      remoteDev: null,
      mergeBase: null,
      commonHistoryWithRemoteMain: false,
      clean: true,
      changedPaths: 0,
      archiveBranch: `audit/pre-opengrow-main-${remoteMain.slice(0, 12)}`,
      remoteArchive: null,
      remoteMainPreserved: false,
    },
  ]);
  assert.deepEqual(
    plan.repositories[0].blockers.map(({ type }) => type),
    ["origin-mismatch", "local-branch-mismatch"],
  );
  assert.deepEqual(plan.repositories[0].operations, []);
});

test("origin matching accepts canonical HTTPS and SSH forms only", () => {
  assert.equal(
    remoteMatches(
      "https://github.com/mbzadev/superboard-platform.git",
      platform.nameWithOwner,
    ),
    true,
  );
  assert.equal(
    remoteMatches(
      "git@github.com:mbzadev/superboard-platform.git",
      platform.nameWithOwner,
    ),
    true,
  );
  assert.equal(
    remoteMatches(
      "https://github.com/another/superboard-platform.git",
      platform.nameWithOwner,
    ),
    false,
  );
});

test("an occupied audit ref or divergent remote dev blocks publication", () => {
  const head = "a".repeat(40);
  const remoteMain = "b".repeat(40);
  const remoteDev = "c".repeat(40);
  const remoteArchive = "d".repeat(40);
  const plan = buildGitHubHistoryPlan({ repositories: { platform } }, [
    {
      nameWithOwner: platform.nameWithOwner,
      branch: "dev",
      head,
      remoteUrl: "git@github.com:mbzadev/superboard-platform.git",
      remoteMatches: true,
      remoteMain,
      remoteDev,
      mergeBase: null,
      commonHistoryWithRemoteMain: false,
      remoteDevMergeBase: null,
      remoteDevFastForward: false,
      clean: true,
      changedPaths: 0,
      archiveBranch: `audit/pre-opengrow-main-${remoteMain.slice(0, 12)}`,
      remoteArchive,
      remoteMainPreserved: false,
    },
  ]);
  assert.deepEqual(
    plan.repositories[0].blockers.map(({ type }) => type),
    [
      "audit-branch-conflict",
      "remote-dev-diverged",
      "remote-main-dev-unrelated",
    ],
  );
  assert.deepEqual(plan.repositories[0].operations, []);
});

function ok(stdout) {
  return { status: 0, stdout };
}

function fail() {
  return { status: 1, stdout: "" };
}
