import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";
import {
  sdkContracts,
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
const workflow = await readFile(
  new URL(".github/workflows/ci.yml", root),
  "utf8",
);

function catalogueFixture() {
  return {
    repository: manifest.platformRepository,
    libraries: manifest.libraries.map((library) => ({
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

function remoteTagOutput(ref, sha) {
  return `${"a".repeat(40)}\trefs/tags/${ref}\n${sha}\trefs/tags/${ref}^{}\n`;
}

test("the versioned manifest declares exactly the seven supported SDKs", () => {
  const validate = new Ajv({ allErrors: true }).compile(schema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  const libraries = validateSdkCoverage(manifest);
  assert.deepEqual(
    libraries.map(({ id }) => id),
    Object.keys(sdkContracts),
  );
  assert.deepEqual(
    Object.fromEntries(libraries.map(({ id, version }) => [id, version])),
    {
      flutter: "2.1.4",
      flutterflow: "2.2.5",
      "flutterflow-support": "1.3.0",
      ios: "1.0.3",
      android: "1.0.3",
      javascript: "1.0.2",
      "react-native": "1.0.2",
    },
  );
});

test("the executable reference consumes every Dart SDK at its published SHA", () => {
  const libraries = verifyReferenceCoverage({
    manifest,
    project,
    pubspec,
    lockSource,
  });
  assert.deepEqual(
    libraries
      .filter(({ coverageMode }) => coverageMode.startsWith("dart-"))
      .map(({ id, coverageMode }) => [id, coverageMode]),
    [
      ["flutter", "dart-transitive-override"],
      ["flutterflow", "dart-direct"],
      ["flutterflow-support", "dart-direct"],
    ],
  );
  assert.match(
    lockSource,
    /opengrow_flutter:[\s\S]*ref: "sdk-flutter-v2\.1\.4"[\s\S]*resolved-ref: "1cddb333ff3330fd6ffa507d780821121bd7273a"[\s\S]*version: "2\.1\.4"/u,
  );
});

test("coverage fails closed on an omitted SDK or a stale transitive Flutter lock", () => {
  const omitted = structuredClone(manifest);
  omitted.libraries.pop();
  assert.throws(
    () => validateSdkCoverage(omitted),
    /must declare exactly/u,
  );
  const staleLock = lockSource
    .replace('ref: "sdk-flutter-v2.1.4"', 'ref: "sdk-flutter-v2.1.3"')
    .replace('version: "2.1.4"', 'version: "2.1.3"');
  assert.notEqual(staleLock, lockSource);
  assert.throws(
    () =>
      verifyReferenceCoverage({
        manifest,
        project,
        pubspec,
        lockSource: staleLock,
      }),
    /flutter lock ref must be sdk-flutter-v2\.1\.4/u,
  );
});

test("the official catalogue contract covers all seven released versions", () => {
  assert.equal(verifyCatalogueCoverage(manifest, catalogueFixture()).length, 7);
  const stale = catalogueFixture();
  stale.libraries.find(({ id }) => id === "android").releaseSha = "f".repeat(40);
  assert.throws(
    () => verifyCatalogueCoverage(manifest, stale),
    /android catalogue releaseSha must be/u,
  );
});

test("secretless remote gates peel package and GitHub Release tags", async () => {
  const tagCalls = [];
  const releaseCalls = [];
  const entries = await verifyRemoteCoverage({
    manifest,
    listRemote: async (_repository, ref) => {
      tagCalls.push(ref);
      const library = manifest.libraries.find(
        ({ releaseRef, releaseTag }) =>
          releaseRef === ref || releaseTag === ref,
      );
      return remoteTagOutput(ref, library.releaseSha);
    },
    releaseExists: async (_repository, tag) => {
      releaseCalls.push(tag);
      return true;
    },
  });
  assert.equal(entries.length, 7);
  assert.deepEqual(releaseCalls, manifest.libraries.map(({ releaseTag }) => releaseTag));
  assert.ok(tagCalls.includes("1.0.3"), "SwiftPM's package tag must be verified");
  assert.ok(
    tagCalls.includes("sdk-ios-v1.0.3"),
    "the canonical iOS GitHub Release tag must be verified",
  );
});

test("coverage CI uses only public reads and never a cross-repository dispatch token", () => {
  assert.match(workflow, /npm run sdk:coverage:verify/u);
  assert.match(workflow, /npm run sdk:coverage:catalog/u);
  assert.doesNotMatch(workflow, /OPENGROW_REFERENCE_DISPATCH_TOKEN/u);
  const coverageSteps = workflow
    .split("\n")
    .filter((line) => line.includes("sdk:coverage:"))
    .join("\n");
  assert.doesNotMatch(coverageSteps, /secrets\.|GH_TOKEN|GITHUB_TOKEN/u);
});
