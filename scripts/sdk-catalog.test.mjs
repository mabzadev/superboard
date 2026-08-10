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

const candidateSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const conflictingSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function stageAndroidCoordinateMigration(catalog) {
  const android = catalog.libraries.find((item) => item.id === "android");
  Object.assign(android, {
    packageName: "io.opengrow:opengrow-android",
    latestReleaseVersion: "1.0.0",
    releaseRef: "sdk-android-v1.0.0",
    releaseStatus: "pending-release",
    install: 'implementation("io.opengrow:opengrow-android:1.0.0")',
    candidatePackageName: "io.opengrow:opengrow-android-sdk",
    candidateInstall:
      'implementation("io.opengrow:opengrow-android-sdk:1.0.2")',
  });
  return android;
}

function stageNpmCoordinateMigration(catalog, id) {
  const migration = {
    javascript: {
      packageName: "@mbzadev/opengrow-js",
      candidatePackageName: "@mbzadev/opengrow-js-sdk",
      releaseRef: "sdk-js-v1.0.0",
    },
    "react-native": {
      packageName: "@mbzadev/opengrow-react-native",
      candidatePackageName: "@mbzadev/opengrow-react-native-sdk",
      releaseRef: "sdk-react-native-v1.0.0",
    },
  }[id];
  const library = catalog.libraries.find((item) => item.id === id);
  Object.assign(library, {
    packageName: migration.packageName,
    latestReleaseVersion: "1.0.0",
    releaseRef: migration.releaseRef,
    releaseStatus: "pending-release",
    install: `npm install ${migration.packageName}@1.0.0`,
    candidatePackageName: migration.candidatePackageName,
    candidateInstall: `npm install ${migration.candidatePackageName}@1.0.1`,
  });
  return library;
}

