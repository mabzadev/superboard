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

test("schema v4 records the SuperBoard transition without rewriting releases", async () => {
  const catalog = await loadSdkCatalog();
  const result = await validateSdkCatalog(catalog);

  assert.deepEqual(result.errors, []);
  assert.equal(catalog.schemaVersion, 4);
  assert.equal(
    catalog.repository,
    "https://github.com/mbzadev/superboard-platform",
  );
  assert.equal(result.libraries, 7);
  assert.deepEqual(
    Object.fromEntries(
      catalog.libraries.map(({ id, lifecycle }) => [id, lifecycle]),
    ),
    {
      flutter: "active",
      flutterflow: "active",
      "flutterflow-support": "archived",
      ios: "internal",
      android: "internal",
      javascript: "archived",
      "react-native": "archived",
    },
  );
  assert.ok(catalog.libraries.every((library) => library.license === "MIT"));
  assert.ok(
    catalog.libraries.every((library) =>
      /^[0-9a-f]{40}$/u.test(library.releaseSha),
    ),
  );

  const flutter = catalog.libraries.find(({ id }) => id === "flutter");
  assert.equal(flutter.sourceVersion, "3.0.0");
  assert.equal(flutter.latestReleaseVersion, "2.1.4");
  assert.equal(flutter.releaseRef, "sdk-flutter-v2.1.4");
  assert.equal(flutter.releaseStatus, "pending-release");
  assert.equal(
    flutter.releaseSha,
    "1cddb333ff3330fd6ffa507d780821121bd7273a",
  );
  assert.equal(flutter.packageName, "opengrow_flutter");
  assert.equal(flutter.candidatePackageName, "superboard_flutter");
  assert.equal(
    flutter.install,
    "opengrow_flutter:\n  git:\n    url: https://github.com/mbzadev/superboard-platform.git\n    ref: sdk-flutter-v2.1.4\n    path: sdks/flutter",
  );
  assert.match(flutter.candidateInstall, /sdk-flutter-v3\.0\.0/u);

  const flutterflow = catalog.libraries.find(
    ({ id }) => id === "flutterflow",
  );
  assert.equal(flutterflow.sourceVersion, "3.0.0");
  assert.equal(flutterflow.latestReleaseVersion, "2.2.5");
  assert.equal(flutterflow.releaseRef, "sdk-flutterflow-v2.2.5");
  assert.equal(flutterflow.releaseStatus, "pending-release");
  assert.equal(
    flutterflow.releaseSha,
    "b90e7e0ede12cf6321a7a8d104baf1fd8f564867",
  );
  assert.equal(flutterflow.packageName, "opengrow_flutterflow");
  assert.equal(
    flutterflow.candidatePackageName,
    "superboard_flutterflow",
  );
  assert.equal(
    flutterflow.install,
    "opengrow_flutterflow:\n  git:\n    url: https://github.com/mbzadev/superboard-platform.git\n    ref: sdk-flutterflow-v2.2.5\n    path: sdks/flutterflow",
  );

  const immutableCoordinates = Object.fromEntries(
    catalog.libraries
      .filter(({ lifecycle }) => lifecycle !== "active")
      .map(({ id, packageName, latestReleaseVersion, releaseRef, releaseSha }) => [
        id,
        { packageName, latestReleaseVersion, releaseRef, releaseSha },
      ]),
  );
  assert.deepEqual(immutableCoordinates, {
    "flutterflow-support": {
      packageName: "opengrow_flutterflow_messaging",
      latestReleaseVersion: "1.3.0",
      releaseRef: "sdk-flutterflow-messaging-v1.3.0",
      releaseSha: "e896f8ea91a140419471b02301f0bde48d8d6b13",
    },
    ios: {
      packageName: "OpenGrow",
      latestReleaseVersion: "1.0.3",
      releaseRef: "1.0.3",
      releaseSha: "f57894c886956f4043c0c3899c35250548937463",
    },
    android: {
      packageName: "io.opengrow:opengrow-android-sdk",
      latestReleaseVersion: "1.0.3",
      releaseRef: "sdk-android-v1.0.3",
      releaseSha: "21549c99fbe65668e0488f0f5ea2fc62219b53c4",
    },
    javascript: {
      packageName: "@mbzadev/opengrow-js-sdk",
      latestReleaseVersion: "1.0.2",
      releaseRef: "sdk-js-v1.0.2",
      releaseSha: "cd27c193c471cf1b22f72a61f38acdd62f7a1e99",
    },
    "react-native": {
      packageName: "@mbzadev/opengrow-react-native-sdk",
      latestReleaseVersion: "1.0.2",
      releaseRef: "sdk-react-native-v1.0.2",
      releaseSha: "969bacf6f5c52d205ffe6da18cb4c47d85dfbaeb",
    },
  });
  assert.equal(
    catalog.libraries.find(({ id }) => id === "android").distribution.registry,
    "https://maven.pkg.github.com/mbzadev/superboard-platform",
  );
  assert.match(
    catalog.libraries.find(({ id }) => id === "flutterflow-support").install,
    /github\.com\/mbzadev\/superboard-platform\.git/u,
  );
  assert.equal(
    catalog.libraries.find(({ id }) => id === "ios").install,
    '.package(url: "https://github.com/mbzadev/superboard-platform.git", exact: "1.0.3")',
  );
});

