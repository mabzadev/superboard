import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGitHubHistoryPlan,
  inspectGitHistory,
  remoteMatches,
} from "./github-history-plan.mjs";

const platform = {
  nameWithOwner: "mbzadev/opengrow-platform",
};

test("history inspection detects unrelated remote main and its audit ref", () => {
  const head = "a".repeat(40);
  const remoteMain = "b".repeat(40);
  const results = new Map([
    ["branch --show-current", ok("dev")],
    ["rev-parse --verify HEAD", ok(head)],
    [
      "remote get-url origin",
      ok("https://github.com/mbzadev/opengrow-platform.git"),
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
      remoteUrl: "https://github.com/mbzadev/opengrow-platform.git",
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

test("dirty or unborn local histories block publication", () => {
  const plan = buildGitHubHistoryPlan({ repositories: { platform } }, [
    {
      nameWithOwner: platform.nameWithOwner,
      branch: "dev",
      head: null,
      remoteUrl: "git@github.com:mbzadev/opengrow-platform.git",
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
      remoteUrl: "https://github.com/another/opengrow-platform.git",
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
      "https://github.com/mbzadev/opengrow-platform.git",
      platform.nameWithOwner,
    ),
    true,
  );
  assert.equal(
    remoteMatches(
      "git@github.com:mbzadev/opengrow-platform.git",
      platform.nameWithOwner,
    ),
    true,
  );
  assert.equal(
    remoteMatches(
      "https://github.com/another/opengrow-platform.git",
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
      remoteUrl: "git@github.com:mbzadev/opengrow-platform.git",
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
    ["audit-branch-conflict", "remote-dev-diverged"],
  );
  assert.deepEqual(plan.repositories[0].operations, []);
});

function ok(stdout) {
  return { status: 0, stdout };
}

function fail() {
  return { status: 1, stdout: "" };
}
