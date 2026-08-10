#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseLockedGitDependencies,
  resolveRemoteTag,
} from "./reference-sdk-lock.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const sdkContracts = Object.freeze({
  flutter: Object.freeze({
    packageName: "opengrow_flutter",
    sourcePath: "sdks/flutter",
    releasePrefix: "sdk-flutter-v",
    coverageMode: "dart-transitive-override",
  }),
  flutterflow: Object.freeze({
    packageName: "opengrow_flutterflow",
    sourcePath: "sdks/flutterflow",
    releasePrefix: "sdk-flutterflow-v",
    coverageMode: "dart-direct",
  }),
  "flutterflow-support": Object.freeze({
    packageName: "opengrow_flutterflow_messaging",
    sourcePath: "sdks/flutterflow_messaging",
    releasePrefix: "sdk-flutterflow-messaging-v",
    coverageMode: "dart-direct",
  }),
  ios: Object.freeze({
    packageName: "OpenGrow",
    sourcePath: "sdks/ios",
    releasePrefix: "sdk-ios-v",
    coverageMode: "release-contract",
  }),
  android: Object.freeze({
    packageName: "io.opengrow:opengrow-android-sdk",
    sourcePath: "sdks/android/OpenGrow",
    releasePrefix: "sdk-android-v",
    coverageMode: "release-contract",
  }),
  javascript: Object.freeze({
    packageName: "@mbzadev/opengrow-js-sdk",
    sourcePath: "sdks/javascript",
    releasePrefix: "sdk-js-v",
    coverageMode: "release-contract",
  }),
  "react-native": Object.freeze({
    packageName: "@mbzadev/opengrow-react-native-sdk",
    sourcePath: "sdks/react-native",
    releasePrefix: "sdk-react-native-v",
    coverageMode: "release-contract",
  }),
});

function normalizedRepository(value) {
  return String(value).replace(/\.git$/u, "");
}

function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

export function gitDependency(source, sectionName, packageName) {
  const lines = source.split("\n");
  const sectionStart = lines.findIndex(
    (line) => line === `${sectionName}:`,
  );
  if (sectionStart < 0) throw new Error(`${sectionName} is missing from pubspec.yaml`);
  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z_][A-Za-z0-9_]*:\s*(?:#.*)?$/u.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }
  const packageRows = [];
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    if (lines[index] === `  ${packageName}:`) packageRows.push(index);
  }
  if (packageRows.length !== 1) {
    throw new Error(
      `${sectionName}.${packageName} must be declared exactly once in pubspec.yaml`,
    );
  }
  const start = packageRows[0];
  let end = sectionEnd;
  for (let index = start + 1; index < sectionEnd; index += 1) {
    if (/^  [^\s#][^:]*:\s*/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  const result = {};
  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(/^\s{6}(url|ref|path):\s*(.+?)\s*$/u);
    if (match) result[match[1]] = parseYamlScalar(match[2]);
  }
  for (const key of ["url", "ref", "path"]) {
    if (!result[key]) {
      throw new Error(`${sectionName}.${packageName} must declare Git ${key}`);
    }
  }
  return result;
}

export function validateSdkCoverage(manifest) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error("SDK coverage schemaVersion must be 1");
  }
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/u.test(manifest.platformRepository ?? "")) {
    throw new Error("SDK coverage platformRepository must be a public GitHub URL");
  }
  if (!Array.isArray(manifest.libraries)) {
    throw new Error("SDK coverage libraries must be an array");
  }
  const expectedIds = Object.keys(sdkContracts);
  const actualIds = manifest.libraries.map(({ id }) => id);
  if (
    actualIds.length !== expectedIds.length ||
    new Set(actualIds).size !== expectedIds.length ||
    expectedIds.some((id) => !actualIds.includes(id))
  ) {
    throw new Error(`SDK coverage must declare exactly: ${expectedIds.join(", ")}`);
  }
  for (const library of manifest.libraries) {
    const contract = sdkContracts[library.id];
    for (const key of ["packageName", "sourcePath", "coverageMode"]) {
      if (library[key] !== contract[key]) {
        throw new Error(`${library.id}.${key} must be ${contract[key]}`);
      }
    }
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(library.version ?? "")) {
      throw new Error(`${library.id}.version must be semantic`);
    }
    const expectedTag = `${contract.releasePrefix}${library.version}`;
    if (library.releaseTag !== expectedTag) {
      throw new Error(`${library.id}.releaseTag must be ${expectedTag}`);
    }
    const expectedRef = library.id === "ios" ? library.version : expectedTag;
    if (library.releaseRef !== expectedRef) {
      throw new Error(`${library.id}.releaseRef must be ${expectedRef}`);
    }
    if (!/^[0-9a-f]{40}$/u.test(library.releaseSha ?? "")) {
      throw new Error(`${library.id}.releaseSha must be a full commit SHA`);
    }
  }
  return manifest.libraries;
}

