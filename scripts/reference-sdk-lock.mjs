#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function normalizedRepository(value) {
  return String(value).replace(/\.git$/u, "");
}

export function parseLockedGitDependencies(lockSource) {
  const lines = lockSource.split("\n");
  const dependencies = new Map();
  let currentName;
  let current;

  function commitCurrent() {
    if (currentName && current?.source === "git") {
      dependencies.set(currentName, current);
    }
  }

  for (const line of lines) {
    const packageRow = line.match(/^  ([a-z0-9_]+):\s*$/u);
    if (packageRow) {
      commitCurrent();
      currentName = packageRow[1];
      current = {};
      continue;
    }
    if (!current) continue;
    const sourceRow = line.match(/^    source:\s*(\S+)\s*$/u);
    if (sourceRow) {
      current.source = parseScalar(sourceRow[1]);
      continue;
    }
    const descriptionRow = line.match(
      /^      (path|ref|resolved-ref|url):\s*(.+?)\s*$/u,
    );
    if (descriptionRow) {
      current[descriptionRow[1]] = parseScalar(descriptionRow[2]);
    }
  }
  commitCurrent();
  return dependencies;
}

export function immutableSdkLocks(project, lockSource) {
  const locked = parseLockedGitDependencies(lockSource);
  const result = [];
  for (const [packageName, library] of Object.entries(project.libraries ?? {})) {
    if (library.sourceVersion !== library.releaseVersion) continue;
    const dependency = locked.get(packageName);
    if (!dependency) {
      throw new Error(`${packageName} is missing from pubspec.lock as a Git dependency`);
    }
    if (dependency.ref !== library.releaseRef) {
      throw new Error(
        `${packageName} lock ref must be ${library.releaseRef}, got ${dependency.ref ?? "none"}`,
      );
    }
    if (dependency.path !== library.path) {
      throw new Error(
        `${packageName} lock path must be ${library.path}, got ${dependency.path ?? "none"}`,
      );
    }
    if (
      normalizedRepository(dependency.url) !==
      normalizedRepository(project.platformRepository)
    ) {
      throw new Error(`${packageName} lock URL must match platformRepository`);
    }
    if (!/^[0-9a-f]{40}$/u.test(dependency["resolved-ref"] ?? "")) {
      throw new Error(`${packageName} must have a full resolved-ref in pubspec.lock`);
    }
    result.push({
      packageName,
      releaseRef: library.releaseRef,
      resolvedRef: dependency["resolved-ref"],
    });
  }
  if (result.length === 0) {
    throw new Error("No fully published SDK dependency is locked");
  }
  return result;
}

export function resolveRemoteTag(output, releaseRef) {
  const exactRef = `refs/tags/${releaseRef}`;
  const peeledRef = `${exactRef}^{}`;
  let exact;
  let peeled;
  for (const line of output.trim().split("\n")) {
    if (!line) continue;
    const [sha, ref, ...extra] = line.split(/\s+/u);
    if (extra.length > 0 || !/^[0-9a-f]{40}$/u.test(sha ?? "")) {
      throw new Error(`Invalid git ls-remote output for ${releaseRef}`);
    }
    if (ref === exactRef) {
      if (exact) throw new Error(`Duplicate remote tag ${exactRef}`);
      exact = sha;
    } else if (ref === peeledRef) {
      if (peeled) throw new Error(`Duplicate remote tag ${peeledRef}`);
      peeled = sha;
    } else {
      throw new Error(`Unexpected remote ref ${ref} for ${releaseRef}`);
    }
  }
  const resolved = peeled ?? exact;
  if (!resolved) throw new Error(`Remote tag ${releaseRef} does not exist`);
  return resolved;
}

export async function verifyRemoteImmutableSdkTags({
  project,
  lockSource,
  listRemote = async (repository, releaseRef) => {
    const exactRef = `refs/tags/${releaseRef}`;
    const { stdout } = await execFileAsync("git", [
      "ls-remote",
      "--exit-code",
      "--tags",
      repository,
      exactRef,
      `${exactRef}^{}`,
    ]);
    return stdout;
  },
}) {
  const entries = immutableSdkLocks(project, lockSource);
  for (const entry of entries) {
    const output = await listRemote(project.platformRepository, entry.releaseRef);
    const remoteRef = resolveRemoteTag(output, entry.releaseRef);
    if (remoteRef !== entry.resolvedRef) {
      throw new Error(
        `${entry.packageName} tag ${entry.releaseRef} resolves to ${remoteRef}, ` +
          `but pubspec.lock pins ${entry.resolvedRef}`,
      );
    }
  }
  return entries;
}

async function run() {
  const command = process.argv[2] ?? "check";
  if (!new Set(["check", "verify-remote"]).has(command)) {
    throw new Error("Usage: reference-sdk-lock.mjs [check|verify-remote]");
  }
  const [projectSource, lockSource] = await Promise.all([
    readFile(path.join(root, "reference.project.json"), "utf8"),
    readFile(path.join(root, "pubspec.lock"), "utf8"),
  ]);
  const project = JSON.parse(projectSource);
  const entries =
    command === "verify-remote"
      ? await verifyRemoteImmutableSdkTags({ project, lockSource })
      : immutableSdkLocks(project, lockSource);
  process.stdout.write(`${JSON.stringify({ immutableSdkLocks: entries }, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  run().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
