import { spawnSync } from "node:child_process";

export const GITHUB_REST_API_VERSION = "2026-03-10";

export function githubJsonRequest(method, endpoint, body) {
  return {
    args: [
      "api",
      "--method",
      method,
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      `X-GitHub-Api-Version: ${GITHUB_REST_API_VERSION}`,
      endpoint,
      "--input",
      "-",
    ],
    body,
  };
}

export function repositorySettingsBody(repository) {
  const settings = repository.settings;
  return {
    description: repository.description,
    has_issues: settings.issues,
    has_projects: settings.projects,
    has_wiki: settings.wiki,
    has_downloads: settings.downloads,
    allow_squash_merge: settings.squashMerge,
    allow_merge_commit: settings.mergeCommit,
    allow_rebase_merge: settings.rebaseMerge,
    delete_branch_on_merge: settings.deleteBranchOnMerge,
  };
}

export function repositorySettingsState(payload) {
  return {
    description: String(payload?.description || ""),
    settings: {
      issues: payload?.has_issues === true,
      projects: payload?.has_projects === true,
      wiki: payload?.has_wiki === true,
      downloads: payload?.has_downloads === true,
      squashMerge: payload?.allow_squash_merge === true,
      mergeCommit: payload?.allow_merge_commit === true,
      rebaseMerge: payload?.allow_rebase_merge === true,
      deleteBranchOnMerge: payload?.delete_branch_on_merge === true,
    },
  };
}

export function repositorySettingsMatch(repository, payload) {
  const actual = repositorySettingsState(payload);
  return (
    actual.description === repository.description &&
    Object.entries(repository.settings).every(
      ([name, expected]) => actual.settings[name] === expected,
    )
  );
}

export function runGitHubMutation(args, body) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input: JSON.stringify(body),
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { ok: result.status === 0 };
}
