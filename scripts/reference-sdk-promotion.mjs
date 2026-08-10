#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const referenceSdkMappings = Object.freeze({
  flutterflow: Object.freeze({
    projectKey: "opengrow_flutterflow",
    packageName: "opengrow_flutterflow",
    sourcePath: "sdks/flutterflow",
    releasePrefix: "sdk-flutterflow-v",
  }),
  "flutterflow-support": Object.freeze({
    projectKey: "opengrow_flutterflow_messaging",
    packageName: "opengrow_flutterflow_messaging",
    sourcePath: "sdks/flutterflow_messaging",
    releasePrefix: "sdk-flutterflow-messaging-v",
  }),
});

export function replaceGitDependencyRef(source, packageName, releaseRef) {
  const lines = source.split("\n");
  const packageRows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)([a-z0-9_]+):\s*$/u);
    if (match?.[2] === packageName) {
      packageRows.push({ index, indent: match[1].length });
    }
  }
  if (packageRows.length !== 1) {
    throw new Error(
      `${packageName} must be declared exactly once in the dependency file`,
    );
  }
  const [{ index: start, indent }] = packageRows;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)([^\s#][^:]*):/u);
    if (match && match[1].length <= indent) {
      end = index;
      break;
    }
  }
  const refRows = [];
  for (let index = start + 1; index < end; index += 1) {
    if (/^\s+ref:\s*\S+\s*$/u.test(lines[index])) refRows.push(index);
  }
  if (refRows.length !== 1) {
    throw new Error(`${packageName} must contain exactly one Git ref`);
  }
  const row = refRows[0];
  const rowIndent = lines[row].match(/^\s*/u)[0];
  lines[row] = `${rowIndent}ref: ${releaseRef}`;
  return lines.join("\n");
}

export function promoteReferenceSdk({
  project,
  catalogue,
  libraryId,
  pubspec,
  dependencySnippet,
}) {
  const mapping = referenceSdkMappings[libraryId];
  if (!mapping) throw new Error(`Unsupported reference SDK: ${libraryId}`);
  const library = catalogue?.libraries?.find((item) => item.id === libraryId);
  if (!library) throw new Error(`${libraryId} is missing from the catalogue`);
  if (
    library.releaseStatus !== "released" ||
    library.sourceVersion !== library.latestReleaseVersion
  ) {
    throw new Error(`${libraryId} is not a fully published SDK release`);
  }
  const expectedRef = `${mapping.releasePrefix}${library.sourceVersion}`;
  if (library.releaseRef !== expectedRef) {
    throw new Error(`${libraryId} release ref must be ${expectedRef}`);
  }
  if (library.sourcePath !== mapping.sourcePath) {
    throw new Error(`${libraryId} source path must be ${mapping.sourcePath}`);
  }
  if (
    String(catalogue.repository || "").replace(/\.git$/u, "") !==
    String(project.platformRepository || "").replace(/\.git$/u, "")
  ) {
    throw new Error("The SDK catalogue does not belong to platformRepository");
  }
  const promotedProject = structuredClone(project);
  const declared = promotedProject.libraries?.[mapping.projectKey];
  if (!declared || declared.path !== mapping.sourcePath) {
    throw new Error(`${mapping.projectKey} has an invalid reference mapping`);
  }
  declared.sourceVersion = library.sourceVersion;
  declared.releaseVersion = library.latestReleaseVersion;
  declared.releaseRef = library.releaseRef;

  return {
    project: promotedProject,
    pubspec: replaceGitDependencyRef(
      pubspec,
      mapping.packageName,
      library.releaseRef,
    ),
    dependencySnippet: replaceGitDependencyRef(
      dependencySnippet,
      mapping.packageName,
      library.releaseRef,
    ),
    promotion: {
      library: libraryId,
      version: library.sourceVersion,
      releaseRef: library.releaseRef,
    },
  };
}

export function promoteReferenceSdkSet({
  project,
  catalogue,
  pubspec,
  dependencySnippet,
}) {
  let state = { project, pubspec, dependencySnippet };
  const promotions = [];
  for (const libraryId of Object.keys(referenceSdkMappings)) {
    const result = promoteReferenceSdk({
      ...state,
      catalogue,
      libraryId,
    });
    state = {
      project: result.project,
      pubspec: result.pubspec,
      dependencySnippet: result.dependencySnippet,
    };
    promotions.push(result.promotion);
  }
  return { ...state, promotions };
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--") || !values[index + 1]) {
      throw new Error(
        "Usage: reference-sdk-promotion.mjs --catalog <path> --library <id>",
      );
    }
    result[value.slice(2)] = values[index + 1];
    index += 1;
  }
  if (!result.catalog || !result.library) {
    throw new Error(
      "Usage: reference-sdk-promotion.mjs --catalog <path> --library <id>",
    );
  }
  return result;
}

async function run() {
  const args = parseArguments(process.argv.slice(2));
  const paths = {
    project: path.join(root, "reference.project.json"),
    pubspec: path.join(root, "pubspec.yaml"),
    dependencySnippet: path.join(
      root,
      "flutterflow",
      "dependency-snippet.yaml",
    ),
    catalogue: path.resolve(args.catalog),
  };
  const [projectSource, pubspec, dependencySnippet, catalogueSource] =
    await Promise.all([
      readFile(paths.project, "utf8"),
      readFile(paths.pubspec, "utf8"),
      readFile(paths.dependencySnippet, "utf8"),
      readFile(paths.catalogue, "utf8"),
    ]);
  const input = {
    project: JSON.parse(projectSource),
    catalogue: JSON.parse(catalogueSource),
    pubspec,
    dependencySnippet,
  };
  const result =
    args.library === "all"
      ? promoteReferenceSdkSet(input)
      : promoteReferenceSdk({ ...input, libraryId: args.library });
  const next = {
    project: `${JSON.stringify(result.project, null, 2)}\n`,
    pubspec: result.pubspec,
    dependencySnippet: result.dependencySnippet,
  };
  const changed =
    next.project !== projectSource ||
    next.pubspec !== pubspec ||
    next.dependencySnippet !== dependencySnippet;
  if (changed) {
    await Promise.all([
      writeFile(paths.project, next.project),
      writeFile(paths.pubspec, next.pubspec),
      writeFile(paths.dependencySnippet, next.dependencySnippet),
    ]);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        promotions: result.promotions ?? [result.promotion],
        changed,
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
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
