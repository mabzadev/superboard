import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const flutterPubspecUrl = new URL(
  "../sdks/flutter/pubspec.yaml",
  import.meta.url,
);
const flutterExampleLockUrl = new URL(
  "../sdks/flutter/example/pubspec.lock",
  import.meta.url,
);
const flutterFlowLockUrl = new URL(
  "../sdks/flutterflow/pubspec.lock",
  import.meta.url,
);
const flutterAndroidGradleUrl = new URL(
  "../sdks/flutter/android/build.gradle",
  import.meta.url,
);
const flutterAndroidPluginUrl = new URL(
  "../sdks/flutter/android/src/main/kotlin/io/superboard/wrapper/SuperBoardPlugin.kt",
  import.meta.url,
);
const flutterIosPluginUrl = new URL(
  "../sdks/flutter/ios/Classes/SuperBoardPlugin.swift",
  import.meta.url,
);
const nativeAndroidGradleUrl = new URL(
  "../sdks/android/OpenGrow/OpenGrow/build.gradle.kts",
  import.meta.url,
);
const flutterIosPodspecUrl = new URL(
  "../sdks/flutter/ios/superboard_flutter.podspec",
  import.meta.url,
);
const flutterExamplePodLockUrl = new URL(
  "../sdks/flutter/example/ios/Podfile.lock",
  import.meta.url,
);
const nativeServiceUrl = new URL(
  "../sdks/android/OpenGrow/OpenGrow/src/main/java/io/opengrow/service/OpenGrowService.kt",
  import.meta.url,
);

const semanticVersionPattern =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readCanonicalFlutterVersion(pubspec) {
  const declarations = [...pubspec.matchAll(/^version:\s*(\S+)\s*$/gm)];
  assert.equal(
    declarations.length,
    1,
    "the Flutter pubspec must contain exactly one top-level version",
  );

  const version = declarations[0][1];
  assert.match(version, semanticVersionPattern);
  return version;
}

function dartVersionAtLeast(actual, minimum) {
  const parts = (version) => {
    const [core, build = "0"] = version.split("+");
    return [...core.split("."), build].map(Number);
  };
  const actualParts = parts(actual);
  const minimumParts = parts(minimum);
  for (
    let index = 0;
    index < Math.max(actualParts.length, minimumParts.length);
    index += 1
  ) {
    const difference = (actualParts[index] ?? 0) - (minimumParts[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function lockedPubVersion(lock, dependency) {
  const block = lock.match(
    new RegExp(`^  ${dependency}:\\n(?:(?!^  [a-z]).*\\n)*`, "m"),
  )?.[0];
  return block?.match(/^    version: "([^"]+)"$/m)?.[1];
}

async function sourceFilesBelow(directoryUrl) {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!new Set([".dart_tool", ".gradle", "build"]).has(entry.name)) {
          await visit(path);
        }
      } else if (
        new Set([".dart", ".gradle", ".kt", ".kts", ".java", ".swift"]).has(
          extname(entry.name),
        )
      ) {
        files.push(path);
      }
    }
  };

  await visit(fileURLToPath(directoryUrl));
  return files;
}

test("Flutter Android derives the SDK header version from the canonical pubspec", async () => {
  const [pubspec, buildGradle, nativeService] = await Promise.all([
    readFile(flutterPubspecUrl, "utf8"),
    readFile(flutterAndroidGradleUrl, "utf8"),
    readFile(nativeServiceUrl, "utf8"),
  ]);
  const canonicalVersion = readCanonicalFlutterVersion(pubspec);

  assert.match(buildGradle, /project\.file\("\.\.\/pubspec\.yaml"\)/);
  assert.match(
    buildGradle,
    /buildConfigField "String", "SDK_VERSION", "\\"\$\{flutterSdkVersion\}\\""/,
  );
  assert.doesNotMatch(
    buildGradle,
    /buildConfigField[^\n]*"SDK_VERSION"[^\n]*"\\"[0-9]/,
    `the generated SDK header must not hard-code a version instead of ${canonicalVersion}`,
  );
  assert.match(
    nativeService,
    /"SDK-VERSION"\s+to\s+BuildConfig\.SDK_VERSION/,
    "the Android request header must consume the generated canonical version",
  );
});

