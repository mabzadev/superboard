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
    schemaVersion: 4,
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

test("coverage v2 models catalogue v4 as two active, two internal and three archived SDKs", () => {
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

test("the executable remains pinned to every published Dart baseline", () => {
  const libraries = verifyReferenceCoverage({ manifest, project, pubspec, lockSource });
  assert.deepEqual(
    libraries
      .filter(({ coverageMode }) => coverageMode.startsWith("dart-"))
      .map(({ id, coverageMode }) => [id, coverageMode]),
    [
      ["flutter", "dart-transitive-override"],
      ["flutterflow", "dart-direct"],
      ["flutterflow-support", "dart-legacy-direct"],
    ],
  );
  assert.match(
    lockSource,
    /opengrow_flutter:[\s\S]*ref: "sdk-flutter-v2\.1\.4"[\s\S]*resolved-ref: "1cddb333ff3330fd6ffa507d780821121bd7273a"[\s\S]*version: "2\.1\.4"/u,
  );
});

test("coverage fails closed on omissions, stale baselines and partial active promotion", () => {
  const omitted = structuredClone(manifest);
  omitted.libraries.pop();
  assert.throws(() => validateSdkCoverage(omitted), /must declare exactly/u);

  const staleLock = lockSource
    .replace('ref: "sdk-flutter-v2.1.4"', 'ref: "sdk-flutter-v2.1.3"')
    .replace('version: "2.1.4"', 'version: "2.1.3"');
  assert.throws(
    () => verifyReferenceCoverage({ manifest, project, pubspec, lockSource: staleLock }),
    /flutter lock ref must be sdk-flutter-v2\.1\.4/u,
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

test("the exact Platform catalogue v4 matches baselines and exposes both v3 candidates", () => {
  const result = verifyCatalogueCoverage(manifest, catalogueFixture());
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

test("coverage CI uses public reads, catalogue v4 and canonical variables", () => {
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
