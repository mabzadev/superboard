import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadSdkCatalog } from "./sdk-catalog.mjs";
import {
  applySdkDocumentationSections,
  renderSdkDocumentationSections,
  sdkDocumentationAuditPaths,
  sdkDocumentationContracts,
  validateSdkDocumentation,
} from "./sdk-documentation.mjs";

async function currentDocuments() {
  const paths = [
    ...sdkDocumentationContracts.map(({ path }) => path),
    ...sdkDocumentationAuditPaths,
  ];
  return new Map(
    await Promise.all(
      paths.map(async (path) => [
        path,
        await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
      ]),
    ),
  );
}

test("canonical SDK documentation is generated from the release catalogue", async () => {
  const catalog = await loadSdkCatalog();
  const result = validateSdkDocumentation(catalog, await currentDocuments());

  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("documentation follows published metadata, not pending source state", async () => {
  const catalog = await loadSdkCatalog();
  const flutterflow = catalog.libraries.find(({ id }) => id === "flutterflow");
  const publishedRef = flutterflow.releaseRef;
  flutterflow.sourceVersion = "9.9.9";
  flutterflow.releaseStatus = "pending-release";
  const sections = renderSdkDocumentationSections(catalog);

  assert.ok(sections.get("flutterflow").includes(publishedRef));
  assert.doesNotMatch(sections.get("flutterflow"), /9\.9\.9/u);
});

test("a catalogue promotion regenerates documentation without frozen state", async () => {
  const catalog = await loadSdkCatalog();
  const flutterflow = catalog.libraries.find(({ id }) => id === "flutterflow");
  const [major, minor, patch] = flutterflow.sourceVersion
    .split(".")
    .map(Number);
  const promotedVersion =
    flutterflow.sourceVersion === flutterflow.latestReleaseVersion
      ? `${major}.${minor}.${patch + 1}`
      : flutterflow.sourceVersion;
  const promotedRef = `sdk-flutterflow-v${promotedVersion}`;
  flutterflow.sourceVersion = promotedVersion;
  flutterflow.latestReleaseVersion = promotedVersion;
  flutterflow.releaseRef = promotedRef;
  flutterflow.releaseStatus = "released";
  flutterflow.install = flutterflow.install.replace(
    /sdk-flutterflow-v[0-9]+\.[0-9]+\.[0-9]+/u,
    promotedRef,
  );
  const documents = await currentDocuments();
  const applied = applySdkDocumentationSections(catalog, documents);
  assert.deepEqual(applied.errors, []);
  const promotedDocuments = new Map([...documents, ...applied.documents]);
  const result = validateSdkDocumentation(catalog, promotedDocuments);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.ok(
    promotedDocuments.get("sdks/flutterflow/README.md").includes(promotedRef),
  );
});

test("all package coordinates and versions are derived state-independently", async () => {
  const catalog = await loadSdkCatalog();
  const javascript = catalog.libraries.find(({ id }) => id === "javascript");
  javascript.packageName = "@example/opengrow-browser";
  javascript.latestReleaseVersion = "7.8.9";
  javascript.releaseRef = "sdk-js-v7.8.9";
  javascript.install = "npm install @example/opengrow-browser@7.8.9";
  const reactNative = catalog.libraries.find(({ id }) => id === "react-native");
  reactNative.packageName = "@example/opengrow-native";
  reactNative.latestReleaseVersion = "4.5.6";
  reactNative.releaseRef = "sdk-react-native-v4.5.6";
  reactNative.install = "npm install @example/opengrow-native@4.5.6";
  const android = catalog.libraries.find(({ id }) => id === "android");
  android.packageName = "dev.example:opengrow-android";
  android.latestReleaseVersion = "3.2.1";
  android.releaseRef = "sdk-android-v3.2.1";
  android.install = 'implementation("dev.example:opengrow-android:3.2.1")';
  const ios = catalog.libraries.find(({ id }) => id === "ios");
  ios.latestReleaseVersion = "6.5.4";
  ios.releaseRef = "6.5.4";
  ios.install =
    '.package(url: "https://github.com/mbzadev/opengrow-platform.git", exact: "6.5.4")';
  const sections = renderSdkDocumentationSections(catalog);

  assert.match(
    sections.get("javascript"),
    /@example\/opengrow-browser@7\.8\.9/u,
  );
  assert.match(
    sections.get("react-native"),
    /@example\/opengrow-native@4\.5\.6/u,
  );
  assert.match(
    sections.get("react-native"),
    /dev\.example:opengrow-android:3\.2\.1/u,
  );
  assert.match(sections.get("react-native"), /sdk-ios-v6\.5\.4/u);
  assert.match(sections.get("ios"), /exact: "6\.5\.4"/u);
});

test("iOS documentation rejects an unsupported CocoaPods Trunk promise", async () => {
  const catalog = await loadSdkCatalog();
  const sections = renderSdkDocumentationSections(catalog);
  const ios = sections.get("ios");

  assert.match(ios, /CocoaPods Trunk is not a published or supported/u);
  assert.doesNotMatch(ios, /cocoapods\.org\/pods\/OpenGrow/u);
  assert.doesNotMatch(ios, /^pod ['"]OpenGrow['"]$/mu);

  const documents = await currentDocuments();
  documents.set(
    "sdks/ios/CLAUDE.md",
    `${documents.get("sdks/ios/CLAUDE.md")}\nDistributed via SPM and CocoaPods.\n`,
  );
  const result = validateSdkDocumentation(catalog, documents);
  assert.match(
    result.errors.join("\n"),
    /must not be documented as a published package channel/u,
  );
});

test("missing, duplicate and reversed documentation markers fail closed", async () => {
  const catalog = await loadSdkCatalog();
  const documents = await currentDocuments();
  const flutterPath = "sdks/flutter/README.md";
  documents.set(
    flutterPath,
    documents
      .get(flutterPath)
      .replace("<!-- opengrow-sdk-documentation:flutter:end -->", ""),
  );
  let result = applySdkDocumentationSections(catalog, documents);
  assert.match(
    result.errors.join("\n"),
    /expected exactly one flutter documentation section/u,
  );

  const duplicate = await currentDocuments();
  duplicate.set(
    flutterPath,
    `${duplicate.get(flutterPath)}\n<!-- opengrow-sdk-documentation:flutter:start -->`,
  );
  result = applySdkDocumentationSections(catalog, duplicate);
  assert.match(
    result.errors.join("\n"),
    /expected exactly one flutter documentation section/u,
  );

  const reversed = await currentDocuments();
  reversed.set(
    flutterPath,
    reversed
      .get(flutterPath)
      .replace(
        /<!-- opengrow-sdk-documentation:flutter:start -->[\s\S]*?<!-- opengrow-sdk-documentation:flutter:end -->/u,
        "<!-- opengrow-sdk-documentation:flutter:end -->\n<!-- opengrow-sdk-documentation:flutter:start -->",
      ),
  );
  result = applySdkDocumentationSections(catalog, reversed);
  assert.match(result.errors.join("\n"), /markers are reversed/u);
});

test("retired npm and Gradle coordinates fail outside generated sections", async () => {
  const catalog = await loadSdkCatalog();
  const documents = await currentDocuments();
  const jsPath = "sdks/javascript/README.md";
  const androidPath = "sdks/android/README.md";
  documents.set(
    jsPath,
    `${documents.get(jsPath)}\nimport OpenGrow from "@mbzadev/opengrow-js";\n`,
  );
  documents.set(
    androidPath,
    `${documents.get(androidPath)}\nimplementation("io.opengrow:opengrow-android:1.0.0")\n`,
  );
  const result = validateSdkDocumentation(catalog, documents);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /retired javascript coordinate/u);
  assert.match(result.errors.join("\n"), /retired android coordinate/u);
});