test("Flutter iOS derives its CocoaPods version from the canonical pubspec", async () => {
  const [pubspec, podspec, podfileLock] = await Promise.all([
    readFile(flutterPubspecUrl, "utf8"),
    readFile(flutterIosPodspecUrl, "utf8"),
    readFile(flutterExamplePodLockUrl, "utf8"),
  ]);
  const canonicalVersion = readCanonicalFlutterVersion(pubspec);

  assert.doesNotMatch(
    canonicalVersion,
    /\+/,
    "CocoaPods cannot represent Dart build metadata in an exact package version",
  );
  assert.match(podspec, /require 'yaml'/);
  assert.match(podspec, /File\.expand_path\('\.\.\/pubspec\.yaml', __dir__\)/);
  assert.match(podspec, /YAML\.safe_load\(/);
  assert.match(podspec, /s\.version\s*=\s*flutter_sdk_version/);
  assert.doesNotMatch(
    podspec,
    /s\.version\s*=\s*['"][0-9]/,
    `the podspec must not hard-code a version instead of ${canonicalVersion}`,
  );
  assert.equal(
    podfileLock.match(/^  - superboard_flutter \(([^)]+)\):$/m)?.[1],
    canonicalVersion,
    "the committed Flutter example Podfile.lock must resolve the canonical package version",
  );
});

test("Flutter 3 registers one canonical SuperBoard plugin with legacy configuration fallbacks", async () => {
  const [pubspec, androidPlugin, iosPlugin, androidBuild] = await Promise.all([
    readFile(flutterPubspecUrl, "utf8"),
    readFile(flutterAndroidPluginUrl, "utf8"),
    readFile(flutterIosPluginUrl, "utf8"),
    readFile(flutterAndroidGradleUrl, "utf8"),
  ]);

  assert.match(pubspec, /^name: superboard_flutter$/m);
  assert.match(pubspec, /^version: 3\.0\.0$/m);
  assert.match(pubspec, /package: io\.superboard\.wrapper/);
  assert.match(pubspec, /pluginClass: SuperBoardPlugin/g);
  assert.equal(
    [...pubspec.matchAll(/pluginClass: SuperBoardPlugin/g)].length,
    2,
    "Android and iOS must register the same canonical plugin class exactly once per platform",
  );

  assert.match(androidPlugin, /^package io\.superboard\.wrapper$/m);
  assert.match(androidPlugin, /class SuperBoardPlugin/);
  assert.match(androidPlugin, /binaryMessenger, "superboard"/);
  assert.match(androidPlugin, /binaryMessenger, "superboard\/deeplinks"/);
  assert.match(androidPlugin, /meta\.getString\("superboard_api_key"\)/);
  assert.match(androidPlugin, /meta\.getString\("opengrow_api_key"\)/);

  assert.match(iosPlugin, /public class SuperBoardPlugin/);
  assert.match(iosPlugin, /FlutterMethodChannel\(name: "superboard"/);
  assert.match(iosPlugin, /FlutterEventChannel\(name: "superboard\/deeplinks"/);
  assert.match(iosPlugin, /infoDictionary\["SuperBoardApiKey"\]/);
  assert.match(iosPlugin, /infoDictionary\["OpenGrowApiKey"\]/);

  assert.match(
    androidBuild,
    /namespace = "io\.opengrow"/,
    "the embedded internal Android sources still require their physical R and BuildConfig namespace",
  );
});

test("Flutter consumers lock the patched JOSE implementation", async () => {
  const [pubspec, exampleLock, flutterFlowLock] = await Promise.all([
    readFile(flutterPubspecUrl, "utf8"),
    readFile(flutterExampleLockUrl, "utf8"),
    readFile(flutterFlowLockUrl, "utf8"),
  ]);

  assert.match(pubspec, /^  jose: \^0\.3\.5\+2$/m);
  for (const lock of [exampleLock, flutterFlowLock]) {
    const version = lockedPubVersion(lock, "jose");
    assert.ok(version, "jose must remain in each committed pub lock");
    assert.ok(
      dartVersionAtLeast(version, "0.3.5+1"),
      `jose ${version} is below the patched floor 0.3.5+1`,
    );
  }
});

test("Android SDK sources do not generate or consume the obsolete test server field", async () => {
  const obsoleteField = ["TEST", "SERVER", "URL"].join("_");
  const sourceRoots = [
    new URL("../sdks/android/", import.meta.url),
    new URL("../sdks/flutter/android/", import.meta.url),
  ];
  const files = (
    await Promise.all(
      sourceRoots.map((sourceRoot) => sourceFilesBelow(sourceRoot)),
    )
  ).flat();
  const offenders = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes(obsoleteField)) {
      offenders.push(file.replace(repositoryRoot, ""));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${obsoleteField} is dead configuration; use an injected MockWebServer URL in tests`,
  );

  const nativeAndroidGradle = await readFile(nativeAndroidGradleUrl, "utf8");
  assert.doesNotMatch(nativeAndroidGradle, /localhost:8080/);
});