test("only active libraries can resolve candidates or be promoted", async () => {
  const catalog = await loadSdkCatalog();

  assert.equal(
    releaseCandidateTagFor(catalog, "flutter"),
    "sdk-flutter-v3.0.0",
  );
  assert.equal(
    releaseCandidateRefFor(catalog, "flutterflow"),
    "sdk-flutterflow-v3.0.0",
  );
  assert.equal(
    releaseTagFor(catalog, "javascript"),
    "sdk-js-v1.0.2",
  );

  for (const id of [
    "flutterflow-support",
    "ios",
    "android",
    "javascript",
    "react-native",
  ]) {
    assert.throws(
      () => releaseCandidateTagFor(catalog, id),
      /cannot be published/u,
    );
    assert.throws(
      () =>
        promoteSdkRelease(
          catalog,
          id,
          catalog.libraries.find((library) => library.id === id).sourceVersion,
          candidateSha,
        ),
      /cannot be published/u,
    );
  }
});

test("Flutter candidate publication accepts its canonical SuperBoard Dart manifest", async () => {
  const catalog = await loadSdkCatalog();
  const id = "flutter";
  const tag = releaseCandidateTagFor(catalog, id);
  const result = await validateSdkCatalog(catalog, {
    releaseCandidateTag: tag,
  });
  const library = catalog.libraries.find((item) => item.id === id);
  assert.ok(
    !result.errors.includes(
      `libraries.${id}.source package name is ${library.packageName}, expected ${library.candidatePackageName} before candidate publication`,
    ),
    `${id} source manifest must expose ${library.candidatePackageName}`,
  );
});

test("the unified FlutterFlow v3 source matches its exact candidate coordinate", async () => {
  const catalog = await loadSdkCatalog();
  const flutterflow = catalog.libraries.find(({ id }) => id === "flutterflow");
  const tag = releaseCandidateTagFor(catalog, "flutterflow");
  const result = await validateSdkCatalog(catalog, {
    releaseCandidateTag: tag,
  });

  assert.equal(flutterflow.candidatePackageName, "superboard_flutterflow");
  assert.equal(flutterflow.sourceVersion, "3.0.0");
  assert.match(flutterflow.candidateInstall, /sdk-flutterflow-v3\.0\.0/u);
  assert.deepEqual(result.errors, []);
});

test("an active promotion atomically adopts the candidate coordinate", async () => {
  const catalog = await loadSdkCatalog();
  const candidateInstall = catalog.libraries.find(
    ({ id }) => id === "flutter",
  ).candidateInstall;
  const promoted = promoteSdkRelease(
    catalog,
    "flutter",
    "3.0.0",
    candidateSha,
  );
  const flutter = promoted.libraries.find(({ id }) => id === "flutter");

  assert.equal(flutter.lifecycle, "active");
  assert.equal(flutter.packageName, "superboard_flutter");
  assert.equal(flutter.install, candidateInstall);
  assert.equal(flutter.latestReleaseVersion, "3.0.0");
  assert.equal(flutter.releaseRef, "sdk-flutter-v3.0.0");
  assert.equal(flutter.releaseStatus, "released");
  assert.equal(flutter.releaseSha, candidateSha);
  assert.equal(Object.hasOwn(flutter, "candidatePackageName"), false);
  assert.equal(Object.hasOwn(flutter, "candidateInstall"), false);
});

