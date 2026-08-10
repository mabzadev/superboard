import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  loadSdkCatalog,
  promoteSdkRelease,
  releaseCandidateRefFor,
  releaseCandidateTagFor,
  releaseTagFor,
  validateSdkCatalog,
} from "./sdk-catalog.mjs";

test("SDK catalogue matches every package source and FlutterFlow public symbol", async () => {
  const catalog = await loadSdkCatalog();
  const result = await validateSdkCatalog(catalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.libraries, 7);
  assert.equal(catalog.schemaVersion, 2);
  assert.ok(catalog.libraries.every((library) => library.license === "MIT"));
  assert.equal(releaseTagFor(catalog, "flutter"), "sdk-flutter-v2.1.3");
  assert.equal(releaseCandidateRefFor(catalog, "ios"), "1.0.2");
  assert.equal(
    releaseCandidateTagFor(catalog, "android"),
    "sdk-android-v1.0.2",
  );
  assert.equal(
    releaseCandidateTagFor(catalog, "javascript"),
    "sdk-js-v1.0.1",
  );
  assert.equal(
    releaseCandidateTagFor(catalog, "react-native"),
    "sdk-react-native-v1.0.1",
  );
  assert.equal(
    releaseCandidateTagFor(catalog, "flutterflow"),
    "sdk-flutterflow-v2.2.4",
  );
  assert.equal(
    releaseCandidateRefFor(catalog, "flutterflow-support"),
    "sdk-flutterflow-messaging-v1.3.0",
  );
  assert.equal(
    releaseCandidateTagFor(catalog, "flutter"),
    "sdk-flutter-v2.1.3",
  );
});

test("release validation rejects source drift and an unpublished source version", async () => {
  const catalog = await loadSdkCatalog();
  const drifted = structuredClone(catalog);
  drifted.libraries.find((item) => item.id === "flutter").sourceVersion =
    "9.9.9";
  assert.equal((await validateSdkCatalog(drifted)).ok, false);
  const pending = structuredClone(catalog);
  const pendingFlutterFlow = pending.libraries.find(
    (item) => item.id === "flutterflow",
  );
  pendingFlutterFlow.latestReleaseVersion = "2.1.6";
  pendingFlutterFlow.releaseRef = "sdk-flutterflow-v2.1.6";
  pendingFlutterFlow.releaseStatus = "pending-release";
  pendingFlutterFlow.install = pendingFlutterFlow.install.replaceAll(
    "sdk-flutterflow-v2.2.4",
    "sdk-flutterflow-v2.1.6",
  );
  assert.throws(
    () => releaseTagFor(pending, "flutterflow"),
    /not marked ready/,
  );
  const tagResult = await validateSdkCatalog(pending, {
    releaseTag: "sdk-flutterflow-v2.2.0",
  });
  assert.equal(tagResult.ok, false);
  assert.ok(
    tagResult.errors.some((error) => error.includes("latestReleaseVersion")),
  );
  const candidateResult = await validateSdkCatalog(pending, {
    releaseCandidateTag: "sdk-flutterflow-v2.2.4",
  });
  assert.equal(candidateResult.ok, true);
});

test("an SDK promotion atomically derives released metadata and install refs", async () => {
  const catalog = await loadSdkCatalog();
  const promoted = promoteSdkRelease(catalog, "flutterflow", "2.2.4");
  const library = promoted.libraries.find((item) => item.id === "flutterflow");

  assert.equal(library.latestReleaseVersion, "2.2.4");
  assert.equal(library.releaseRef, "sdk-flutterflow-v2.2.4");
  assert.equal(library.releaseStatus, "released");
  assert.match(library.install, /ref: sdk-flutterflow-v2\.2\.4/);
  assert.equal(
    (
      await validateSdkCatalog(promoted, {
        releaseTag: "sdk-flutterflow-v2.2.4",
      })
    ).ok,
    true,
  );
  assert.equal(
    promoteSdkRelease(promoted, "flutterflow", "2.2.4").libraries.find(
      (item) => item.id === "flutterflow",
    ).releaseStatus,
    "released",
  );
});

test("an SDK promotion atomically migrates a collision-free package coordinate", async () => {
  const catalog = await loadSdkCatalog();
  const promoted = promoteSdkRelease(catalog, "android", "1.0.2");
  const library = promoted.libraries.find((item) => item.id === "android");

  assert.equal(library.packageName, "io.opengrow:opengrow-android-sdk");
  assert.equal(
    library.install,
    'implementation("io.opengrow:opengrow-android-sdk:1.0.2")',
  );
  assert.equal(library.latestReleaseVersion, "1.0.2");
  assert.equal(library.releaseRef, "sdk-android-v1.0.2");
  assert.equal(library.releaseStatus, "released");
  assert.equal(Object.hasOwn(library, "candidatePackageName"), false);
  assert.equal(Object.hasOwn(library, "candidateInstall"), false);
  assert.equal(
    (
      await validateSdkCatalog(promoted, {
        releaseTag: "sdk-android-v1.0.2",
      })
    ).ok,
    true,
  );
});

test("a candidate package coordinate is complete, pending and collision-free", async () => {
  const catalog = await loadSdkCatalog();
  const android = catalog.libraries.find((item) => item.id === "android");
  delete android.candidateInstall;
  let result = await validateSdkCatalog(catalog);
  assert.ok(
    result.errors.includes(
      "libraries.android.candidatePackageName and candidateInstall must be declared together",
    ),
  );

  android.candidateInstall =
    'implementation("io.opengrow:opengrow-android-sdk:1.0.2")';
  android.candidatePackageName = "@mbzadev/opengrow-js";
  android.candidateInstall =
    'implementation("@mbzadev/opengrow-js:1.0.2")';
  result = await validateSdkCatalog(catalog);
  assert.ok(
    result.errors.includes(
      "candidate package @mbzadev/opengrow-js duplicates a released packageName",
    ),
  );
});

test("FlutterFlow catalogue rejects an incomplete public surface", async () => {
  const catalog = await loadSdkCatalog();
  const manifest = JSON.parse(
    await readFile(
      new URL("../config/flutterflow-custom-code.json", import.meta.url),
      "utf8",
    ),
  );
  const original = manifest.actions.purchases;
  manifest.actions.purchases = original.filter(
    (name) => name !== "opengrowGetEntitlements",
  );
  const result = await validateSdkCatalog(catalog, {
    flutterFlowManifest: manifest,
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes(
        "FlutterFlow public symbol opengrowGetEntitlements is not declared",
      ),
    ),
  );
});

test("SDK catalogue rejects a missing or non-MIT package licence", async () => {
  const catalog = await loadSdkCatalog();
  const invalid = structuredClone(catalog);
  const flutterFlow = invalid.libraries.find(
    (library) => library.id === "flutterflow",
  );
  flutterFlow.license = "UNLICENSED";
  flutterFlow.licensePath = "sdks/flutterflow/ABSENT-LICENSE";
  const result = await validateSdkCatalog(invalid);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.includes("libraries.flutterflow.license must be MIT"),
  );
  assert.ok(
    result.errors.includes("libraries.flutterflow.licensePath does not exist"),
  );
});