export function verifyReferenceCoverage({ manifest, project, pubspec, lockSource }) {
  const libraries = validateSdkCoverage(manifest);
  if (
    normalizedRepository(project.platformRepository) !==
    normalizedRepository(manifest.platformRepository)
  ) {
    throw new Error("SDK coverage repository must match reference.project.json");
  }
  const locked = parseLockedGitDependencies(lockSource);
  for (const library of libraries.filter(({ coverageMode }) =>
    coverageMode.startsWith("dart-"),
  )) {
    const dependency = locked.get(library.packageName);
    if (!dependency) {
      throw new Error(`${library.id} must be a Git dependency in pubspec.lock`);
    }
    const expected = {
      url: `${manifest.platformRepository}.git`,
      ref: library.releaseRef,
      path: library.sourcePath,
      version: library.version,
      "resolved-ref": library.releaseSha,
    };
    for (const [key, value] of Object.entries(expected)) {
      const actual =
        key === "url"
          ? `${normalizedRepository(dependency[key])}.git`
          : dependency[key];
      if (actual !== value) {
        throw new Error(`${library.id} lock ${key} must be ${value}, got ${actual ?? "none"}`);
      }
    }
    const section =
      library.coverageMode === "dart-transitive-override"
        ? "dependency_overrides"
        : "dependencies";
    const declaration = gitDependency(pubspec, section, library.packageName);
    for (const [key, value] of Object.entries({
      url: `${manifest.platformRepository}.git`,
      ref: library.releaseRef,
      path: library.sourcePath,
    })) {
      const actual =
        key === "url"
          ? `${normalizedRepository(declaration[key])}.git`
          : declaration[key];
      if (actual !== value) {
        throw new Error(`${library.id} pubspec ${key} must be ${value}`);
      }
    }
    if (library.coverageMode === "dart-direct") {
      const declared = project.libraries?.[library.packageName];
      if (
        !declared ||
        declared.path !== library.sourcePath ||
        declared.sourceVersion !== library.version ||
        declared.releaseVersion !== library.version ||
        declared.releaseRef !== library.releaseRef
      ) {
        throw new Error(`${library.id} must match reference.project.json`);
      }
    }
  }
  return libraries;
}

export function verifyCatalogueCoverage(manifest, catalogue) {
  const libraries = validateSdkCoverage(manifest);
  if (
    normalizedRepository(catalogue?.repository) !==
    normalizedRepository(manifest.platformRepository)
  ) {
    throw new Error("SDK catalogue repository must match the coverage manifest");
  }
  const catalogueLibraries = new Map(
    (catalogue.libraries ?? []).map((library) => [library.id, library]),
  );
  if (
    !Array.isArray(catalogue.libraries) ||
    catalogue.libraries.length !== libraries.length ||
    catalogueLibraries.size !== libraries.length
  ) {
    throw new Error("SDK catalogue must contain exactly the seven covered libraries");
  }
  for (const library of libraries) {
    const catalogued = catalogueLibraries.get(library.id);
    if (!catalogued) throw new Error(`${library.id} is missing from the SDK catalogue`);
    const expected = {
      packageName: library.packageName,
      sourcePath: library.sourcePath,
      sourceVersion: library.version,
      latestReleaseVersion: library.version,
      releaseStatus: "released",
      releaseRef: library.releaseRef,
      releaseSha: library.releaseSha,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (catalogued[key] !== value) {
        throw new Error(`${library.id} catalogue ${key} must be ${value}`);
      }
    }
  }
  return libraries;
}

