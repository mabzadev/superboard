#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  sdkContracts,
  sdkReadiness,
  validateSdkCoverage,
} from "./reference-sdk-coverage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const activeIds = Object.freeze(
  Object.entries(sdkContracts)
    .filter(([, contract]) => contract.lifecycle === "active")
    .map(([id]) => id),
);

export const referenceSdkMappings = Object.freeze({
  flutter: Object.freeze({
    section: "dependency_overrides",
  }),
  flutterflow: Object.freeze({
    section: "dependencies",
    projectLibrary: true,
  }),
});

function dependencyRange(source, packageName) {
  const lines = source.split("\n");
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)([A-Za-z0-9_]+):\s*$/u);
    if (match?.[2] === packageName) {
      rows.push({ index, indent: match[1].length });
    }
  }
  if (rows.length !== 1) {
    throw new Error(`${packageName} must be declared exactly once in the dependency file`);
  }
  const [{ index: start, indent }] = rows;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)([^\s#][^:]*):/u);
    if (match && match[1].length <= indent) {
      end = index;
      break;
    }
  }
  return { lines, start, end, indent };
}

export function replaceGitDependency(
  source,
  packageName,
  nextPackageName,
  releaseRef,
) {
  const { lines, start, end, indent } = dependencyRange(source, packageName);
  lines[start] = `${" ".repeat(indent)}${nextPackageName}:`;
  const refRows = [];
  for (let index = start + 1; index < end; index += 1) {
    if (/^\s+ref:\s*\S+\s*$/u.test(lines[index])) refRows.push(index);
  }
  if (refRows.length !== 1) {
    throw new Error(`${packageName} must contain exactly one Git ref`);
  }
  const row = refRows[0];
  lines[row] = `${lines[row].match(/^\s*/u)[0]}ref: ${releaseRef}`;
  return lines.join("\n");
}

export function replaceGitDependencyRef(source, packageName, releaseRef) {
  return replaceGitDependency(source, packageName, packageName, releaseRef);
}