test("lifecycle rules freeze non-active packages and preserve release SHAs", async () => {
  const catalog = await loadSdkCatalog();
  const archived = structuredClone(catalog);
  const javascript = archived.libraries.find(
    ({ id }) => id === "javascript",
  );
  javascript.sourceVersion = "2.0.0";
  javascript.releaseStatus = "pending-release";
  let result = await validateSdkCatalog(archived);
  assert.ok(
    result.errors.includes(
      "libraries.javascript.releaseStatus must be released",
    ),
  );
  assert.ok(
    result.errors.includes(
      "libraries.javascript.sourceVersion must stay frozen at latestReleaseVersion for archived libraries",
    ),
  );

  const missingSha = structuredClone(catalog);
  delete missingSha.libraries.find(({ id }) => id === "flutter").releaseSha;
  result = await validateSdkCatalog(missingSha);
  assert.ok(
    result.errors.includes(
      "libraries.flutter.releaseSha must identify the latest published commit",
    ),
  );
});

test("minimal brand guard protects active names and candidate installs", async () => {
  const catalog = await loadSdkCatalog();
  const wrongDisplayName = structuredClone(catalog);
  wrongDisplayName.libraries.find(({ id }) => id === "flutter").displayName =
    "OpenGrow Flutter";
  let result = await validateSdkCatalog(wrongDisplayName);
  assert.ok(
    result.errors.includes(
      "libraries.flutter.displayName must use the SuperBoard brand",
    ),
  );

  const wrongCandidate = structuredClone(catalog);
  const flutterflow = wrongCandidate.libraries.find(
    ({ id }) => id === "flutterflow",
  );
  flutterflow.candidatePackageName = "opengrow_flutterflow_next";
  flutterflow.candidateInstall = flutterflow.candidateInstall.replaceAll(
    "superboard_flutterflow",
    "opengrow_flutterflow_next",
  );
  result = await validateSdkCatalog(wrongCandidate);
  assert.ok(
    result.errors.includes(
      "libraries.flutterflow.candidatePackageName must use the SuperBoard namespace",
    ),
  );

  const wrongRepository = structuredClone(catalog);
  wrongRepository.repository =
    "https://github.com/mbzadev/opengrow-platform";
  result = await validateSdkCatalog(wrongRepository);
  assert.ok(
    result.errors.includes(
      "repository must be https://github.com/mbzadev/superboard-platform",
    ),
  );
});

test("registry history stays honest, authenticated and secret-free", async () => {
  const catalog = await loadSdkCatalog();
  const android = catalog.libraries.find(({ id }) => id === "android");
  assert.equal(
    android.distribution.registry,
    "https://maven.pkg.github.com/mbzadev/superboard-platform",
  );
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

  const hardcodedCredential = structuredClone(catalog);
  hardcodedCredential.libraries.find(
    ({ id }) => id === "javascript",
  ).distribution.authentication.token = "github_pat_forbidden";
  let result = await validateSdkCatalog(hardcodedCredential);
  assert.ok(
    result.errors.some(
      (error) =>
        error.includes("/distribution/authentication") &&
        error.includes("additional properties"),
    ),
  );
  const wrongRegistry = structuredClone(catalog);
  wrongRegistry.libraries.find(
    (library) => library.id === "javascript",
  ).distribution.registry = "https://repo1.maven.org/maven2";
  result = await validateSdkCatalog(wrongRegistry);
  assert.ok(
    result.errors.includes(
      "libraries.javascript.distribution.registry must be https://npm.pkg.github.com",
    ),
  );
});

test("FlutterFlow catalogue validates the unified canonical surface", async () => {
  const catalog = await loadSdkCatalog();
  const manifest = JSON.parse(
    await readFile(
      new URL("../config/flutterflow-custom-code.json", import.meta.url),
      "utf8",
    ),
  );
  manifest.actions.purchases = manifest.actions.purchases.filter(
    (name) => name !== "superboardGetEntitlements",
  );
  const result = await validateSdkCatalog(catalog, {
    flutterFlowManifest: manifest,
  });
  assert.ok(
    result.errors.some((error) =>
      error.includes(
        "FlutterFlow public symbol superboardGetEntitlements is not declared",
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
      `libraries.${missingLibrary.id}.releaseSha must identify the latest published commit`,
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
      `libraries.${invalidLibrary.id}.releaseSha must identify the latest published commit`,
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
      '.package(url: "https://github.com/mbzadev/superboard-platform.git", exact: "1.0.0")',
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
