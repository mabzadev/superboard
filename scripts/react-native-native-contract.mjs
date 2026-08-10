import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSdkCatalog } from "./sdk-catalog.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const contractPath = resolve(
  root,
  "sdks/react-native/plugin/native-contract.json",
);

export function nativeContractFromCatalog(catalog) {
  const android = catalog.libraries.find((item) => item.id === "android");
  const ios = catalog.libraries.find((item) => item.id === "ios");
  if (!android || !ios) {
    throw new Error("Android and iOS SDK entries are required");
  }
  if (
    android.releaseStatus !== "released" ||
    ios.releaseStatus !== "released"
  ) {
    throw new Error("React Native native dependencies must be released");
  }
  return {
    schemaVersion: 1,
    android: {
      packageName: android.packageName,
      version: android.latestReleaseVersion,
    },
    ios: {
      packageName: ios.packageName,
      repository: `${catalog.repository}.git`,
      releaseRef: `sdk-ios-v${ios.latestReleaseVersion}`,
      version: ios.latestReleaseVersion,
    },
  };
}

export async function validateNativeContract() {
  const catalog = await loadSdkCatalog();
  const expected = nativeContractFromCatalog(catalog);
  const observed = JSON.parse(await readFile(contractPath, "utf8"));
  return {
    ok: JSON.stringify(observed) === JSON.stringify(expected),
    expected,
    observed,
  };
}

async function main() {
  const command = process.argv[2] ?? "check";
  const catalog = await loadSdkCatalog();
  const expected = nativeContractFromCatalog(catalog);
  if (command === "write") {
    await writeFile(contractPath, `${JSON.stringify(expected, null, 2)}\n`);
  } else if (command !== "check") {
    throw new Error(`Unsupported command: ${command}`);
  }
  const result = await validateNativeContract();
  if (!result.ok) {
    throw new Error(
      "React Native native contract is stale; run npm run react-native:native-contract:write",
    );
  }
  process.stdout.write(
    `${JSON.stringify({ status: "ok", contract: result.expected }, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
