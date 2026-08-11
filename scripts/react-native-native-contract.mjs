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
  // A pending source version does not invalidate the latest immutable native
  // release. React Native must keep consuming latestReleaseVersion until the
  // corresponding native promotion PR records the new release.
  for (const library of [android, ios]) {
    if (!library.latestReleaseVersion || !library.releaseSha) {
      throw new Error(
        "React Native native dependencies require an immutable published baseline",
      );
    }
  }
  const iosReleaseRef = `sdk-ios-v${ios.latestReleaseVersion}`;
  const historicalRepository = ios.install.match(
    /\.package\(url: "([^"]+)", exact:/u,
  )?.[1];
  if (!historicalRepository) {
    throw new Error(
      "React Native iOS contract requires the historical SwiftPM coordinate",
    );
  }
  const repository = new URL(historicalRepository);
  if (repository.hostname !== "github.com") {
    throw new Error(
      "React Native iOS podspec generation requires a GitHub repository",
    );
  }
  const repositoryPath = repository.pathname
    .replace(/^\//, "")
    .replace(/\.git$/, "");
  const podspecUrl = `https://raw.githubusercontent.com/${repositoryPath}/${iosReleaseRef}/${ios.versionSource}`;

  return {
    schemaVersion: 1,
    android: {
      packageName: android.packageName,
      version: android.latestReleaseVersion,
    },
    ios: {
      packageName: ios.packageName,
      repository: historicalRepository,
      releaseRef: iosReleaseRef,
      podspecUrl,
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
