import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const reactNativeRoot = resolve(root, "sdks/react-native");
const execFileAsync = promisify(execFile);

export const npmAdvisoryBulkUrl =
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";

export const imageSizePatchContract = Object.freeze({
  packageName: "image-size",
  sourceVersion: "1.2.1",
  resolutionKey: "image-size@^1.0.2",
  resolution:
    "patch:image-size@npm%3A1.2.1#./.yarn/patches/image-size-npm-1.2.1-e285f3c080.patch",
  lockHash: "80d774",
  patchPath: ".yarn/patches/image-size-npm-1.2.1-e285f3c080.patch",
  patchSha256:
    "21f4e087748a17f6200705cd102689cfedf349f63f7529cc8f96ac48a1d8ec6f",
  advisories: ["GHSA-w3rx-r6r6-pgpr", "GHSA-5p2g-fcmc-qvqq"],
  workspaceLocator: "@mbzadev/opengrow-react-native-sdk@workspace:.",
});

const encodedImageSizePatchWorkspaceLocator = encodeURIComponent(
  imageSizePatchContract.workspaceLocator,
);
const imageSizePatchReference = `${imageSizePatchContract.packageName}@${imageSizePatchContract.resolution}`;

export const imageSizePatchDescriptor = `${imageSizePatchReference}::locator=${encodedImageSizePatchWorkspaceLocator}`;

export const imageSizePatchLocator = `${imageSizePatchReference}::version=${imageSizePatchContract.sourceVersion}&hash=${imageSizePatchContract.lockHash}&locator=${encodedImageSizePatchWorkspaceLocator}`;

const imageSizeSourceLocator = `${imageSizePatchContract.packageName}@npm:${imageSizePatchContract.sourceVersion}`;

const imageSizeAdvisoryAllowlist = imageSizePatchContract.advisories.map(
  (ghsaId) => ({
    packageName: imageSizePatchContract.packageName,
    url: `https://github.com/advisories/${ghsaId}`,
  }),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function yarnLockEntries(lockSource) {
  if (typeof lockSource !== "string" || lockSource.length === 0) {
    throw new Error("React Native yarn.lock is empty or invalid");
  }
  const entries = [];
  let currentEntry;
  for (const line of lockSource.split(/\r?\n/u)) {
    const descriptorMatch = /^"([^"\r\n]+)":$/u.exec(line);
    if (descriptorMatch) {
      currentEntry = { descriptor: descriptorMatch[1], resolutions: [] };
      entries.push(currentEntry);
      continue;
    }
    if (line.length > 0 && !/^\s/u.test(line) && !line.startsWith("#")) {
      currentEntry = undefined;
      continue;
    }
    const resolutionMatch = /^  resolution: "([^"\r\n]+)"$/u.exec(line);
    if (resolutionMatch && currentEntry) {
      currentEntry.resolutions.push(resolutionMatch[1]);
    }
  }
  return entries;
}

function validateImageSizeLockEntries(lockSource) {
  const imageSizeEntries = yarnLockEntries(lockSource).filter(
    ({ descriptor }) =>
      descriptor
        .split(", ")
        .some((selector) =>
          selector.startsWith(`${imageSizePatchContract.packageName}@`),
        ),
  );
  const expectedEntries = new Map([
    [imageSizeSourceLocator, imageSizeSourceLocator],
    [imageSizePatchDescriptor, imageSizePatchLocator],
  ]);

  if (imageSizeEntries.length !== expectedEntries.size) {
    throw new Error(
      "React Native yarn.lock contains an unexpected image-size descriptor or locator",
    );
  }
  for (const { descriptor, resolutions } of imageSizeEntries) {
    const expectedResolution = expectedEntries.get(descriptor);
    if (
      expectedResolution === undefined ||
      resolutions.length !== 1 ||
      resolutions[0] !== expectedResolution
    ) {
      throw new Error(
        "React Native yarn.lock contains an unexpected image-size descriptor or locator",
      );
    }
    expectedEntries.delete(descriptor);
  }
  if (expectedEntries.size !== 0) {
    throw new Error(
      "React Native yarn.lock does not bind the reviewed image-size security patch",
    );
  }
}

