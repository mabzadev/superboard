import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  promoteReferenceSdk,
  promoteReferenceSdkSet,
  removeGitDependency,
  replaceGitDependency,
  replaceGitDependencyRef,
} from "./reference-sdk-promotion.mjs";

const root = new URL("../", import.meta.url);
const project = JSON.parse(
  await readFile(new URL("reference.project.json", root), "utf8"),
);
const pubspec = await readFile(new URL("pubspec.yaml", root), "utf8");
const dependencySnippet = await readFile(
  new URL("flutterflow/dependency-snippet.yaml", root),
  "utf8",
);
const coverageManifest = JSON.parse(
  await readFile(new URL("config/sdk-coverage.json", root), "utf8"),
);

function completeCatalogue() {
  return {
    schemaVersion: 4,
    repository: project.platformRepository,
    libraries: coverageManifest.libraries.map((library) => {
      const active = library.lifecycle === "active";
      return {
        id: library.id,
        lifecycle: library.lifecycle,
        packageName: active ? library.candidatePackageName : library.packageName,
        sourcePath: library.sourcePath,
        sourceVersion: library.sourceVersion,
        latestReleaseVersion: active
          ? library.sourceVersion
          : library.baselineVersion,
        releaseStatus: "released",
        releaseRef: active ? library.candidateRef : library.baselineRef,
        releaseSha: active
          ? (library.id === "flutter" ? "a" : "b").repeat(40)
          : library.baselineSha,
      };
    }),
  };
}

test("v3 promotion is atomic and migrates only the two active packages", () => {
  const result = promoteReferenceSdkSet({
    project,
    catalogue: completeCatalogue(),
    pubspec,
    dependencySnippet,
    coverageManifest,
  });

  assert.equal(result.readiness.promotionReady, true);
  assert.deepEqual(result.promotions, [
    { library: "flutter", version: "3.0.0", releaseRef: "sdk-flutter-v3.0.0" },
    {
      library: "flutterflow",
      version: "3.0.0",
      releaseRef: "sdk-flutterflow-v3.0.0",
    },
  ]);
  assert.match(
    result.pubspec,
    /dependencies:[\s\S]*superboard_flutterflow:[\s\S]*ref: sdk-flutterflow-v3\.0\.0/u,
  );
  assert.match(
    result.pubspec,
    /dependency_overrides:[\s\S]*superboard_flutter:[\s\S]*ref: sdk-flutter-v3\.0\.0/u,
  );
  assert.doesNotMatch(result.pubspec, /opengrow_flutterflow_messaging:/u);
  assert.doesNotMatch(result.dependencySnippet, /opengrow_flutterflow_messaging:/u);
  assert.equal(result.project.libraries.opengrow_flutterflow, undefined);
  assert.equal(result.project.libraries.opengrow_flutterflow_messaging, undefined);
  assert.equal(
    result.project.libraries.superboard_flutterflow.releaseVersion,
    "3.0.0",
  );
  assert.deepEqual(
    result.coverageManifest.libraries.map(({ id, lifecycle }) => [id, lifecycle]),
    coverageManifest.libraries.map(({ id, lifecycle }) => [id, lifecycle]),
  );
  assert.equal(
    result.coverageManifest.libraries.find(({ id }) => id === "flutterflow-support")
      .coverageMode,
    "historical-release",
  );
});

test("promotion refuses a pending, partial, missing or drifted lifecycle set", () => {
  const pending = completeCatalogue();
  const flutter = pending.libraries.find(({ id }) => id === "flutter");
  Object.assign(flutter, {
    packageName: "opengrow_flutter",
    latestReleaseVersion: "2.1.4",
    releaseStatus: "pending-release",
    releaseRef: "sdk-flutter-v2.1.4",
  });
  assert.throws(
    () =>
      promoteReferenceSdkSet({
        project,
        catalogue: pending,
        pubspec,
        dependencySnippet,
        coverageManifest,
      }),
    /Active SDK promotion is incomplete: flutter/u,
  );

  const missing = completeCatalogue();
  missing.libraries.pop();
  assert.throws(
    () =>
      promoteReferenceSdkSet({
        project,
        catalogue: missing,
        pubspec,
        dependencySnippet,
        coverageManifest,
      }),
    /complete governed set/u,
  );

  const drifted = completeCatalogue();
  drifted.libraries.find(({ id }) => id === "android").lifecycle = "active";
  assert.throws(
    () =>
      promoteReferenceSdkSet({
        project,
        catalogue: drifted,
        pubspec,
        dependencySnippet,
        coverageManifest,
      }),
    /android has an invalid lifecycle/u,
  );
});

test("individual promotion is disabled by the complete-active-set policy", () => {
  assert.throws(
    () => promoteReferenceSdk({}),
    /flutter and flutterflow must be promoted together/u,
  );
});

test("dependency migration is exact, supports renames and removes archived support", () => {
  const source =
    "dependencies:\n  sample:\n    git:\n      ref: dev\n\n  archived:\n    git:\n      ref: old\n";
  assert.equal(
    replaceGitDependency(source, "sample", "superboard_sample", "sdk-sample-v3.0.0"),
    "dependencies:\n  superboard_sample:\n    git:\n      ref: sdk-sample-v3.0.0\n\n  archived:\n    git:\n      ref: old\n",
  );
  assert.equal(
    replaceGitDependencyRef(source, "sample", "sdk-sample-v1.0.0"),
    "dependencies:\n  sample:\n    git:\n      ref: sdk-sample-v1.0.0\n\n  archived:\n    git:\n      ref: old\n",
  );
  assert.doesNotMatch(removeGitDependency(source, "archived"), /archived:/u);
  assert.throws(
    () => replaceGitDependencyRef("dependencies:\n", "missing", "tag"),
    /exactly once/u,
  );
});
