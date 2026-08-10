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
  const candidateVersion = android.sourceVersion;
  const baselineVersion = previousPatchVersion(candidateVersion);
  const candidatePackageName = android.packageName;
  Object.assign(android, {
    packageName: "io.opengrow:opengrow-android",
    latestReleaseVersion: baselineVersion,
    releaseRef: `sdk-android-v${baselineVersion}`,
    releaseStatus: "pending-release",
    install: `implementation("io.opengrow:opengrow-android:${baselineVersion}")`,
    candidatePackageName,
    candidateInstall: `implementation("${candidatePackageName}:${candidateVersion}")`,
  });
  return android;
}

function stageNpmCoordinateMigration(catalog, id) {
  const migration = {
    javascript: {
      packageName: "@mbzadev/opengrow-js",
      releasePrefix: "sdk-js-v",
    },
    "react-native": {
      packageName: "@mbzadev/opengrow-react-native",
      releasePrefix: "sdk-react-native-v",
    },
  }[id];
  const library = catalog.libraries.find((item) => item.id === id);
  const candidateVersion = library.sourceVersion;
  const baselineVersion = previousPatchVersion(candidateVersion);
  const candidatePackageName = library.packageName;
  Object.assign(library, {
    packageName: migration.packageName,
    latestReleaseVersion: baselineVersion,
    releaseRef: `${migration.releasePrefix}${baselineVersion}`,
    releaseStatus: "pending-release",
    install: `npm install ${migration.packageName}@${baselineVersion}`,
    candidatePackageName,
    candidateInstall: `npm install ${candidatePackageName}@${candidateVersion}`,
  });
  return library;
}

function previousPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  assert.ok(match, `expected a stable semantic version, received ${version}`);
  const [, major, minor, patch] = match.map(Number);

  if (patch > 0) return `${major}.${minor}.${patch - 1}`;
  if (minor > 0) return `${major}.${minor - 1}.0`;
  return `${Math.max(0, major - 1)}.0.0`;
}

function stageFlutterFlowCandidate(catalog) {
  const library = catalog.libraries.find((item) => item.id === "flutterflow");
  const candidateVersion = library.sourceVersion;
  const candidateTag = `sdk-flutterflow-v${candidateVersion}`;
  const baselineVersion =
    library.latestReleaseVersion === candidateVersion
      ? previousPatchVersion(candidateVersion)
      : library.latestReleaseVersion;
  const baselineRef = `sdk-flutterflow-v${baselineVersion}`;
  const currentRef = library.releaseRef;

  Object.assign(library, {
    latestReleaseVersion: baselineVersion,
    releaseRef: baselineRef,
    releaseStatus: "pending-release",
    install: library.install.replaceAll(currentRef, baselineRef),
  });
  delete library.releaseSha;

  return { library, candidateVersion, candidateTag };
}

test("SDK catalogue matches every package source and FlutterFlow public symbol", async () => {
  const catalog = await loadSdkCatalog();
  const result = await validateSdkCatalog(catalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.libraries, 7);
  assert.equal(catalog.schemaVersion, 3);
  assert.ok(catalog.libraries.every((library) => library.license === "MIT"));
  assert.deepEqual(catalog.libraries.map((library) => library.id).sort(), [
    "android",
    "flutter",
    "flutterflow",
    "flutterflow-support",
    "ios",
    "javascript",
    "react-native",
  ]);
  const releasedLibraries = catalog.libraries.filter(
    (library) => library.releaseStatus === "released",
  );
  assert.ok(releasedLibraries.length > 0);
  for (const library of releasedLibraries) {
    assert.match(library.releaseSha, /^[0-9a-f]{40}$/u);
    assert.equal(
      releaseTagFor(catalog, library.id),
      library.id === "ios"
        ? `sdk-ios-v${library.sourceVersion}`
        : library.releaseRef,
    );
  }

  const tagPrefixes = {
    flutter: "sdk-flutter",
    flutterflow: "sdk-flutterflow",
    "flutterflow-support": "sdk-flutterflow-messaging",
    ios: "sdk-ios",
    android: "sdk-android",
    javascript: "sdk-js",
    "react-native": "sdk-react-native",
  };
  for (const library of catalog.libraries) {
    const candidateTag = `${tagPrefixes[library.id]}-v${library.sourceVersion}`;
    assert.equal(releaseCandidateTagFor(catalog, library.id), candidateTag);
    assert.equal(
      releaseCandidateRefFor(catalog, library.id),
      library.id === "ios" ? library.sourceVersion : candidateTag,
    );
  }

  for (const id of ["android", "javascript", "react-native"]) {
    const library = catalog.libraries.find((item) => item.id === id);
    assert.equal(library.distribution.publicMetadata, true);
    assert.equal(library.distribution.anonymousInstallable, false);
    assert.equal(library.distribution.authentication.required, true);
    assert.equal(
      library.distribution.authentication.tokenEnvironmentVariable,
      "OPENGROW_GITHUB_PACKAGES_TOKEN",
    );
  }
});