export function imageSizeInstalledLocatorsFromYarnWhy(whySource) {
  if (typeof whySource !== "string" || whySource.trim().length === 0) {
    throw new Error("Yarn reported no installed image-size occurrences");
  }
  const locators = [];
  for (const line of whySource.split(/\r?\n/u).filter(Boolean)) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error("Yarn why returned invalid JSON locator data");
    }
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      typeof record.value !== "string" ||
      record.children === null ||
      typeof record.children !== "object" ||
      Array.isArray(record.children)
    ) {
      throw new Error("Yarn why returned invalid image-size locator data");
    }
    for (const [childKey, child] of Object.entries(record.children)) {
      if (
        child === null ||
        typeof child !== "object" ||
        Array.isArray(child) ||
        typeof child.locator !== "string" ||
        typeof child.descriptor !== "string" ||
        childKey !== child.locator
      ) {
        throw new Error("Yarn why returned invalid image-size locator data");
      }
      if (
        child.locator !== imageSizePatchLocator ||
        child.descriptor !== imageSizePatchDescriptor
      ) {
        throw new Error(
          `Yarn installed an unreviewed image-size locator: ${child.locator}`,
        );
      }
      locators.push(child.locator);
    }
  }
  if (locators.length === 0) {
    throw new Error("Yarn reported no installed image-size occurrences");
  }
  return locators;
}

export function validateImageSizePatchContract({
  packageJson,
  patchSource,
  lockSource,
  whySource,
}) {
  if (
    packageJson?.resolutions?.[imageSizePatchContract.resolutionKey] !==
    imageSizePatchContract.resolution
  ) {
    throw new Error(
      "React Native image-size security patch resolution is missing or changed",
    );
  }
  if (sha256(patchSource) !== imageSizePatchContract.patchSha256) {
    throw new Error(
      "React Native image-size security patch checksum does not match the reviewed contract",
    );
  }
  validateImageSizeLockEntries(lockSource);
  const installedLocators = imageSizeInstalledLocatorsFromYarnWhy(whySource);
  return {
    packageName: imageSizePatchContract.packageName,
    sourceVersion: imageSizePatchContract.sourceVersion,
    installedOccurrences: installedLocators.length,
    locator: imageSizePatchLocator,
  };
}

export function npmPackageVersionsFromYarnLock(lockSource) {
  const packages = new Map();
  const resolutionPattern = /^  resolution: "(.+)"$/gmu;
  for (const match of lockSource.matchAll(resolutionPattern)) {
    const resolution = match[1];
    const npmResolution = /^(.*)@npm:([^@]+)$/u.exec(resolution);
    if (!npmResolution) continue;
    const [, packageName, version] = npmResolution;
    const versions = packages.get(packageName) ?? new Set();
    versions.add(version);
    packages.set(packageName, versions);
  }
  if (packages.size === 0) {
    throw new Error(
      "React Native yarn.lock contains no auditable npm packages",
    );
  }
  return Object.fromEntries(
    [...packages.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([packageName, versions]) => [packageName, [...versions].sort()]),
  );
}

function validAdvisoryResponse(payload) {
  return (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Object.values(payload).every(
      (advisories) =>
        Array.isArray(advisories) &&
        advisories.every(
          (advisory) =>
            advisory !== null &&
            typeof advisory === "object" &&
            Number.isInteger(advisory.id) &&
            typeof advisory.url === "string" &&
            typeof advisory.title === "string" &&
            typeof advisory.severity === "string" &&
            typeof advisory.vulnerable_versions === "string",
        ),
    )
  );
}

