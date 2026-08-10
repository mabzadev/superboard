import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  promoteReferenceSdk,
  promoteReferenceSdkSet,
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