test("registry SDK distribution metadata is honest and secret-free", async () => {
  const catalog = await loadSdkCatalog();
  const missing = structuredClone(catalog);
  delete missing.libraries.find(
    (library) => library.id === "javascript",
  ).distribution;
  let result = await validateSdkCatalog(missing);
  assert.ok(
    result.errors.includes("libraries.javascript.distribution is required"),
  );

  const anonymous = structuredClone(catalog);
  anonymous.libraries.find(
    (library) => library.id === "react-native",
  ).distribution.anonymousInstallable = true;
  result = await validateSdkCatalog(anonymous);
  assert.ok(
    result.errors.includes(
      "libraries.react-native.distribution.anonymousInstallable must be false",
    ),
  );

  const privateMetadata = structuredClone(catalog);
  privateMetadata.libraries.find(
    (library) => library.id === "android",
  ).distribution.publicMetadata = false;
  result = await validateSdkCatalog(privateMetadata);
  assert.ok(
    result.errors.includes(
      "libraries.android.distribution.publicMetadata must be true",
    ),
  );

  const hardcodedCredential = structuredClone(catalog);
  hardcodedCredential.libraries.find(
    (library) => library.id === "javascript",
  ).distribution.authentication.token = "github_pat_forbidden";
  result = await validateSdkCatalog(hardcodedCredential);
  assert.ok(
    result.errors.some(
      (error) =>
        error.includes("/distribution/authentication") &&
        error.includes("additional properties"),
    ),
  );

  const wrongRegistry = structuredClone(catalog);
  wrongRegistry.libraries.find(
    (library) => library.id === "android",
  ).distribution.registry = "https://repo1.maven.org/maven2";
  result = await validateSdkCatalog(wrongRegistry);
  assert.ok(
    result.errors.includes(
      "libraries.android.distribution.registry must be https://maven.pkg.github.com/mbzadev/opengrow-platform",
    ),
  );
});

test("release validation rejects source drift and an unpublished source version", async () => {
  const catalog = await loadSdkCatalog();
  const drifted = structuredClone(catalog);
  drifted.libraries.find((item) => item.id === "flutter").sourceVersion =
    "9.9.9";
  assert.equal((await validateSdkCatalog(drifted)).ok, false);
  const pending = structuredClone(catalog);
  const { candidateTag } = stageFlutterFlowCandidate(pending);
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
    releaseCandidateTag: candidateTag,
  });
  assert.equal(candidateResult.ok, true);
});

test("an SDK promotion atomically derives released metadata and install refs", async () => {
  const catalog = await loadSdkCatalog();
  const { candidateVersion, candidateTag } = stageFlutterFlowCandidate(catalog);
  const promoted = promoteSdkRelease(
    catalog,
    "flutterflow",
    candidateVersion,
    candidateSha,
  );
  const library = promoted.libraries.find((item) => item.id === "flutterflow");

  assert.equal(library.latestReleaseVersion, candidateVersion);
  assert.equal(library.releaseRef, candidateTag);
  assert.equal(library.releaseStatus, "released");
  assert.equal(library.releaseSha, candidateSha);
  assert.ok(library.install.includes(`ref: ${candidateTag}`));
  assert.equal(
    (
      await validateSdkCatalog(promoted, {
        releaseTag: candidateTag,
        releaseSha: candidateSha,
      })
    ).ok,
    true,
  );
  assert.equal(
    promoteSdkRelease(
      promoted,
      "flutterflow",
      candidateVersion,
      candidateSha,
    ).libraries.find((item) => item.id === "flutterflow").releaseStatus,
    "released",
  );
  assert.throws(
    () =>
      promoteSdkRelease(
        promoted,
        "flutterflow",
        candidateVersion,
        conflictingSha,
      ),
    /already published from/u,
  );
});

