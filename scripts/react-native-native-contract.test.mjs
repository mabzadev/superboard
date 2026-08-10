import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadSdkCatalog } from "./sdk-catalog.mjs";
import {
  nativeContractFromCatalog,
  validateNativeContract,
} from "./react-native-native-contract.mjs";

test("React Native native contract is derived from released SDK entries", async () => {
  const catalog = await loadSdkCatalog();
  const contract = nativeContractFromCatalog(catalog);
  const android = catalog.libraries.find((item) => item.id === "android");
  const ios = catalog.libraries.find((item) => item.id === "ios");

  assert.deepEqual(contract.android, {
    packageName: android.packageName,
    version: android.latestReleaseVersion,
  });
  assert.deepEqual(contract.ios, {
    packageName: ios.packageName,
    repository: `${catalog.repository}.git`,
    releaseRef: `sdk-ios-v${ios.latestReleaseVersion}`,
    version: ios.latestReleaseVersion,
  });
  assert.equal((await validateNativeContract()).ok, true);
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
