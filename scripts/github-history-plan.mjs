#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGitHubControlPlane } from "./github-readiness.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function inspectGitHistory(
  path,
  repository,
  run = (args) => runGit(path, args),
) {
  const branch = optional(run(["branch", "--show-current"]));
  const head = optional(run(["rev-parse", "--verify", "HEAD"]));
  const remoteUrl = optional(run(["remote", "get-url", "origin"]));
  const remoteMain = optional(
    run(["rev-parse", "--verify", "refs/remotes/origin/main"]),
  );
  const remoteDev = optional(
    run(["rev-parse", "--verify", "refs/remotes/origin/dev"]),
  );
  const archiveBranch = remoteMain
    ? `audit/pre-opengrow-main-${remoteMain.slice(0, 12)}`
    : null;
  const remoteArchive = archiveBranch
    ? optional(
        run(["rev-parse", "--verify", `refs/remotes/origin/${archiveBranch}`]),
      )
    : null;
  const mergeBase =
    head && remoteMain ? optional(run(["merge-base", head, remoteMain])) : null;
  const remoteDevMergeBase =
    head && remoteDev ? optional(run(["merge-base", head, remoteDev])) : null;
  const status = optional(run(["status", "--porcelain=v1"])) ?? "";
  return {
    nameWithOwner: repository.nameWithOwner,
    path,
    branch,
    head,
    remoteUrl,
    remoteMatches: remoteMatches(remoteUrl, repository.nameWithOwner),
    remoteMain,
    remoteDev,
    mergeBase,
    commonHistoryWithRemoteMain: head && remoteMain ? Boolean(mergeBase) : null,
    remoteDevMergeBase,
    remoteDevFastForward:
      head && remoteDev ? remoteDevMergeBase === remoteDev : null,
    clean: status.length === 0,
    changedPaths: status ? status.split("\n").filter(Boolean).length : 0,
    archiveBranch,
    remoteArchive,
    remoteMainPreserved: Boolean(
      remoteMain && remoteArchive && remoteMain === remoteArchive,
    ),
  };
}

export function buildGitHubHistoryPlan(manifest, inspections) {
  const byName = new Map(
    inspections.map((inspection) => [inspection.nameWithOwner, inspection]),
  );
  const repositories = Object.values(manifest.repositories).map(
    (repository) => {
      const state = byName.get(repository.nameWithOwner);
      const blockers = [];
      const operations = [];
      let preserveRemoteMain = null;
      let publishDev = null;
      if (!state) {
        return {
          nameWithOwner: repository.nameWithOwner,
          blockers: [{ type: "checkout-not-inspected" }],
          operations,
        };
      }
      if (!state.remoteMatches) {
        blockers.push({
          type: "origin-mismatch",
          expected: repository.nameWithOwner,
          actual: state.remoteUrl,
        });
      }
      if (state.branch !== "dev") {
        blockers.push({
          type: "local-branch-mismatch",
          expected: "dev",
          actual: state.branch,
        });
      }
      if (!state.clean) {
        blockers.push({
          type: "uncommitted-local-history",
          changedPaths: state.changedPaths,
        });
      }
      if (!state.head) {
        blockers.push({ type: "local-history-missing" });
      }
      if (!state.remoteMain) {
        blockers.push({ type: "remote-main-missing" });
      } else if (
        state.remoteMain !== state.head &&
        !state.remoteMainPreserved
      ) {
        if (state.remoteArchive) {
          blockers.push({
            type: "audit-branch-conflict",
            branch: state.archiveBranch,
            expected: state.remoteMain,
            actual: state.remoteArchive,
          });
        } else {
          preserveRemoteMain = {
            type: "preserve-remote-main",
            branch: state.archiveBranch,
            sha: state.remoteMain,
            command: [
              "git",
              "push",
              "origin",
              `refs/remotes/origin/main:refs/heads/${state.archiveBranch}`,
            ],
          };
        }
      }
      if (state.head && state.remoteDev !== state.head) {
        if (state.remoteDev && state.remoteDevFastForward !== true) {
          blockers.push({
            type: "remote-dev-diverged",
            local: state.head,
            remote: state.remoteDev,
            mergeBase: state.remoteDevMergeBase,
          });
        } else {
          publishDev = {
            type: state.remoteDev ? "update-dev" : "publish-dev",
            branch: "dev",
            sha: state.head,
            command: ["git", "push", "--set-upstream", "origin", "dev"],
          };
        }
      }
      if (blockers.length === 0) {
        if (preserveRemoteMain) operations.push(preserveRemoteMain);
        if (publishDev) operations.push(publishDev);
      }
      return {
        ...state,
        status:
          blockers.length > 0
            ? "blocked"
            : operations.length > 0
              ? "manual-operations-required"
              : "ready",
        unrelatedRemoteMain:
          state.head && state.remoteMain
            ? state.commonHistoryWithRemoteMain === false
            : null,
        blockers,
        operations,
      };
    },
  );
  return {
    schemaVersion: 1,
    mode: "local-read-only-history-plan",
    ready: repositories.every(
      ({ blockers, operations }) =>
        blockers.length === 0 && operations.length === 0,
    ),
    repositories,
    note: "Commands are evidence only. This plan never commits, creates a remote branch or pushes a ref; a blocked repository emits no executable operation.",
  };
}

export function remoteMatches(url, nameWithOwner) {
  if (!url) return false;
  const normalized = String(url)
    .trim()
    .replace(/^git@github\.com:/u, "")
    .replace(/^https:\/\/github\.com\//u, "")
    .replace(/\.git$/u, "")
    .replace(/\/$/u, "");
  return normalized.toLowerCase() === nameWithOwner.toLowerCase();
}

function optional(result) {
  if (!result || result.status !== 0) return null;
  return String(result.stdout ?? "").trim() || null;
}

function runGit(path, args) {
  return spawnSync("git", args, {
    cwd: path,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const manifest = await loadGitHubControlPlane();
  const paths = {
    platform: resolve(optionValue("--platform-path", root)),
    reference: resolve(
      optionValue(
        "--reference-path",
        process.env.OPENGROW_REFERENCE_PATH ||
          resolve(root, "../grow-reference"),
      ),
    ),
  };
  if (process.argv.includes("--fetch")) {
    for (const path of Object.values(paths)) {
      const result = runGit(path, ["fetch", "origin", "--prune"]);
      if (result.status !== 0) {
        throw new Error(`Unable to refresh origin in ${path}`);
      }
    }
  }
  const inspections = Object.entries(paths).map(([key, path]) =>
    inspectGitHistory(path, manifest.repositories[key]),
  );
  const plan = buildGitHubHistoryPlan(manifest, inspections);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!plan.ready) process.exitCode = 2;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
