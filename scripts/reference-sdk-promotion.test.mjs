import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  promoteReferenceSdk,
  promoteReferenceSdkSet,
  promoteSdkCoverageManifest,
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

function catalogue(overrides = {}) {
  return {
    repository: project.platformRepository,
    libraries: [
      {
        id: "flutterflow",
        sourcePath: "sdks/flutterflow",
        sourceVersion: "2.2.4",
        latestReleaseVersion: "2.2.4",
        releaseRef: "sdk-flutterflow-v2.2.4",
        releaseStatus: "released",
        ...overrides,
      },
      {
        id: "flutterflow-support",
        sourcePath: "sdks/flutterflow_messaging",
        sourceVersion: "1.3.0",
        latestReleaseVersion: "1.3.0",
        releaseRef: "sdk-flutterflow-messaging-v1.3.0",
        releaseStatus: "released",
      },
    ],
  };
}

function completeCatalogue() {
  return {
    repository: project.platformRepository,
    libraries: coverageManifest.libraries.map((library) => ({
      id: library.id,
      packageName: library.packageName,
      sourcePath: library.sourcePath,
      sourceVersion: library.version,
      latestReleaseVersion: library.version,
      releaseStatus: "released",
      releaseRef: library.releaseRef,
      releaseSha: library.releaseSha,
    })),
  };
}

test("a published SDK promotion updates metadata and both dependency refs", () => {
  const result = promoteReferenceSdk({
    project,
    catalogue: catalogue(),
    libraryId: "flutterflow",
    pubspec,
    dependencySnippet,
  });

  assert.deepEqual(result.promotion, {
    library: "flutterflow",
    version: "2.2.4",
    releaseRef: "sdk-flutterflow-v2.2.4",
  });
  assert.deepEqual(result.project.libraries.opengrow_flutterflow, {
    path: "sdks/flutterflow",
    developmentRef: "dev",
    sourceVersion: "2.2.4",
    releaseVersion: "2.2.4",
    releaseRef: "sdk-flutterflow-v2.2.4",
  });
  assert.match(result.pubspec, /ref: sdk-flutterflow-v2\.2\.4/u);
  assert.match(result.dependencySnippet, /ref: sdk-flutterflow-v2\.2\.4/u);
});

test("the SDK set promotion pins FlutterFlow and Support together", () => {
  const result = promoteReferenceSdkSet({
    project,
    catalogue: catalogue(),
    pubspec,
    dependencySnippet,
  });

  assert.equal(result.promotions.length, 2);
  assert.equal(
    result.project.libraries.opengrow_flutterflow_messaging.releaseVersion,
    "1.3.0",
  );
  assert.match(result.pubspec, /ref: sdk-flutterflow-messaging-v1\.3\.0/u);
  assert.doesNotMatch(result.pubspec, /ref: dev/u);
});

test("complete promotion updates the seven-SDK manifest and Flutter override", () => {
  const nextCatalogue = completeCatalogue();
  const flutter = nextCatalogue.libraries.find(({ id }) => id === "flutter");
  Object.assign(flutter, {
    sourceVersion: "2.1.5",
    latestReleaseVersion: "2.1.5",
    releaseRef: "sdk-flutter-v2.1.5",
    releaseSha: "f".repeat(40),
  });
  const result = promoteSdkCoverageManifest({
    coverageManifest,
    catalogue: nextCatalogue,
    pubspec,
  });
  assert.equal(result.coverageManifest.libraries.length, 7);
  assert.deepEqual(
    result.coverageManifest.libraries.find(({ id }) => id === "flutter"),
    {
      id: "flutter",
      packageName: "opengrow_flutter",
      sourcePath: "sdks/flutter",
      version: "2.1.5",
      releaseRef: "sdk-flutter-v2.1.5",
      releaseTag: "sdk-flutter-v2.1.5",
      releaseSha: "f".repeat(40),
      coverageMode: "dart-transitive-override",
    },
  );
  assert.match(
    result.pubspec,
    /dependency_overrides:[\s\S]*opengrow_flutter:[\s\S]*ref: sdk-flutter-v2\.1\.5/u,
  );
});

test("complete promotion rejects an incomplete or pending release set", () => {
  const incomplete = completeCatalogue();
  incomplete.libraries.pop();
  assert.throws(
    () =>
      promoteSdkCoverageManifest({
        coverageManifest,
        catalogue: incomplete,
        pubspec,
      }),
    /complete seven-SDK set/u,
  );
  const pending = completeCatalogue();
  pending.libraries.find(({ id }) => id === "javascript").releaseStatus =
    "pending-release";
  assert.throws(
    () =>
      promoteSdkCoverageManifest({
        coverageManifest,
        catalogue: pending,
        pubspec,
      }),
    /javascript is not a fully published/u,
  );
});

test("promotion rejects pending metadata and non-canonical release refs", () => {
  assert.throws(
    () =>
      promoteReferenceSdk({
        project,
        catalogue: catalogue({
          latestReleaseVersion: "2.1.6",
          releaseRef: "sdk-flutterflow-v2.1.6",
          releaseStatus: "pending-release",
        }),
        libraryId: "flutterflow",
        pubspec,
        dependencySnippet,
      }),
    /not a fully published/u,
  );
  assert.throws(
    () =>
      promoteReferenceSdk({
        project,
        catalogue: catalogue({ releaseRef: "dev" }),
        libraryId: "flutterflow",
        pubspec,
        dependencySnippet,
      }),
    /release ref must be/u,
  );
});

test("dependency ref replacement is exact and fail-closed", () => {
  assert.equal(
    replaceGitDependencyRef(
      "dependencies:\n  sample:\n    git:\n      ref: dev\n",
      "sample",
      "sdk-sample-v1.0.0",
    ),
    "dependencies:\n  sample:\n    git:\n      ref: sdk-sample-v1.0.0\n",
  );
  assert.throws(
    () => replaceGitDependencyRef("dependencies:\n", "missing", "tag"),
    /exactly once/u,
  );
});