async function defaultListRemote(repository, releaseRef) {
  const exactRef = `refs/tags/${releaseRef}`;
  const { stdout } = await execFileAsync("git", [
    "ls-remote",
    "--exit-code",
    "--tags",
    `${normalizedRepository(repository)}.git`,
    exactRef,
    `${exactRef}^{}`,
  ]);
  return stdout;
}

async function defaultReleaseExists(repository, releaseTag) {
  const response = await fetch(
    `${normalizedRepository(repository)}/releases/tag/${encodeURIComponent(releaseTag)}`,
    {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": "superboard-reference-sdk-coverage" },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub Release ${releaseTag} returned HTTP ${response.status}`);
  }
  return true;
}

export async function verifyRemoteCoverage({
  manifest,
  listRemote = defaultListRemote,
  releaseExists = defaultReleaseExists,
}) {
  const libraries = validateSdkCoverage(manifest);
  for (const library of libraries) {
    for (const ref of new Set([library.releaseRef, library.releaseTag])) {
      const output = await listRemote(manifest.platformRepository, ref);
      const remoteSha = resolveRemoteTag(output, ref);
      if (remoteSha !== library.releaseSha) {
        throw new Error(
          `${library.id} tag ${ref} resolves to ${remoteSha}, expected ${library.releaseSha}`,
        );
      }
    }
    if (!(await releaseExists(manifest.platformRepository, library.releaseTag))) {
      throw new Error(`GitHub Release ${library.releaseTag} does not exist`);
    }
  }
  return libraries;
}

function parseArguments(values) {
  const [command = "check", ...rest] = values;
  if (!new Set(["check", "verify-remote", "verify-catalog"]).has(command)) {
    throw new Error(
      "Usage: reference-sdk-coverage.mjs [check|verify-remote|verify-catalog --catalog <path>]",
    );
  }
  if (command !== "verify-catalog") {
    if (rest.length > 0) throw new Error(`${command} does not accept arguments`);
    return { command };
  }
  if (rest.length !== 2 || rest[0] !== "--catalog" || !rest[1]) {
    throw new Error("verify-catalog requires --catalog <path>");
  }
  return { command, catalog: path.resolve(rest[1]) };
}

async function run() {
  const args = parseArguments(process.argv.slice(2));
  const [manifestSource, projectSource, pubspec, lockSource] = await Promise.all([
    readFile(path.join(root, "config/sdk-coverage.json"), "utf8"),
    readFile(path.join(root, "reference.project.json"), "utf8"),
    readFile(path.join(root, "pubspec.yaml"), "utf8"),
    readFile(path.join(root, "pubspec.lock"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const project = JSON.parse(projectSource);
  let entries;
  if (args.command === "verify-remote") {
    verifyReferenceCoverage({ manifest, project, pubspec, lockSource });
    entries = await verifyRemoteCoverage({ manifest });
  } else if (args.command === "verify-catalog") {
    const catalogue = JSON.parse(await readFile(args.catalog, "utf8"));
    entries = verifyCatalogueCoverage(manifest, catalogue);
  } else {
    entries = verifyReferenceCoverage({ manifest, project, pubspec, lockSource });
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        sdkCoverage: entries.map(({ id, version, releaseTag, releaseSha, coverageMode }) => ({
          id,
          version,
          releaseTag,
          releaseSha,
          coverageMode,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
