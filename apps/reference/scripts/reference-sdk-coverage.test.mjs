import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";
import {
  sdkContracts,
  sdkReadiness,
  validateSdkCoverage,
  verifyCatalogueCoverage,
  verifyReferenceCoverage,
  verifyRemoteCoverage,
} from "./reference-sdk-coverage.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("config/sdk-coverage.json", root), "utf8"),
);
const schema = JSON.parse(
  await readFile(new URL("schemas/sdk-coverage.schema.json", root), "utf8"),
);
const project = JSON.parse(
  await readFile(new URL("reference.project.json", root), "utf8"),
);
const pubspec = await readFile(new URL("pubspec.yaml", root), "utf8");
const lockSource = await readFile(new URL("pubspec.lock", root), "utf8");
const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");

function catalogueFixture() {
  return {
    schemaVersion: 5,
    repository: manifest.platformRepository,
    libraries: manifest.libraries.map((library) => ({
      id: library.id,
      lifecycle: library.lifecycle,
      packageName: library.packageName,
      candidatePackageName: library.candidatePackageName,
      candidateInstall: library.candidateRef
        ? `${library.candidatePackageName}: ${library.candidateRef}`
        : undefined,
      sourcePath: library.sourcePath,
      sourceVersion: library.sourceVersion,
      latestReleaseVersion: library.baselineVersion,
      releaseStatus: library.catalogueStatus,
      releaseRef: library.baselineRef,
      releaseSha: library.baselineSha,
    })),
  };
}

function legacyCatalogueFixture() {
  return {
    schemaVersion: 3,
    repository: `https://github.com/mabzadev/${"opengrow"}-platform`,
    libraries: manifest.libraries.map((library) => ({
      id: library.id,
      packageName: library.packageName,
      sourcePath: library.sourcePath,
      sourceVersion: library.baselineVersion,
      latestReleaseVersion: library.baselineVersion,
      releaseStatus: "released",
      releaseRef: library.baselineRef,
      releaseSha: library.baselineSha,
    })),
  };
}

function remoteTagOutput(ref, sha) {
  return `${"a".repeat(40)}\trefs/tags/${ref}\n${sha}\trefs/tags/${ref}^{}\n`;
}

