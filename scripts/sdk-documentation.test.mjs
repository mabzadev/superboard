import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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

test("documentation derives lifecycle notices independently from release status", async () => {
  const catalog = await loadSdkCatalog();
  const sections = renderSdkDocumentationSections(catalog);

  assert.match(sections.get("flutter"), /Lifecycle: active/u);
  assert.match(sections.get("flutterflow"), /Lifecycle: active/u);
  assert.match(sections.get("ios"), /Lifecycle: internal/u);
  assert.match(sections.get("android"), /Lifecycle: internal/u);
  assert.match(sections.get("flutterflow-support"), /Lifecycle: archived/u);
  assert.match(sections.get("javascript"), /Lifecycle: archived/u);
  assert.match(sections.get("react-native"), /Lifecycle: archived/u);
  assert.match(
    sections.get("flutter"),
    /sdk-flutter-v2\.1\.4/u,
  );
  assert.doesNotMatch(sections.get("flutter"), /sdk-flutter-v3\.0\.0/u);
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
    '.package(url: "https://github.com/mbzadev/superboard-platform.git", exact: "6.5.4")';
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

test("registry documentation separates public metadata from authenticated installation", async () => {
  const catalog = await loadSdkCatalog();
  const sections = renderSdkDocumentationSections(catalog);
  const javascript = sections.get("javascript");
  const reactNative = sections.get("react-native");
  const android = sections.get("android");

  for (const source of [javascript, reactNative, android]) {
    assert.match(source, /record is public metadata/u);
    assert.match(
      source,
      /does not make the[\s\S]*registry anonymously installable/u,
    );
    assert.match(source, /401 Unauthorized/u);
    assert.match(source, /read:packages/u);
    assert.match(source, /OPENGROW_GITHUB_PACKAGES_TOKEN/u);
    assert.doesNotMatch(source, /\b(?:ghp_|github_pat_)[A-Za-z0-9_]+\b/u);
  }

  for (const source of [javascript, reactNative]) {
    assert.match(source, /@mbzadev:registry=https:\/\/npm\.pkg\.github\.com/u);
    assert.match(
      source,
      /\/\/npm\.pkg\.github\.com\/:_authToken=\$\{OPENGROW_GITHUB_PACKAGES_TOKEN\}/u,
    );
    assert.ok(
      source.indexOf("OPENGROW_GITHUB_PACKAGES_TOKEN") <
        source.indexOf("npm install"),
    );
  }

  for (const source of [android, reactNative]) {
    assert.match(
      source,
      /https:\/\/maven\.pkg\.github\.com\/mbzadev\/superboard-platform/u,
    );
    assert.match(source, /OPENGROW_GITHUB_PACKAGES_USER/u);
    assert.match(source, /OPENGROW_GITHUB_PACKAGES_TOKEN/u);
    assert.ok(
      source.indexOf("OPENGROW_GITHUB_PACKAGES_USER") <
        source.indexOf("io.opengrow:opengrow-android-sdk:1.0.3"),
    );
  }

  assert.match(javascript, /npm install @mbzadev\/opengrow-js-sdk@1\.0\.2/u);
  assert.match(
    reactNative,
    /npm install @mbzadev\/opengrow-react-native-sdk@1\.0\.2/u,
  );
  assert.match(android, /\.\/gradlew assemble/u);
  assert.match(reactNative, /cd android && \.\/gradlew assemble/u);
  assert.match(
    javascript,
    /test -n "\$\{OPENGROW_GITHUB_PACKAGES_TOKEN:-\}" \\\n  && npm install/u,
  );
  for (const source of [android, reactNative]) {
    assert.match(
      source,
      /test -n "\$\{OPENGROW_GITHUB_PACKAGES_USER:-\}" \\\n  && test -n "\$\{OPENGROW_GITHUB_PACKAGES_TOKEN:-\}" \\\n  && /u,
    );
  }
});

test("registry shell preflights stop npm and Gradle when credentials are absent", async () => {
  const sections = renderSdkDocumentationSections(await loadSdkCatalog());
  const javascript = sections.get("javascript");
  const android = sections.get("android");
  const javascriptPreflight = [
    ...javascript.matchAll(/```bash\n([\s\S]*?)\n```/gu),
  ]
    .map(([, source]) => source)
    .find((source) => source.includes("npm install"));
  const androidPreflight = [...android.matchAll(/```bash\n([\s\S]*?)\n```/gu)]
    .map(([, source]) => source)
    .find((source) => source.includes("./gradlew assemble"));
  assert.ok(javascriptPreflight);
  assert.ok(androidPreflight);

  const directory = mkdtempSync(resolve(tmpdir(), "opengrow-sdk-preflight-"));
  const marker = resolve(directory, "invoked");
  const fakeNpm = resolve(directory, "npm");
  const fakeGradle = resolve(directory, "gradlew");
  writeFileSync(fakeNpm, '#!/bin/sh\ntouch "$OPENGROW_PREFLIGHT_MARKER"\n');
  writeFileSync(fakeGradle, '#!/bin/sh\ntouch "$OPENGROW_PREFLIGHT_MARKER"\n');
  chmodSync(fakeNpm, 0o755);
  chmodSync(fakeGradle, 0o755);
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.OPENGROW_GITHUB_PACKAGES_USER;
  delete cleanEnvironment.OPENGROW_GITHUB_PACKAGES_TOKEN;
  cleanEnvironment.OPENGROW_PREFLIGHT_MARKER = marker;
  cleanEnvironment.PATH = `${directory}:${cleanEnvironment.PATH}`;

  try {
    const npmResult = spawnSync("bash", ["-c", javascriptPreflight], {
      cwd: directory,
      env: cleanEnvironment,
    });
    assert.notEqual(npmResult.status, 0);
    assert.equal(existsSync(marker), false);

    const userOnlyResult = spawnSync("bash", ["-c", androidPreflight], {
      cwd: directory,
      env: {
        ...cleanEnvironment,
        OPENGROW_GITHUB_PACKAGES_USER: "developer",
      },
    });
    assert.notEqual(userOnlyResult.status, 0);
    assert.equal(existsSync(marker), false);

    const authenticatedResult = spawnSync("bash", ["-c", androidPreflight], {
      cwd: directory,
      env: {
        ...cleanEnvironment,
        OPENGROW_GITHUB_PACKAGES_USER: "developer",
        OPENGROW_GITHUB_PACKAGES_TOKEN: "test-token",
      },
    });
    assert.equal(authenticatedResult.status, 0);
    assert.equal(existsSync(marker), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("documentation rejects hardcoded registry credentials", async () => {
  const catalog = await loadSdkCatalog();
  const documents = await currentDocuments();
  const javascriptPath = "sdks/javascript/README.md";
  documents.set(
    javascriptPath,
    `${documents.get(javascriptPath)}\n//npm.pkg.github.com/:_authToken=github_pat_forbidden\n`,
  );
  const result = validateSdkDocumentation(catalog, documents);

  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /package registry credentials must not be hardcoded/u,
  );
  assert.match(
    result.errors.join("\n"),
    /npm authentication must use an environment-variable placeholder/u,
  );
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
