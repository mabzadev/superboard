import assert from "node:assert/strict";
import test from "node:test";
import { loadSdkCatalog } from "./sdk-catalog.mjs";
import {
  assertSdkReleaseCandidateNotFailed,
  loadSdkReleaseHistory,
  validateSdkReleaseHistory,
} from "./sdk-release-history.mjs";

test("immutable SDK failures are strictly recorded with their burned refs", async () => {
  const catalogue = await loadSdkCatalog();
  const history = await loadSdkReleaseHistory();
  const result = await validateSdkReleaseHistory(history, catalogue);

  assert.deepEqual(result.errors, []);
  assert.equal(result.failures, 2);
  assert.deepEqual(
    history.immutableFailures.map(
      ({
        libraryId,
        version,
        releaseTag,
        packageRefs,
        releaseSha,
        workflowRunId,
      }) => ({
        libraryId,
        version,
        releaseTag,
        packageRefs,
        releaseSha,
        workflowRunId,
      }),
    ),
    [
      {
        libraryId: "ios",
        version: "1.0.1",
        releaseTag: "sdk-ios-v1.0.1",
        packageRefs: ["1.0.1"],
        releaseSha: "e896f8ea91a140419471b02301f0bde48d8d6b13",
        workflowRunId: 31358601380,
      },
      {
        libraryId: "android",
        version: "1.0.1",
        releaseTag: "sdk-android-v1.0.1",
        packageRefs: [],
        releaseSha: "cc0f6b7ddcc871b3cc50426bc005c03fca64e2d5",
        workflowRunId: 31365219132,
      },
    ],
  );
});

test("release history rejects schema drift and invalid immutable metadata", async () => {
  const catalogue = await loadSdkCatalog();
  const source = await loadSdkReleaseHistory();

  const extra = structuredClone(source);
  extra.immutableFailures[0].unexpected = true;
  assert.equal((await validateSdkReleaseHistory(extra, catalogue)).ok, false);

  const invalidSha = structuredClone(source);
  invalidSha.immutableFailures[0].releaseSha = "not-a-commit";
  assert.equal(
    (await validateSdkReleaseHistory(invalidSha, catalogue)).ok,
    false,
  );

  const invalidTag = structuredClone(source);
  invalidTag.immutableFailures[0].releaseTag = "sdk-ios-v9.9.9";
  assert.ok(
    (await validateSdkReleaseHistory(invalidTag, catalogue)).errors.some(
      (error) => error.includes("releaseTag must be sdk-ios-v1.0.1"),
    ),
  );

  const duplicateRef = structuredClone(source);
  duplicateRef.immutableFailures[1].releaseTag = "sdk-ios-v1.0.1";
  const duplicateResult = await validateSdkReleaseHistory(
    duplicateRef,
    catalogue,
  );
  assert.ok(
    duplicateResult.errors.some((error) => error.includes("is duplicated")),
  );
});

test("release history cannot classify the current successful release as failed", async () => {
  const catalogue = await loadSdkCatalog();
  const history = await loadSdkReleaseHistory();
  const conflict = structuredClone(history);
  const ios = catalogue.libraries.find((library) => library.id === "ios");
  conflict.immutableFailures[0] = {
    ...conflict.immutableFailures[0],
    version: ios.latestReleaseVersion,
    releaseTag: `sdk-ios-v${ios.latestReleaseVersion}`,
    packageRefs: [ios.latestReleaseVersion],
    releaseSha: ios.releaseSha,
  };
  const result = await validateSdkReleaseHistory(conflict, catalogue);
  assert.ok(
    result.errors.some((error) =>
      error.includes("conflicts with the current successful release"),
    ),
  );
});

test("a burned immutable version requires a version bump", async () => {
  const history = await loadSdkReleaseHistory();
  assert.throws(
    () => assertSdkReleaseCandidateNotFailed(history, "ios", "1.0.1"),
    /bump the SDK version before publishing/u,
  );
  assert.doesNotThrow(() =>
    assertSdkReleaseCandidateNotFailed(history, "ios", "1.0.2"),
  );
});

test("Flows package failures use their canonical immutable tag namespace", async () => {
  const catalogue = await loadSdkCatalog();
  const history = await loadSdkReleaseHistory();
  const candidate = structuredClone(history);
  candidate.immutableFailures.push({
    libraryId: "flows-js",
    version: "1.23.3",
    releaseTag: "sdk-flows-js-v1.23.3",
    packageRefs: [],
    releaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workflowRunId: 424242,
    failedAt: "2026-08-13T12:00:00Z",
    failureKind: "package-tests-failed",
  });

  const result = await validateSdkReleaseHistory(candidate, catalogue);
  assert.deepEqual(result.errors, []);
  assert.throws(
    () => assertSdkReleaseCandidateNotFailed(candidate, "flows-js", "1.23.3"),
    /sdk-flows-js-v1\.23\.3/u,
  );
});