export async function auditNpmPackageVersions(
  packages,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    advisoryAllowlist = [],
  } = {},
) {
  const allowedAdvisories = new Set();
  for (const entry of advisoryAllowlist) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.packageName !== "string" ||
      typeof entry.url !== "string" ||
      !Object.hasOwn(packages, entry.packageName)
    ) {
      throw new Error("React Native npm advisory allowlist is invalid");
    }
    const key = `${entry.packageName}\u0000${entry.url}`;
    if (allowedAdvisories.has(key)) {
      throw new Error(
        "React Native npm advisory allowlist contains duplicates",
      );
    }
    allowedAdvisories.add(key);
  }
  let response;
  try {
    response = await fetchImpl(npmAdvisoryBulkUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "opengrow-react-native-security-audit/1",
      },
      body: JSON.stringify(packages),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      `React Native npm advisory audit failed closed: ${error instanceof Error ? error.message : "network failure"}`,
    );
  }
  if (!response?.ok) {
    throw new Error(
      `React Native npm advisory audit failed closed: registry returned HTTP ${response?.status ?? "unknown"}`,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "React Native npm advisory audit failed closed: registry returned invalid JSON",
    );
  }
  if (!validAdvisoryResponse(payload)) {
    throw new Error(
      "React Native npm advisory audit failed closed: registry response violates the bulk advisory contract",
    );
  }
  const advisories = Object.entries(payload).flatMap(
    ([packageName, entries]) => {
      if (!Object.hasOwn(packages, packageName)) {
        throw new Error(
          "React Native npm advisory audit failed closed: registry returned an unrequested package",
        );
      }
      return entries.map((advisory) => ({
        packageName,
        id: advisory.id,
        url: advisory.url,
        title: advisory.title,
        severity: advisory.severity,
        vulnerableVersions: advisory.vulnerable_versions,
      }));
    },
  );
  const seenAllowedAdvisories = new Set();
  const unexpectedAdvisories = advisories.filter(({ packageName, url }) => {
    const key = `${packageName}\u0000${url}`;
    if (!allowedAdvisories.has(key)) return true;
    seenAllowedAdvisories.add(key);
    return false;
  });
  if (unexpectedAdvisories.length > 0) {
    throw new Error(
      `React Native npm advisory audit found ${unexpectedAdvisories.length} unexpected advisory(s): ${unexpectedAdvisories
        .map(
          ({ packageName, id, severity, url }) =>
            `${packageName}#${id} (${severity}, ${url})`,
        )
        .join(", ")}`,
    );
  }
  const missingAllowedAdvisories = [...allowedAdvisories].filter(
    (key) => !seenAllowedAdvisories.has(key),
  );
  if (missingAllowedAdvisories.length > 0) {
    throw new Error(
      "React Native npm advisory audit failed closed: registry omitted a reviewed patched advisory",
    );
  }
  return {
    advisories: 0,
    allowedPatchedAdvisories: seenAllowedAdvisories.size,
    auditedPackages: Object.keys(packages).length,
  };
}

async function yarnWhyImageSize() {
  const yarnPath = resolve(reactNativeRoot, ".yarn/releases/yarn-3.6.1.cjs");
  let result;
  try {
    result = await execFileAsync(
      process.execPath,
      [yarnPath, "why", imageSizePatchContract.packageName, "--json"],
      { cwd: reactNativeRoot, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    throw new Error(
      `React Native image-size locator verification failed closed: ${error instanceof Error ? error.message : "Yarn failure"}`,
    );
  }
  if (result.stderr.trim().length > 0) {
    throw new Error(
      `React Native image-size locator verification failed closed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

export async function auditReactNativeDependencies({
  fetchImpl = globalThis.fetch,
} = {}) {
  const [packageJsonSource, lockSource, patchSource, whySource] =
    await Promise.all([
      readFile(resolve(reactNativeRoot, "package.json"), "utf8"),
      readFile(resolve(reactNativeRoot, "yarn.lock"), "utf8"),
      readFile(
        resolve(reactNativeRoot, imageSizePatchContract.patchPath),
        "utf8",
      ),
      yarnWhyImageSize(),
    ]);
  const patchValidation = validateImageSizePatchContract({
    packageJson: JSON.parse(packageJsonSource),
    patchSource,
    lockSource,
    whySource,
  });
  const packages = npmPackageVersionsFromYarnLock(lockSource);
  const result = await auditNpmPackageVersions(packages, {
    fetchImpl,
    advisoryAllowlist: imageSizeAdvisoryAllowlist,
  });
  return {
    ...result,
    registry: npmAdvisoryBulkUrl,
    patchedPackages: [
      {
        packageName: imageSizePatchContract.packageName,
        sourceVersion: imageSizePatchContract.sourceVersion,
        advisories: imageSizePatchContract.advisories,
        patchSha256: imageSizePatchContract.patchSha256,
        locator: patchValidation.locator,
        installedOccurrences: patchValidation.installedOccurrences,
      },
    ],
  };
}

async function main() {
  const result = await auditReactNativeDependencies();
  process.stdout.write(
    `${JSON.stringify({ status: "ok", ...result }, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