test("an SDK promotion atomically migrates a collision-free package coordinate", async () => {
  const catalog = await loadSdkCatalog();
  const staged = stageAndroidCoordinateMigration(catalog);
  const candidateVersion = staged.sourceVersion;
  const candidatePackageName = staged.candidatePackageName;
  const candidateTag = `sdk-android-v${candidateVersion}`;
  const promoted = promoteSdkRelease(
    catalog,
    "android",
    candidateVersion,
    candidateSha,
  );
  const library = promoted.libraries.find((item) => item.id === "android");

  assert.equal(library.packageName, candidatePackageName);
  assert.equal(
    library.install,
    `implementation("${candidatePackageName}:${candidateVersion}")`,
  );
  assert.equal(library.latestReleaseVersion, candidateVersion);
  assert.equal(library.releaseRef, candidateTag);
  assert.equal(library.releaseStatus, "released");
  assert.equal(library.releaseSha, candidateSha);
  assert.equal(Object.hasOwn(library, "candidatePackageName"), false);
  assert.equal(Object.hasOwn(library, "candidateInstall"), false);
  assert.equal(
    (
      await validateSdkCatalog(promoted, {
        releaseTag: candidateTag,
        releaseSha: candidateSha,
      })
    ).ok,
    true,
  );
});

test("a candidate package coordinate is complete, pending and collision-free", async () => {
  const catalog = await loadSdkCatalog();
  const android = stageAndroidCoordinateMigration(catalog);
  const candidateVersion = android.sourceVersion;
  delete android.candidateInstall;
  let result = await validateSdkCatalog(catalog);
  assert.ok(
    result.errors.includes(
      "libraries.android.candidatePackageName and candidateInstall must be declared together",
    ),
  );

  android.candidateInstall = `implementation("${android.candidatePackageName}:${candidateVersion}")`;
  const releasedPackageName = catalog.libraries.find(
    (item) => item.id === "javascript",
  ).packageName;
  android.candidatePackageName = releasedPackageName;
  android.candidateInstall = `implementation("${releasedPackageName}:${candidateVersion}")`;
  result = await validateSdkCatalog(catalog);
  assert.ok(
    result.errors.includes(
      `candidate package ${releasedPackageName} duplicates a released packageName`,
    ),
  );
});

test("npm promotions atomically migrate collision-free package names", async () => {
  for (const [id, releasePrefix] of [
    ["javascript", "sdk-js-v"],
    ["react-native", "sdk-react-native-v"],
  ]) {
    const catalog = await loadSdkCatalog();
    const staged = stageNpmCoordinateMigration(catalog, id);
    const candidateVersion = staged.sourceVersion;
    const packageName = staged.candidatePackageName;
    const tag = `${releasePrefix}${candidateVersion}`;
    const promoted = promoteSdkRelease(
      catalog,
      id,
      candidateVersion,
      candidateSha,
    );
    const library = promoted.libraries.find((item) => item.id === id);

    assert.equal(library.packageName, packageName);
    assert.equal(
      library.install,
      `npm install ${packageName}@${candidateVersion}`,
    );
    assert.equal(library.latestReleaseVersion, candidateVersion);
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
  javascript.candidateInstall = `npm install @mbzadev/unrelated-package@${javascript.sourceVersion}`;

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

  const released = catalog.libraries.filter(
    (library) => library.releaseStatus === "released",
  );
  assert.ok(released.length >= 2);
  const missingLibrary = released[0];
  const missing = structuredClone(catalog);
  delete missing.libraries.find((library) => library.id === missingLibrary.id)
    .releaseSha;
  result = await validateSdkCatalog(missing);
  assert.ok(
    result.errors.includes(
      `libraries.${missingLibrary.id}.releaseSha must identify the released commit`,
    ),
  );

  const invalidLibrary = released[1];
  const invalid = structuredClone(catalog);
  invalid.libraries.find(
    (library) => library.id === invalidLibrary.id,
  ).releaseSha = "ABC";
  result = await validateSdkCatalog(invalid);
  assert.ok(
    result.errors.includes(
      `libraries.${invalidLibrary.id}.releaseSha must identify the released commit`,
    ),
  );

  const releaseTag = releaseTagFor(catalog, missingLibrary.id);
  result = await validateSdkCatalog(catalog, {
    releaseTag,
    releaseSha: candidateSha,
  });
  assert.ok(result.errors.some((error) => error.includes("catalogue records")));
  const promotable =
    catalog.libraries.find(
      (library) => library.releaseStatus === "pending-release",
    ) ?? catalog.libraries[0];
  assert.throws(
    () => promoteSdkRelease(catalog, promotable.id, promotable.sourceVersion),
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