function hasDependency(source, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^[ \\t]*${escaped}:[ \\t]*$`, "mu").test(source);
}

export function replaceDependencyWithGit(
  source,
  packageName,
  nextPackageName,
  { repository, releaseRef, sourcePath },
) {
  const { lines, start, end, indent } = dependencyRange(source, packageName);
  const padding = " ".repeat(indent);
  const replacement = [
    `${padding}${nextPackageName}:`,
    `${padding}  git:`,
    `${padding}    url: ${String(repository).replace(/\.git$/u, "")}.git`,
    `${padding}    ref: ${releaseRef}`,
    `${padding}    path: ${sourcePath}`,
  ];
  lines.splice(start, end - start, ...replacement);
  return lines.join("\n");
}

export function removeGitDependency(source, packageName) {
  const { lines, start, end } = dependencyRange(source, packageName);
  let removalEnd = end;
  if (removalEnd < lines.length && lines[removalEnd - 1] === "") {
    removalEnd -= 1;
  } else if (removalEnd < lines.length && lines[removalEnd] === "") {
    removalEnd += 1;
  }
  lines.splice(start, removalEnd - start);
  return lines.join("\n");
}

function catalogueLibraries(catalogue, coverageManifest) {
  if (catalogue?.schemaVersion !== 5) {
    throw new Error("The SDK catalogue must use schemaVersion 5");
  }
  if (
    String(catalogue?.repository || "").replace(/\.git$/u, "") !==
    String(coverageManifest.platformRepository || "").replace(/\.git$/u, "")
  ) {
    throw new Error("The SDK catalogue does not belong to the coverage manifest");
  }
  const entries = new Map(
    (catalogue.libraries ?? []).map((library) => [library.id, library]),
  );
  if (
    !Array.isArray(catalogue.libraries) ||
    entries.size !== catalogue.libraries.length
  ) {
    throw new Error("The SDK catalogue must contain unique governed entries");
  }
  for (const [id, contract] of Object.entries(sdkContracts)) {
    const library = entries.get(id);
    if (!library) throw new Error(`${id} is missing from the SDK catalogue`);
    if (
      library.lifecycle !== contract.lifecycle ||
      library.sourcePath !== contract.sourcePath
    ) {
      throw new Error(`${id} has an invalid lifecycle or source path`);
    }
    if (contract.lifecycle !== "active") {
      if (
        library.releaseStatus !== "released" ||
        library.sourceVersion !== library.latestReleaseVersion
      ) {
        throw new Error(`${id} ${contract.lifecycle} baseline must stay frozen`);
      }
    }
  }
  return entries;
}

function requireCompleteActiveSet(entries) {
  const incomplete = activeIds.filter((id) => {
    const library = entries.get(id);
    return (
      library.releaseStatus !== "released" ||
      library.sourceVersion !== library.latestReleaseVersion ||
      !String(library.packageName ?? "").startsWith("superboard_") ||
      library.candidatePackageName ||
      library.candidateInstall
    );
  });
  if (incomplete.length > 0) {
    throw new Error(
      `Active SDK promotion is incomplete: ${incomplete.join(", ")} must be fully published together`,
    );
  }
}

function promotedRef(library, contract) {
  const expected = `${contract.releasePrefix}${library.sourceVersion}`;
  if (library.releaseRef !== expected) {
    throw new Error(`${library.id} release ref must be ${expected}`);
  }
  if (!/^[0-9a-f]{40}$/u.test(library.releaseSha ?? "")) {
    throw new Error(`${library.id} release SHA must be a full commit SHA`);
  }
  return expected;
}

export function promoteReferenceSdkSet({
  project,
  catalogue,
  pubspec,
  dependencySnippet,
  coverageManifest,
}) {
  validateSdkCoverage(coverageManifest);
  const entries = catalogueLibraries(catalogue, coverageManifest);
  requireCompleteActiveSet(entries);

  const nextProject = structuredClone(project);
  const nextCoverage = structuredClone(coverageManifest);
  let nextPubspec = pubspec;
  let nextSnippet = dependencySnippet;
  const promotions = [];

  for (const id of activeIds) {
    const source = entries.get(id);
    const contract = sdkContracts[id];
    const baseline = nextCoverage.libraries.find((library) => library.id === id);
    const releaseRef = promotedRef(source, contract);
    const currentPackageName = hasDependency(
      nextPubspec,
      baseline.candidatePackageName,
    )
      ? baseline.candidatePackageName
      : baseline.packageName;
    nextPubspec = replaceDependencyWithGit(
      nextPubspec,
      currentPackageName,
      source.packageName,
      {
        repository: nextCoverage.platformRepository,
        releaseRef,
        sourcePath: source.sourcePath,
      },
    );
    if (referenceSdkMappings[id].projectLibrary) {
      const snippetPackageName = hasDependency(
        nextSnippet,
        baseline.candidatePackageName,
      )
        ? baseline.candidatePackageName
        : baseline.packageName;
      nextSnippet = replaceDependencyWithGit(
        nextSnippet,
        snippetPackageName,
        source.packageName,
        {
          repository: nextCoverage.platformRepository,
          releaseRef,
          sourcePath: source.sourcePath,
        },
      );
      delete nextProject.libraries[baseline.packageName];
      nextProject.libraries[source.packageName] = {
        path: source.sourcePath,
        developmentRef: nextProject.deployment.branch,
        sourceVersion: source.sourceVersion,
        releaseVersion: source.latestReleaseVersion,
        releaseRef,
      };
    }
    Object.assign(baseline, {
      packageName: source.packageName,
      sourceVersion: source.sourceVersion,
      baselineVersion: source.latestReleaseVersion,
      baselineRef: releaseRef,
      baselineTag: releaseRef,
      baselineSha: source.releaseSha,
      catalogueStatus: "released",
      coverageMode: contract.promotedCoverageMode,
    });
    delete baseline.candidatePackageName;
    delete baseline.candidateRef;
    promotions.push({ library: id, version: source.sourceVersion, releaseRef });
  }

  const support = nextCoverage.libraries.find(
    ({ id }) => id === "flutterflow-support",
  );
  if (hasDependency(nextPubspec, support.packageName)) {
    nextPubspec = removeGitDependency(nextPubspec, support.packageName);
  }
  if (hasDependency(nextSnippet, support.packageName)) {
    nextSnippet = removeGitDependency(nextSnippet, support.packageName);
  }
  delete nextProject.libraries[support.packageName];
  support.coverageMode = "historical-release";

  validateSdkCoverage(nextCoverage);
  const readiness = sdkReadiness(nextCoverage.libraries);
  if (!readiness.promotionReady) {
    throw new Error("The promoted active SDK set is not ready");
  }
  return {
    project: nextProject,
    pubspec: nextPubspec,
    dependencySnippet: nextSnippet,
    coverageManifest: nextCoverage,
    promotions,
    readiness,
  };
}

export function promoteReferenceSdk(input) {
  throw new Error(
    `Individual SDK promotion is disabled; ${activeIds.join(" and ")} must be promoted together`,
  );
}

export function promoteSdkCoverageManifest(input) {
  const result = promoteReferenceSdkSet(input);
  return {
    coverageManifest: result.coverageManifest,
    pubspec: result.pubspec,
  };
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--") || !values[index + 1]) {
      throw new Error(
        "Usage: reference-sdk-promotion.mjs --catalog <path> --library all",
      );
    }
    result[value.slice(2)] = values[index + 1];
    index += 1;
  }
  if (!result.catalog || result.library !== "all") {
    throw new Error(
      "Usage: reference-sdk-promotion.mjs --catalog <path> --library all",
    );
  }
  return result;
}

async function run() {
  const args = parseArguments(process.argv.slice(2));
  const paths = {
    project: path.join(root, "reference.project.json"),
    pubspec: path.join(root, "pubspec.yaml"),
    dependencySnippet: path.join(root, "flutterflow", "dependency-snippet.yaml"),
    coverageManifest: path.join(root, "config/sdk-coverage.json"),
    catalogue: path.resolve(args.catalog),
  };
  const [
    projectSource,
    pubspec,
    dependencySnippet,
    coverageManifestSource,
    catalogueSource,
  ] = await Promise.all([
    readFile(paths.project, "utf8"),
    readFile(paths.pubspec, "utf8"),
    readFile(paths.dependencySnippet, "utf8"),
    readFile(paths.coverageManifest, "utf8"),
    readFile(paths.catalogue, "utf8"),
  ]);
  const result = promoteReferenceSdkSet({
    project: JSON.parse(projectSource),
    catalogue: JSON.parse(catalogueSource),
    pubspec,
    dependencySnippet,
    coverageManifest: JSON.parse(coverageManifestSource),
  });
  const next = {
    project: `${JSON.stringify(result.project, null, 2)}\n`,
    pubspec: result.pubspec,
    dependencySnippet: result.dependencySnippet,
    coverageManifest: `${JSON.stringify(result.coverageManifest, null, 2)}\n`,
  };
  const changed =
    next.project !== projectSource ||
    next.pubspec !== pubspec ||
    next.dependencySnippet !== dependencySnippet ||
    next.coverageManifest !== coverageManifestSource;
  if (changed) {
    await Promise.all([
      writeFile(paths.project, next.project),
      writeFile(paths.pubspec, next.pubspec),
      writeFile(paths.dependencySnippet, next.dependencySnippet),
      writeFile(paths.coverageManifest, next.coverageManifest),
    ]);
  }
  process.stdout.write(
    `${JSON.stringify({ promotions: result.promotions, readiness: result.readiness, changed }, null, 2)}\n`,
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