test("SDK catalogue matches every package source and FlutterFlow public symbol", async () => {
  const catalog = await loadSdkCatalog();
  const result = await validateSdkCatalog(catalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.libraries, 7);
  assert.equal(catalog.schemaVersion, 2);
  assert.ok(catalog.libraries.every((library) => library.license === "MIT"));
  assert.deepEqual(
    Object.fromEntries(
      catalog.libraries
        .filter((library) => library.releaseStatus === "released")
        .map((library) => [library.id, library.releaseSha]),
    ),
    {
      flutter: "d4416b9f71477acaf0e8684b0dd80fb28df9d79e",
      "flutterflow-support": "e896f8ea91a140419471b02301f0bde48d8d6b13",
      ios: "809a6a9b5c7a639fe9283ad35f2554a487745b0f",
      android: "e01acba82e4de94a98a36bf63992c1f1f137dd31",
      javascript: "fbb6e325eff514e6e8566fa5af8602f14f4cdbd6",
      "react-native": "8f5bcee1a14a1e454d43da391295e9c12d806f30",
    },
  );
  assert.equal(releaseTagFor(catalog, "flutter"), "sdk-flutter-v2.1.3");
  assert.equal(releaseCandidateRefFor(catalog, "ios"), "1.0.2");
  assert.equal(
    releaseCandidateTagFor(catalog, "android"),
    "sdk-android-v1.0.2",
  );
  assert.equal(releaseCandidateTagFor(catalog, "javascript"), "sdk-js-v1.0.1");
  assert.equal(
    releaseCandidateTagFor(catalog, "react-native"),
    "sdk-react-native-v1.0.1",
  );
  assert.equal(
    releaseCandidateTagFor(catalog, "flutterflow"),
    "sdk-flutterflow-v2.2.5",
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

test("FlutterFlow package documentation pins the exact candidate tag", async () => {
  const catalog = await loadSdkCatalog();
  const candidateTag = releaseCandidateTagFor(catalog, "flutterflow");
  const readme = await readFile(
    new URL("../sdks/flutterflow/README.md", import.meta.url),
    "utf8",
  );
  const documentedRefs = [
    ...readme.matchAll(/^\s*ref:\s*(sdk-flutterflow-v\S+)\s*$/gmu),
  ].map((match) => match[1]);

  assert.deepEqual(documentedRefs, [candidateTag]);
  assert.match(
    readme,
    /url: https:\/\/github\.com\/mbzadev\/opengrow-platform\.git/u,
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
    releaseCandidateTag: "sdk-flutterflow-v2.2.5",
  });
  assert.equal(candidateResult.ok, true);
});

test("an SDK promotion atomically derives released metadata and install refs", async () => {
  const catalog = await loadSdkCatalog();
  const promoted = promoteSdkRelease(
    catalog,
    "flutterflow",
    "2.2.5",
    candidateSha,
  );
  const library = promoted.libraries.find((item) => item.id === "flutterflow");

  assert.equal(library.latestReleaseVersion, "2.2.5");
  assert.equal(library.releaseRef, "sdk-flutterflow-v2.2.5");
  assert.equal(library.releaseStatus, "released");
  assert.equal(library.releaseSha, candidateSha);
  assert.match(library.install, /ref: sdk-flutterflow-v2\.2\.5/);
  assert.equal(
    (
      await validateSdkCatalog(promoted, {
        releaseTag: "sdk-flutterflow-v2.2.5",
        releaseSha: candidateSha,
      })
    ).ok,
    true,
  );
  assert.equal(
    promoteSdkRelease(
      promoted,
      "flutterflow",
      "2.2.5",
      candidateSha,
    ).libraries.find((item) => item.id === "flutterflow").releaseStatus,
    "released",
  );
  assert.throws(
    () => promoteSdkRelease(promoted, "flutterflow", "2.2.5", conflictingSha),
    /already published from/u,
  );
});

test("an SDK promotion atomically migrates a collision-free package coordinate", async () => {
  const catalog = await loadSdkCatalog();
  stageAndroidCoordinateMigration(catalog);
  const promoted = promoteSdkRelease(catalog, "android", "1.0.2", candidateSha);
  const library = promoted.libraries.find((item) => item.id === "android");

  assert.equal(library.packageName, "io.opengrow:opengrow-android-sdk");
  assert.equal(
    library.install,
    'implementation("io.opengrow:opengrow-android-sdk:1.0.2")',
  );
  assert.equal(library.latestReleaseVersion, "1.0.2");
  assert.equal(library.releaseRef, "sdk-android-v1.0.2");
  assert.equal(library.releaseStatus, "released");
  assert.equal(library.releaseSha, candidateSha);
  assert.equal(Object.hasOwn(library, "candidatePackageName"), false);
  assert.equal(Object.hasOwn(library, "candidateInstall"), false);
  assert.equal(
    (
      await validateSdkCatalog(promoted, {
        releaseTag: "sdk-android-v1.0.2",
        releaseSha: candidateSha,
      })
    ).ok,
    true,
  );
});

test("a candidate package coordinate is complete, pending and collision-free", async () => {
  const catalog = await loadSdkCatalog();
  const android = stageAndroidCoordinateMigration(catalog);
  delete android.candidateInstall;
  let result = await validateSdkCatalog(catalog);
  assert.ok(
    result.errors.includes(
      "libraries.android.candidatePackageName and candidateInstall must be declared together",
    ),
  );

  android.candidateInstall =
    'implementation("io.opengrow:opengrow-android-sdk:1.0.2")';
  const releasedPackageName = catalog.libraries.find(
    (item) => item.id === "javascript",
  ).packageName;
  android.candidatePackageName = releasedPackageName;
  android.candidateInstall = `implementation("${releasedPackageName}:1.0.2")`;
  result = await validateSdkCatalog(catalog);
  assert.ok(
    result.errors.includes(
      `candidate package ${releasedPackageName} duplicates a released packageName`,
    ),
  );
});

test("npm promotions atomically migrate collision-free package names", async () => {
  for (const [id, packageName, tag] of [
    ["javascript", "@mbzadev/opengrow-js-sdk", "sdk-js-v1.0.1"],
    [
      "react-native",
      "@mbzadev/opengrow-react-native-sdk",
      "sdk-react-native-v1.0.1",
    ],
  ]) {
    const catalog = await loadSdkCatalog();
    stageNpmCoordinateMigration(catalog, id);
    const promoted = promoteSdkRelease(catalog, id, "1.0.1", candidateSha);
    const library = promoted.libraries.find((item) => item.id === id);

    assert.equal(library.packageName, packageName);
    assert.equal(library.install, `npm install ${packageName}@1.0.1`);
    assert.equal(library.latestReleaseVersion, "1.0.1");
    assert.equal(library.releaseRef, tag);
    assert.equal(library.releaseStatus, "released");
    assert.equal(library.releaseSha, candidateSha);
    assert.equal(Object.hasOwn(library, "candidatePackageName"), false);
    assert.equal(Object.hasOwn(library, "candidateInstall"), false);
  }
});

test("npm catalogue validation binds the candidate to package.json name", async () => {
  const catalog = await loadSdkCatalog();
  const javascript = stageNpmCoordinateMigration(catalog, "javascript");
  javascript.candidatePackageName = "@mbzadev/unrelated-package";
  javascript.candidateInstall = "npm install @mbzadev/unrelated-package@1.0.1";

  const result = await validateSdkCatalog(catalog);
  assert.ok(
    result.errors.includes(
      "libraries.javascript.source package name is @mbzadev/opengrow-js-sdk, expected @mbzadev/unrelated-package",
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

test("released SDKs require exact immutable commit identities", async () => {
  const catalog = await loadSdkCatalog();
  const schemaDrift = structuredClone(catalog);
  schemaDrift.unexpected = true;
  let result = await validateSdkCatalog(schemaDrift);
  assert.ok(
    result.errors.some((error) => error.includes("additional properties")),
  );

  const missing = structuredClone(catalog);
  delete missing.libraries.find((library) => library.id === "flutter")
    .releaseSha;
  result = await validateSdkCatalog(missing);
  assert.ok(
    result.errors.includes(
      "libraries.flutter.releaseSha must identify the released commit",
    ),
  );

  const invalid = structuredClone(catalog);
  invalid.libraries.find((library) => library.id === "ios").releaseSha = "ABC";
  result = await validateSdkCatalog(invalid);
  assert.ok(
    result.errors.includes(
      "libraries.ios.releaseSha must identify the released commit",
    ),
  );

  result = await validateSdkCatalog(catalog, {
    releaseTag: "sdk-ios-v1.0.2",
    releaseSha: candidateSha,
  });
  assert.ok(result.errors.some((error) => error.includes("catalogue records")));
  assert.throws(
    () => promoteSdkRelease(catalog, "javascript", "1.0.1"),
    /Invalid SDK release SHA/u,
  );
});

test("catalogue candidate validation blocks a burned immutable version", async () => {
  const catalog = await loadSdkCatalog();
  const ios = catalog.libraries.find((library) => library.id === "ios");
  Object.assign(ios, {
    sourceVersion: "1.0.1",
    latestReleaseVersion: "1.0.0",
    releaseRef: "1.0.0",
    releaseStatus: "pending-release",
    install:
      '.package(url: "https://github.com/mbzadev/opengrow-platform.git", exact: "1.0.0")',
  });
  delete ios.releaseSha;
  const result = await validateSdkCatalog(catalog, {
    releaseCandidateTag: "sdk-ios-v1.0.1",
  });
  assert.ok(
    result.errors.some((error) =>
      error.includes("bump the SDK version before publishing"),
    ),
  );
});
