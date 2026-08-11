import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaPattern = /^[0-9a-f]{40}$/u;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const branchPattern = /^(?!-)(?!.*(?:\.\.|\/\/|@\{|\\))[A-Za-z0-9._/-]+$/u;

function exactString(value, field) {
  if (typeof value !== "string" || value.trim() !== value || !value) {
    throw new Error(`${field} must be an exact, non-empty string.`);
  }
  return value;
}

function exactSha(value, field) {
  const sha = exactString(value, field);
  if (!shaPattern.test(sha)) {
    throw new Error(`${field} must be a lowercase 40-character commit SHA.`);
  }
  return sha;
}

function safeRepository(value, field) {
  const repository = exactString(value, field);
  if (!repositoryPattern.test(repository)) {
    throw new Error(`${field} must be an exact owner/repository slug.`);
  }
  return repository;
}

export function safeGitBranch(value, field = "branch") {
  const branch = exactString(value, field);
  const segments = branch.split("/");
  if (
    !branchPattern.test(branch) ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    segments.some(
      (segment) =>
        !segment ||
        segment.startsWith(".") ||
        segment.endsWith(".") ||
        segment.endsWith(".lock"),
    )
  ) {
    throw new Error(`${field} must be a safe Git branch name.`);
  }
  return branch;
}

export function expectedHistoryBridgeNames({
  baseRef,
  defaultBranch,
  baseSha,
  developmentSha,
}) {
  const safeBaseRef = safeGitBranch(baseRef, "baseRef");
  const safeDefaultBranch = safeGitBranch(defaultBranch, "defaultBranch");
  const safeBaseSha = exactSha(baseSha, "baseSha");
  const safeDevelopmentSha = exactSha(developmentSha, "developmentSha");
  return {
    auditBranch: `audit/pre-opengrow-${safeBaseRef}-${safeBaseSha.slice(0, 12)}`,
    bridgeBranch: `history/bridge-${safeBaseRef}-${safeDefaultBranch}-${safeBaseSha.slice(0, 12)}-${safeDevelopmentSha.slice(0, 12)}`,
  };
}

export function validateHistoryBridgeEvidence(evidence) {
  if (evidence?.eventName !== "pull_request") {
    throw new Error("History bridge validation is reserved for pull requests.");
  }
  const repository = safeRepository(evidence.repository, "repository");
  const headRepository = safeRepository(
    evidence.headRepository,
    "headRepository",
  );
  if (headRepository !== repository) {
    throw new Error(
      "History bridge pull requests must originate in this repository.",
    );
  }

  const baseRef = safeGitBranch(evidence.baseRef, "baseRef");
  const headRef = safeGitBranch(evidence.headRef, "headRef");
  const defaultBranch = safeGitBranch(evidence.defaultBranch, "defaultBranch");
  if (baseRef === defaultBranch) {
    throw new Error("History bridge base and development branches must differ.");
  }

  const baseSha = exactSha(evidence.baseSha, "baseSha");
  const headSha = exactSha(evidence.headSha, "headSha");
  const remoteBaseSha = exactSha(evidence.remoteBaseSha, "remoteBaseSha");
  const remoteHeadSha = exactSha(evidence.remoteHeadSha, "remoteHeadSha");
  const remoteDevelopmentSha = exactSha(
    evidence.remoteDevelopmentSha,
    "remoteDevelopmentSha",
  );
  const remoteAuditSha = exactSha(evidence.remoteAuditSha, "remoteAuditSha");
  const headTree = exactSha(evidence.headTree, "headTree");
  const developmentTree = exactSha(
    evidence.developmentTree,
    "developmentTree",
  );
  const mergeBase = exactSha(evidence.mergeBase, "mergeBase");

  if (remoteBaseSha !== baseSha) {
    throw new Error(
      "The protected bridge base advanced after the pull request event.",
    );
  }
  if (remoteHeadSha !== headSha) {
    throw new Error(
      "The dedicated bridge branch advanced after the pull request event.",
    );
  }
  if (remoteAuditSha !== baseSha) {
    throw new Error(
      "The permanent pre-OpenGrow audit branch does not preserve the base.",
    );
  }
  if (!Array.isArray(evidence.parents) || evidence.parents.length !== 2) {
    throw new Error("The bridge commit must have exactly two parents.");
  }
  const parents = evidence.parents.map((parent, index) =>
    exactSha(parent, `parents[${index}]`),
  );
  if (parents[0] !== remoteDevelopmentSha || parents[1] !== baseSha) {
    throw new Error(
      "Bridge parents must be the exact official development head followed by the exact protected base.",
    );
  }
  if (headSha === baseSha || headSha === remoteDevelopmentSha) {
    throw new Error("The bridge head must be a distinct two-parent commit.");
  }
  if (headTree !== developmentTree) {
    throw new Error(
      "The bridge tree must equal the exact official development tree.",
    );
  }
  if (mergeBase !== baseSha) {
    throw new Error(
      "The protected base must be the exact merge base of the bridge head.",
    );
  }

  const names = expectedHistoryBridgeNames({
    baseRef,
    defaultBranch,
    baseSha,
    developmentSha: remoteDevelopmentSha,
  });
  if (headRef !== names.bridgeBranch) {
    throw new Error(
      `History bridge branch must be exactly ${names.bridgeBranch}.`,
    );
  }

  return {
    validated: true,
    ...names,
    baseSha,
    headSha,
    developmentSha: remoteDevelopmentSha,
    developmentBranch: defaultBranch,
  };
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function remoteHead(branch) {
  safeGitBranch(branch, "remote branch");
  const lines = runGit([
    "ls-remote",
    "--exit-code",
    "origin",
    `refs/heads/${branch}`,
  ])
    .split("\n")
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(`Remote branch ${branch} did not resolve exactly once.`);
  }
  const [sha, ref, unexpected] = lines[0].split(/\s+/u);
  if (unexpected || ref !== `refs/heads/${branch}`) {
    throw new Error(`Remote branch ${branch} returned unexpected evidence.`);
  }
  return exactSha(sha, `remote ${branch}`);
}

function environmentEvidence(environment = process.env) {
  const baseRef = safeGitBranch(
    environment.BRIDGE_BASE_REF,
    "BRIDGE_BASE_REF",
  );
  const headRef = safeGitBranch(
    environment.BRIDGE_HEAD_REF,
    "BRIDGE_HEAD_REF",
  );
  const baseSha = exactSha(environment.BRIDGE_BASE_SHA, "BRIDGE_BASE_SHA");
  const headSha = exactSha(environment.BRIDGE_HEAD_SHA, "BRIDGE_HEAD_SHA");
  const defaultBranch = safeGitBranch(
    environment.DEFAULT_BRANCH,
    "DEFAULT_BRANCH",
  );
  const remoteDevelopmentSha = remoteHead(defaultBranch);
  const { auditBranch } = expectedHistoryBridgeNames({
    baseRef,
    defaultBranch,
    baseSha,
    developmentSha: remoteDevelopmentSha,
  });
  const parents = runGit(["show", "--no-patch", "--format=%P", headSha])
    .split(/\s+/u)
    .filter(Boolean);

  return {
    eventName: environment.GITHUB_EVENT_NAME,
    repository: environment.GITHUB_REPOSITORY,
    headRepository: environment.BRIDGE_HEAD_REPOSITORY,
    baseRef,
    headRef,
    baseSha,
    headSha,
    defaultBranch,
    remoteBaseSha: remoteHead(baseRef),
    remoteHeadSha: remoteHead(headRef),
    remoteDevelopmentSha,
    remoteAuditSha: remoteHead(auditBranch),
    parents,
    headTree: runGit(["rev-parse", `${headSha}^{tree}`]),
    developmentTree: runGit([
      "rev-parse",
      `${remoteDevelopmentSha}^{tree}`,
    ]),
    mergeBase: runGit(["merge-base", baseSha, headSha]),
  };
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("reference-history-bridge.mjs accepts no arguments.");
  }
  const result = validateHistoryBridgeEvidence(environmentEvidence());
  process.stdout.write("validated=true\n");
  process.stdout.write(`development_sha=${result.developmentSha}\n`);
  process.stdout.write(`development_branch=${result.developmentBranch}\n`);
  process.stdout.write(`audit_branch=${result.auditBranch}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
