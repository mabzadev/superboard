import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadSdkCatalog } from "./sdk-catalog.mjs";
import {
  nativeContractFromCatalog,
  validateNativeContract,
} from "./react-native-native-contract.mjs";

function numericVersionAtLeast(actual, minimum) {
  const actualParts = actual.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
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

function lockedGemVersion(lock, gem) {
  const escaped = gem.replaceAll("-", "\\-");
  return lock.match(new RegExp(`^    ${escaped} \\(([^)]+)\\)$`, "m"))?.[1];
}

test("React Native native contract is derived from published SDK baselines", async () => {
  const catalog = await loadSdkCatalog();
  const contract = nativeContractFromCatalog(catalog);
  const android = catalog.libraries.find((item) => item.id === "android");
  const ios = catalog.libraries.find((item) => item.id === "ios");

  assert.deepEqual(contract.android, {
    packageName: android.packageName,
    version: android.latestReleaseVersion,
  });
  const repository = ios.install.match(
    /\.package\(url: "([^"]+)", exact:/u,
  )?.[1];
  assert.ok(repository, "the iOS catalogue exposes its immutable repository");
  const repositoryPath = new URL(repository).pathname
    .replace(/^\//, "")
    .replace(/\.git$/, "");
  assert.deepEqual(contract.ios, {
    packageName: ios.packageName,
    repository,
    releaseRef: `sdk-ios-v${ios.latestReleaseVersion}`,
    podspecUrl:
      `https://raw.githubusercontent.com/${repositoryPath}/` +
      `sdk-ios-v${ios.latestReleaseVersion}/${ios.versionSource}`,
    version: ios.latestReleaseVersion,
  });
  assert.equal((await validateNativeContract()).ok, true);
});

test("pending native sources preserve the latest immutable consumer baseline", async () => {
  const catalog = await loadSdkCatalog();
  const staged = structuredClone(catalog);
  for (const id of ["android", "ios"]) {
    const library = staged.libraries.find((item) => item.id === id);
    library.releaseStatus = "pending-release";
    library.sourceVersion = "99.0.0";
  }

  const contract = nativeContractFromCatalog(staged);
  const android = staged.libraries.find((item) => item.id === "android");
  const ios = staged.libraries.find((item) => item.id === "ios");
  assert.equal(contract.android.version, android.latestReleaseVersion);
  assert.equal(contract.ios.version, ios.latestReleaseVersion);
  assert.equal(contract.ios.releaseRef, `sdk-ios-v${ios.latestReleaseVersion}`);
});

test("React Native consumers contain no retired Android coordinate", async () => {
  const sources = await Promise.all(
    [
      "../sdks/react-native/android/build.gradle",
      "../sdks/react-native/example/android/app/build.gradle",
      "../sdks/react-native/plugin/withOpenGrowAndroid.js",
      "../sdks/react-native/README.md",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const source = sources.join("\n");
  assert.doesNotMatch(source, /io\.opengrow:OpenGrow:/);
  assert.doesNotMatch(source, /io\.opengrow:opengrow-android:/);
});

test("React Native example substitutes the catalog coordinate with local Android source", async () => {
  const [settings, fixtureSettings, fixtureBuild] = await Promise.all(
    [
      "../sdks/react-native/example/android/settings.gradle",
      "./fixtures/react-native-android-contract/settings.gradle",
      "./fixtures/react-native-android-contract/build.gradle",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  for (const source of [settings, fixtureSettings]) {
    assert.match(source, /plugin\/native-contract\.json/);
    assert.match(
      source,
      /substitute module\([^)]*\.android\.packageName\) using project\(':OpenGrow'\)/,
    );
    assert.match(source, /includeBuild\(/);
  }
  assert.match(settings, /includeBuild\(openGrowAndroidSource\)/);
  assert.match(
    fixtureBuild,
    /dependency\.selected\.id instanceof ProjectComponentIdentifier/,
  );
  assert.match(
    fixtureBuild,
    /resolved from a registry instead of sdks\/android/,
  );
});

test("React Native iOS consumers use the immutable catalog podspec", async () => {
  const catalog = await loadSdkCatalog();
  const contract = nativeContractFromCatalog(catalog);
  const [podspec, podfile, readme] = await Promise.all(
    [
      "../sdks/react-native/opengrow-react-native.podspec",
      "../sdks/react-native/example/ios/Podfile",
      "../sdks/react-native/README.md",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  assert.match(
    podspec,
    /s\.dependency native_contract\["ios"\]\["packageName"\], "= #\{native_contract\["ios"\]\["version"\]\}"/,
  );
  assert.doesNotMatch(podspec, /s\.dependency\s+["']OpenGrow["']\s*,\s*["']~>/);
  assert.match(podfile, /native_contract\["ios"\]\["podspecUrl"\]/);
  assert.match(
    readme,
    new RegExp(contract.ios.releaseRef.replaceAll(".", "\\.")),
  );
  assert.match(readme, /does not claim a CocoaPods Trunk release/i);
});

test("React Native example locks a supported Ruby and patched build gems", async () => {
  const [gemfile, lock, rootRuby, iosRuby] = await Promise.all(
    [
      "../sdks/react-native/example/Gemfile",
      "../sdks/react-native/example/Gemfile.lock",
      "../sdks/react-native/.ruby-version",
      "../sdks/react-native/example/ios/.ruby-version",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const rubyVersion = rootRuby.trim();

  assert.equal(iosRuby.trim(), rubyVersion);
  assert.ok(
    numericVersionAtLeast(rubyVersion, "3.4.0"),
    `Ruby ${rubyVersion} is below the supported build baseline 3.4.0`,
  );
  assert.match(gemfile, /^ruby ">= 3\.4\.0", "< 4\.0"$/m);
  for (const [gem, minimum] of [
    ["activesupport", "7.2.3.1"],
    ["addressable", "2.9.0"],
    ["concurrent-ruby", "1.3.7"],
    ["rexml", "3.4.2"],
  ]) {
    const version = lockedGemVersion(lock, gem);
    assert.ok(version, `${gem} must remain in Gemfile.lock`);
    assert.ok(
      numericVersionAtLeast(version, minimum),
      `${gem} ${version} is below the patched floor ${minimum}`,
    );
    assert.match(
      gemfile,
      new RegExp(
        `^gem ['"]${gem}['"], ['"]${minimum.replaceAll(".", "\\.")}['"]$`,
        "m",
      ),
      `${gem} must keep its patched floor explicit in Gemfile`,
    );
  }
});