test("coverage v2 models the seven reference SDKs from catalogue v5", () => {
  const validate = new Ajv({ allErrors: true }).compile(schema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  const libraries = validateSdkCoverage(manifest);
  assert.deepEqual(
    libraries.map(({ id }) => id),
    Object.keys(sdkContracts),
  );
  const readiness = sdkReadiness(libraries);
  assert.deepEqual(readiness.lifecycle, { active: 2, internal: 2, archived: 3 });
  assert.deepEqual(readiness.activeIds, ["flutter", "flutterflow"]);
  assert.equal(readiness.promotionReady, false);
  assert.deepEqual(
    readiness.pendingActive.map(({ id, baselineVersion, candidateVersion }) => ({
      id,
      baselineVersion,
      candidateVersion,
    })),
    [
      { id: "flutter", baselineVersion: "2.1.4", candidateVersion: "3.0.0" },
      { id: "flutterflow", baselineVersion: "2.2.5", candidateVersion: "3.0.0" },
    ],
  );
});

test("the executable consumes the coordinated native Dart candidates", () => {
  const libraries = verifyReferenceCoverage({ manifest, project, pubspec, lockSource });
  assert.deepEqual(
    libraries
      .filter(({ coverageMode }) => coverageMode.startsWith("dart-"))
      .map(({ id, coverageMode }) => [id, coverageMode]),
    [
      ["flutter", "dart-candidate-transitive"],
      ["flutterflow", "dart-candidate-direct"],
    ],
  );
  assert.match(
    lockSource,
    /superboard_flutter:[\s\S]*path: "\.\.\/\.\.\/sdks\/flutter"[\s\S]*source: path[\s\S]*version: "3\.0\.0"/u,
  );
  assert.doesNotMatch(lockSource, /opengrow_flutterflow_messaging:/u);
});

test("coverage fails closed on omissions, stale baselines and partial active promotion", () => {
  const omitted = structuredClone(manifest);
  omitted.libraries.pop();
  assert.throws(() => validateSdkCoverage(omitted), /must declare exactly/u);

  const staleLock = lockSource.replace(
    'path: "../../sdks/flutter"',
    'path: "../../sdks/flutter-drift"',
  );
  assert.throws(
    () => verifyReferenceCoverage({ manifest, project, pubspec, lockSource: staleLock }),
    /flutter lock path must be \.\.\/\.\.\/sdks\/flutter/u,
  );

  const partial = structuredClone(manifest);
  const flutter = partial.libraries.find(({ id }) => id === "flutter");
  Object.assign(flutter, {
    packageName: flutter.candidatePackageName,
    baselineVersion: flutter.sourceVersion,
    baselineRef: flutter.candidateRef,
    baselineTag: flutter.candidateRef,
    catalogueStatus: "released",
  });
  delete flutter.candidatePackageName;
  delete flutter.candidateRef;
  assert.throws(() => validateSdkCoverage(partial), /advance atomically/u);
});

test("the Platform catalogue v5 may add Flows packages without changing reference baselines", () => {
  const catalogue = catalogueFixture();
  catalogue.libraries.push({
    id: "flows-js",
    lifecycle: "active",
    packageName: "@superboard/flows-js",
    sourcePath: "sdks/flows/upstream/packages/js",
    sourceVersion: "1.23.3",
    releaseStatus: "unreleased",
    publicationTarget: "public-npm",
  });
  const result = verifyCatalogueCoverage(manifest, catalogue);
  assert.equal(result.libraries.length, 7);
  assert.equal(result.readiness.promotionReady, false);
  assert.deepEqual(
    result.readiness.pendingActive.map(({ candidatePackageName }) => candidatePackageName),
    ["superboard_flutter", "superboard_flutterflow"],
  );

  const stale = catalogueFixture();
  stale.libraries.find(({ id }) => id === "android").lifecycle = "active";
  assert.throws(
    () => verifyCatalogueCoverage(manifest, stale),
    /android catalogue lifecycle must be internal/u,
  );
});

test("the pre-migration Platform v3 catalogue is accepted only as an exact immutable baseline", () => {
  const result = verifyCatalogueCoverage(manifest, legacyCatalogueFixture());
  assert.equal(result.transition, "legacy-catalogue-v3");
  assert.equal(result.readiness.promotionReady, false);

  const stale = legacyCatalogueFixture();
  stale.libraries.find(({ id }) => id === "flutter").sourceVersion = "3.0.0";
  assert.throws(
    () => verifyCatalogueCoverage(manifest, stale),
    /flutter legacy catalogue sourceVersion must be 2\.1\.4/u,
  );

  const partial = legacyCatalogueFixture();
  partial.libraries.find(({ id }) => id === "flutterflow").lifecycle = "active";
  assert.throws(
    () => verifyCatalogueCoverage(manifest, partial),
    /cannot partially declare lifecycle metadata/u,
  );
});

test("secretless remote gates verify immutable baselines, including both iOS tags", async () => {
  const tagCalls = [];
  const releaseCalls = [];
  const entries = await verifyRemoteCoverage({
    manifest,
    listRemote: async (_repository, ref) => {
      tagCalls.push(ref);
      const library = manifest.libraries.find(
        ({ baselineRef, baselineTag }) => baselineRef === ref || baselineTag === ref,
      );
      return remoteTagOutput(ref, library.baselineSha);
    },
    releaseExists: async (_repository, tag) => {
      releaseCalls.push(tag);
      return true;
    },
  });
  assert.equal(entries.length, 7);
  assert.deepEqual(releaseCalls, manifest.libraries.map(({ baselineTag }) => baselineTag));
  assert.ok(tagCalls.includes("1.0.3"));
  assert.ok(tagCalls.includes("sdk-ios-v1.0.3"));
});

test("coverage CI uses public reads, catalogue v5 and canonical variables", () => {
  assert.match(workflow, /npm run sdk:coverage:verify/u);
  assert.match(workflow, /npm run sdk:coverage:catalog/u);
  assert.match(workflow, /SUPERBOARD_FLUTTER_VERSION/u);
  assert.doesNotMatch(workflow, /OPENGROW_REFERENCE_DISPATCH_TOKEN/u);
  const coverageSteps = workflow
    .split("\n")
    .filter((line) => line.includes("sdk:coverage:"))
    .join("\n");
  assert.doesNotMatch(coverageSteps, /secrets\.|GH_TOKEN|GITHUB_TOKEN/u);
});
