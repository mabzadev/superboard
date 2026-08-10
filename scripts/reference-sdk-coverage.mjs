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
const semanticVersion = /^[0-9]+\.[0-9]+\.[0-9]+$/u;

export const sdkContracts = Object.freeze({
  flutter: Object.freeze({
    lifecycle: "active",
    packageName: "opengrow_flutter",
    candidatePackageName: "superboard_flutter",
    sourcePath: "sdks/flutter",
    releasePrefix: "sdk-flutter-v",
    coverageMode: "dart-transitive-override",
  }),
  flutterflow: Object.freeze({
    lifecycle: "active",
    packageName: "opengrow_flutterflow",
    candidatePackageName: "superboard_flutterflow",
    sourcePath: "sdks/flutterflow",
    releasePrefix: "sdk-flutterflow-v",
    coverageMode: "dart-direct",
  }),
  "flutterflow-support": Object.freeze({
    lifecycle: "archived",
    packageName: "opengrow_flutterflow_messaging",
    sourcePath: "sdks/flutterflow_messaging",
    releasePrefix: "sdk-flutterflow-messaging-v",
    coverageMode: "dart-legacy-direct",
    promotedCoverageMode: "historical-release",
  }),
  ios: Object.freeze({
    lifecycle: "internal",
    packageName: "OpenGrow",
    sourcePath: "sdks/ios",
    releasePrefix: "sdk-ios-v",
    coverageMode: "historical-release",
  }),
  android: Object.freeze({
    lifecycle: "internal",
    packageName: "io.opengrow:opengrow-android-sdk",
    sourcePath: "sdks/android/OpenGrow",
    releasePrefix: "sdk-android-v",
    coverageMode: "historical-release",
  }),
  javascript: Object.freeze({
    lifecycle: "archived",
    packageName: "@mbzadev/opengrow-js-sdk",
    sourcePath: "sdks/javascript",
    releasePrefix: "sdk-js-v",
    coverageMode: "historical-release",
  }),
  "react-native": Object.freeze({
    lifecycle: "archived",
    packageName: "@mbzadev/opengrow-react-native-sdk",
    sourcePath: "sdks/react-native",
    releasePrefix: "sdk-react-native-v",
    coverageMode: "historical-release",
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
  const sectionStart = lines.findIndex((line) => line === `${sectionName}:`);
  if (sectionStart < 0) {
    throw new Error(`${sectionName} is missing from pubspec.yaml`);
  }
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

function expectedBaselineTag(contract, version) {
  return `${contract.releasePrefix}${version}`;
}

function isActiveReleased(library) {
  return (
    library.lifecycle === "active" &&
    library.catalogueStatus === "released" &&
    library.sourceVersion === library.baselineVersion
  );
}

export function sdkReadiness(libraries) {
  const lifecycle = Object.fromEntries(
    ["active", "internal", "archived"].map((value) => [
      value,
      libraries.filter((library) => library.lifecycle === value).length,
    ]),
  );
  const active = libraries.filter((library) => library.lifecycle === "active");
  const pendingActive = active
    .filter((library) => !isActiveReleased(library))
    .map((library) => ({
      id: library.id,
      baselineVersion: library.baselineVersion,
      candidateVersion: library.sourceVersion,
      candidatePackageName: library.candidatePackageName,
      candidateRef: library.candidateRef,
      status: library.catalogueStatus,
    }));
  return {
    lifecycle,
    activeIds: active.map(({ id }) => id),
    pendingActive,
    promotionReady: active.length === 2 && pendingActive.length === 0,
  };
}

export function validateSdkCoverage(manifest) {
  if (manifest?.schemaVersion !== 2) {
    throw new Error("SDK coverage schemaVersion must be 2");
  }
  if (manifest?.catalogueSchemaVersion !== 4) {
    throw new Error("SDK coverage catalogueSchemaVersion must be 4");
  }
  if (manifest?.promotionPolicy !== "complete-active-set") {
    throw new Error("SDK coverage promotionPolicy must be complete-active-set");
  }
  if (
    !/^https:\/\/github\.com\/[^/]+\/[^/]+$/u.test(
      manifest.platformRepository ?? "",
    )
  ) {
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
    for (const key of ["lifecycle", "sourcePath"]) {
      if (library[key] !== contract[key]) {
        throw new Error(`${library.id}.${key} must be ${contract[key]}`);
      }
    }
    if (
      library.coverageMode !== contract.coverageMode &&
      library.coverageMode !== contract.promotedCoverageMode
    ) {
      throw new Error(`${library.id}.coverageMode is invalid`);
    }
    for (const key of ["sourceVersion", "baselineVersion"]) {
      if (!semanticVersion.test(library[key] ?? "")) {
        throw new Error(`${library.id}.${key} must be semantic`);
      }
    }
    const baselineTag = expectedBaselineTag(contract, library.baselineVersion);
    if (library.baselineTag !== baselineTag) {
      throw new Error(`${library.id}.baselineTag must be ${baselineTag}`);
    }
    const baselineRef = library.id === "ios" ? library.baselineVersion : baselineTag;
    if (library.baselineRef !== baselineRef) {
      throw new Error(`${library.id}.baselineRef must be ${baselineRef}`);
    }
    if (!/^[0-9a-f]{40}$/u.test(library.baselineSha ?? "")) {
      throw new Error(`${library.id}.baselineSha must be a full commit SHA`);
    }
    if (library.lifecycle === "active") {
      const pending = library.catalogueStatus === "pending-release";
      const released = isActiveReleased(library);
      if (!pending && !released) {
        throw new Error(`${library.id} active release state is inconsistent`);
      }
      if (pending) {
        if (library.packageName !== contract.packageName) {
          throw new Error(`${library.id}.packageName must keep the published baseline`);
        }
        if (library.candidatePackageName !== contract.candidatePackageName) {
          throw new Error(
            `${library.id}.candidatePackageName must be ${contract.candidatePackageName}`,
          );
        }
        if (library.sourceVersion === library.baselineVersion) {
          throw new Error(`${library.id} pending candidate must advance the baseline`);
        }
        const candidateRef = `${contract.releasePrefix}${library.sourceVersion}`;
        if (library.candidateRef !== candidateRef) {
          throw new Error(`${library.id}.candidateRef must be ${candidateRef}`);
        }
      } else {
        if (library.packageName !== contract.candidatePackageName) {
          throw new Error(`${library.id} released v3 must use the SuperBoard package`);
        }
        if (library.candidatePackageName || library.candidateRef) {
          throw new Error(`${library.id} released baseline must not retain a candidate`);
        }
      }
    } else {
      if (library.packageName !== contract.packageName) {
        throw new Error(`${library.id}.packageName must be ${contract.packageName}`);
      }
      if (
        library.catalogueStatus !== "released" ||
        library.sourceVersion !== library.baselineVersion
      ) {
        throw new Error(`${library.id} ${library.lifecycle} baseline must stay frozen`);
      }
      if (library.candidatePackageName || library.candidateRef) {
        throw new Error(`${library.id} ${library.lifecycle} SDK cannot have a candidate`);
      }
    }
  }
  const readiness = sdkReadiness(manifest.libraries);
  if (
    readiness.lifecycle.active !== 2 ||
    readiness.lifecycle.internal !== 2 ||
    readiness.lifecycle.archived !== 3
  ) {
    throw new Error("SDK lifecycle must be 2 active, 2 internal and 3 archived");
  }
  if (readiness.pendingActive.length !== 0 && readiness.pendingActive.length !== 2) {
    throw new Error("SDK active set must advance atomically");
  }
  const support = manifest.libraries.find(({ id }) => id === "flutterflow-support");
  const expectedSupportCoverage = readiness.promotionReady
    ? "historical-release"
    : "dart-legacy-direct";
  if (support.coverageMode !== expectedSupportCoverage) {
    throw new Error(
      `flutterflow-support.coverageMode must be ${expectedSupportCoverage}`,
    );
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
  const projectLifecycle = project.sdkCatalogue ?? {};
  for (const lifecycle of ["active", "internal", "archived"]) {
    const expected = libraries
      .filter((library) => library.lifecycle === lifecycle)
      .map(({ id }) => id)
      .sort();
    const actual = [...(projectLifecycle[lifecycle] ?? [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`reference.project.json sdkCatalogue.${lifecycle} is stale`);
    }
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
      ref: library.baselineRef,
      path: library.sourcePath,
      version: library.baselineVersion,
      "resolved-ref": library.baselineSha,
    };
    for (const [key, value] of Object.entries(expected)) {
      const actual =
        key === "url" ? `${normalizedRepository(dependency[key])}.git` : dependency[key];
      if (actual !== value) {
        throw new Error(
          `${library.id} lock ${key} must be ${value}, got ${actual ?? "none"}`,
        );
      }
    }
    const section =
      library.coverageMode === "dart-transitive-override"
        ? "dependency_overrides"
        : "dependencies";
    const declaration = gitDependency(pubspec, section, library.packageName);
    for (const [key, value] of Object.entries({
      url: `${manifest.platformRepository}.git`,
      ref: library.baselineRef,
      path: library.sourcePath,
    })) {
      const actual =
        key === "url" ? `${normalizedRepository(declaration[key])}.git` : declaration[key];
      if (actual !== value) {
        throw new Error(`${library.id} pubspec ${key} must be ${value}`);
      }
    }
    if (library.coverageMode !== "dart-transitive-override") {
      const declared = project.libraries?.[library.packageName];
      if (
        !declared ||
        declared.path !== library.sourcePath ||
        declared.sourceVersion !== library.baselineVersion ||
        declared.releaseVersion !== library.baselineVersion ||
        declared.releaseRef !== library.baselineRef
      ) {
        throw new Error(`${library.id} baseline must match reference.project.json`);
      }
    }
  }
  return libraries;
}

export function verifyCatalogueCoverage(manifest, catalogue) {
  const libraries = validateSdkCoverage(manifest);
  if (catalogue?.schemaVersion !== manifest.catalogueSchemaVersion) {
    throw new Error(
      `SDK catalogue schemaVersion must be ${manifest.catalogueSchemaVersion}`,
    );
  }
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
    throw new Error("SDK catalogue must contain exactly the seven governed libraries");
  }
  for (const library of libraries) {
    const catalogued = catalogueLibraries.get(library.id);
    if (!catalogued) throw new Error(`${library.id} is missing from the SDK catalogue`);
    const expected = {
      lifecycle: library.lifecycle,
      packageName: library.packageName,
      sourcePath: library.sourcePath,
      sourceVersion: library.sourceVersion,
      latestReleaseVersion: library.baselineVersion,
      releaseStatus: library.catalogueStatus,
      releaseRef: library.baselineRef,
      releaseSha: library.baselineSha,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (catalogued[key] !== value) {
        throw new Error(`${library.id} catalogue ${key} must be ${value}`);
      }
    }
    if (
      library.candidatePackageName !== catalogued.candidatePackageName ||
      Boolean(library.candidateRef) !== Boolean(catalogued.candidateInstall)
    ) {
      throw new Error(`${library.id} catalogue candidate metadata is inconsistent`);
    }
    if (
      library.candidateRef &&
      !String(catalogued.candidateInstall).includes(library.candidateRef)
    ) {
      throw new Error(`${library.id} catalogue candidate install must pin ${library.candidateRef}`);
    }
  }
  return { libraries, readiness: sdkReadiness(libraries) };
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
    for (const ref of new Set([library.baselineRef, library.baselineTag])) {
      const output = await listRemote(manifest.platformRepository, ref);
      const remoteSha = resolveRemoteTag(output, ref);
      if (remoteSha !== library.baselineSha) {
        throw new Error(
          `${library.id} tag ${ref} resolves to ${remoteSha}, expected ${library.baselineSha}`,
        );
      }
    }
    if (!(await releaseExists(manifest.platformRepository, library.baselineTag))) {
      throw new Error(`GitHub Release ${library.baselineTag} does not exist`);
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
  let readiness;
  if (args.command === "verify-remote") {
    verifyReferenceCoverage({ manifest, project, pubspec, lockSource });
    entries = await verifyRemoteCoverage({ manifest });
    readiness = sdkReadiness(entries);
  } else if (args.command === "verify-catalog") {
    const catalogue = JSON.parse(await readFile(args.catalog, "utf8"));
    const result = verifyCatalogueCoverage(manifest, catalogue);
    entries = result.libraries;
    readiness = result.readiness;
  } else {
    entries = verifyReferenceCoverage({ manifest, project, pubspec, lockSource });
    readiness = sdkReadiness(entries);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        sdkCoverage: entries.map(
          ({
            id,
            lifecycle,
            baselineVersion,
            baselineTag,
            baselineSha,
            sourceVersion,
            catalogueStatus,
            candidatePackageName,
            candidateRef,
            coverageMode,
          }) => ({
            id,
            lifecycle,
            baselineVersion,
            baselineTag,
            baselineSha,
            sourceVersion,
            catalogueStatus,
            candidatePackageName,
            candidateRef,
            coverageMode,
          }),
        ),
        readiness,
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
