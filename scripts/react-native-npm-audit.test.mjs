import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  auditNpmPackageVersions,
  imageSizeInstalledLocatorsFromYarnWhy,
  imageSizePatchContract,
  imageSizePatchDescriptor,
  imageSizePatchLocator,
  npmAdvisoryBulkUrl,
  npmPackageVersionsFromYarnLock,
  validateImageSizePatchContract,
} from "./react-native-npm-audit.mjs";

const root = resolve(import.meta.dirname, "..");
const reactNativeRoot = resolve(root, "sdks/react-native");
const yarnPath = resolve(reactNativeRoot, ".yarn/releases/yarn-3.6.1.cjs");

function advisory(ghsaId, id) {
  return {
    id,
    url: `https://github.com/advisories/${ghsaId}`,
    title: `fixture ${ghsaId}`,
    severity: "high",
    vulnerable_versions: "<=2.0.2",
  };
}

function imageSizeAllowlist() {
  return imageSizePatchContract.advisories.map((ghsaId) => ({
    packageName: imageSizePatchContract.packageName,
    url: `https://github.com/advisories/${ghsaId}`,
  }));
}

function reviewedImageSizeAdvisories() {
  return imageSizePatchContract.advisories.map((ghsaId, index) =>
    advisory(ghsaId, 1_138_808 + index),
  );
}

async function currentPatchInputs() {
  const [packageJsonSource, lockSource, patchSource] = await Promise.all([
    readFile(resolve(reactNativeRoot, "package.json"), "utf8"),
    readFile(resolve(reactNativeRoot, "yarn.lock"), "utf8"),
    readFile(
      resolve(reactNativeRoot, imageSizePatchContract.patchPath),
      "utf8",
    ),
  ]);
  const whySource = execFileSync(
    process.execPath,
    [yarnPath, "why", imageSizePatchContract.packageName, "--json"],
    { cwd: reactNativeRoot, encoding: "utf8" },
  );
  return {
    packageJson: JSON.parse(packageJsonSource),
    lockSource,
    patchSource,
    whySource,
  };
}

function runImageSizeFixture(source) {
  return spawnSync(process.execPath, ["-e", source], {
    cwd: reactNativeRoot,
    encoding: "utf8",
    timeout: 2_000,
  });
}

function assertFixtureFinishes(source) {
  const child = runImageSizeFixture(source);
  assert.equal(child.error?.code, undefined);
  assert.equal(child.status, 0, child.stderr);
}

test("React Native graph binds every image-size occurrence to the reviewed patch", async () => {
  const inputs = await currentPatchInputs();
  const validation = validateImageSizePatchContract(inputs);
  const packages = npmPackageVersionsFromYarnLock(inputs.lockSource);

  assert.equal(validation.locator, imageSizePatchLocator);
  assert.equal(validation.installedOccurrences, 2);
  assert.deepEqual(imageSizeInstalledLocatorsFromYarnWhy(inputs.whySource), [
    imageSizePatchLocator,
    imageSizePatchLocator,
  ]);
  assert.deepEqual(packages["image-size"], ["1.2.1"]);
  assert.deepEqual(packages["@octokit/plugin-paginate-rest"], ["11.4.1"]);
  assert.deepEqual(packages.ajv, ["6.14.0", "8.18.0"]);
  assert.deepEqual(packages.diff, ["4.0.4"]);
  assert.deepEqual(packages.joi, ["17.13.4"]);
  assert.deepEqual(packages.undici, ["6.28.0"]);
  assert.deepEqual(packages.yaml, ["2.8.3"]);

  assert.throws(
    () =>
      validateImageSizePatchContract({
        ...inputs,
        patchSource: `${inputs.patchSource}\n# tampered`,
      }),
    /checksum does not match/u,
  );
});

test("image-size lock proof rejects a comment-only marker and extra locator", async () => {
  const inputs = await currentPatchInputs();
  const commentOnlyLock = inputs.lockSource
    .replace(
      `"${imageSizePatchDescriptor}":`,
      `# "${imageSizePatchDescriptor}":`,
    )
    .replace(
      `  resolution: "${imageSizePatchLocator}"`,
      `#   resolution: "${imageSizePatchLocator}"`,
    );

  assert.throws(
    () =>
      validateImageSizePatchContract({
        ...inputs,
        lockSource: commentOnlyLock,
      }),
    /unexpected image-size descriptor or locator/u,
  );

  const extraLocatorLock = `${inputs.lockSource}\n"image-size@npm:^1.2.1":\n  version: 1.2.1\n  resolution: "image-size@npm:1.2.1"\n`;
  assert.throws(
    () =>
      validateImageSizePatchContract({
        ...inputs,
        lockSource: extraLocatorLock,
      }),
    /unexpected image-size descriptor or locator/u,
  );
});

test("image-size locator proof rejects a second unpatched installed occurrence", async () => {
  const inputs = await currentPatchInputs();
  const unpatchedLocator = "image-size@npm:1.2.1";
  const unpatchedOccurrence = JSON.stringify({
    value: "future-consumer@npm:1.0.0",
    children: {
      [unpatchedLocator]: {
        locator: unpatchedLocator,
        descriptor: "image-size@npm:1.2.1",
      },
    },
  });

  assert.throws(
    () =>
      validateImageSizePatchContract({
        ...inputs,
        whySource: `${inputs.whySource}${unpatchedOccurrence}\n`,
      }),
    /installed an unreviewed image-size locator/u,
  );
});

test("npm bulk audit includes image-size and allows only both reviewed GHSA entries", async () => {
  const packages = { "image-size": ["1.2.1"], lodash: ["4.18.1"] };
  let request;
  const result = await auditNpmPackageVersions(packages, {
    advisoryAllowlist: imageSizeAllowlist(),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          "image-size": reviewedImageSizeAdvisories(),
        }),
      };
    },
  });

  assert.equal(request.url, npmAdvisoryBulkUrl);
  assert.equal(request.url.includes("npm.pkg.github.com"), false);
  assert.deepEqual(JSON.parse(request.options.body), packages);
  assert.deepEqual(result, {
    advisories: 0,
    allowedPatchedAdvisories: 2,
    auditedPackages: 2,
  });
});

test("npm bulk audit rejects a third image-size advisory and omitted reviewed GHSA", async () => {
  const packages = { "image-size": ["1.2.1"] };
  const thirdAdvisory = advisory("GHSA-new1-new2-new3", 1_200_000);

  await assert.rejects(
    auditNpmPackageVersions(packages, {
      advisoryAllowlist: imageSizeAllowlist(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          "image-size": [...reviewedImageSizeAdvisories(), thirdAdvisory],
        }),
      }),
    }),
    /found 1 unexpected advisory.*GHSA-new1-new2-new3/u,
  );

  await assert.rejects(
    auditNpmPackageVersions(packages, {
      advisoryAllowlist: imageSizeAllowlist(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          "image-size": reviewedImageSizeAdvisories().slice(0, 1),
        }),
      }),
    }),
    /registry omitted a reviewed patched advisory/u,
  );
});

test("npm bulk audit fails closed on unavailable, invalid or foreign responses", async () => {
  await assert.rejects(
    auditNpmPackageVersions(
      { package: ["1.0.0"] },
      { fetchImpl: async () => ({ ok: false, status: 503 }) },
    ),
    /failed closed.*HTTP 503/u,
  );
  await assert.rejects(
    auditNpmPackageVersions(
      { package: ["1.0.0"] },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ package: [{ id: "invalid" }] }),
        }),
      },
    ),
    /violates the bulk advisory contract/u,
  );
  await assert.rejects(
    auditNpmPackageVersions(
      { package: ["1.0.0"] },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ foreign: [] }),
        }),
      },
    ),
    /registry returned an unrequested package/u,
  );
});

test("patched image-size rejects zero-length first and later ICNS entries", () => {
  assertFixtureFinishes(
    [
      'const { imageSize } = require("image-size");',
      "const input = Buffer.alloc(16);",
      'input.write("icns", 0, "ascii");',
      "input.writeUInt32BE(16, 4);",
      'input.write("ic07", 8, "ascii");',
      "input.writeUInt32BE(0, 12);",
      "try { imageSize(input); process.exit(2); }",
      "catch (error) { if (!/Invalid ICNS entry length/.test(String(error))) process.exit(3); }",
    ].join(" "),
  );

  assertFixtureFinishes(
    [
      'const { imageSize } = require("image-size");',
      "const input = Buffer.alloc(24);",
      'input.write("icns", 0, "ascii");',
      "input.writeUInt32BE(24, 4);",
      'input.write("ic07", 8, "ascii");',
      "input.writeUInt32BE(8, 12);",
      'input.write("ic08", 16, "ascii");',
      "input.writeUInt32BE(0, 20);",
      "try { imageSize(input); process.exit(2); }",
      "catch (error) { if (!/Invalid ICNS entry length/.test(String(error))) process.exit(3); }",
    ].join(" "),
  );
});

test("patched image-size terminates on zero-sized JXL and HEIF boxes", () => {
  assertFixtureFinishes(
    [
      'const { imageSize } = require("image-size");',
      "const input = Buffer.alloc(32);",
      "input.writeUInt32BE(12, 0);",
      'input.write("JXL ", 4, "ascii");',
      "input.writeUInt32BE(12, 12);",
      'input.write("ftyp", 16, "ascii");',
      'input.write("jxl ", 20, "ascii");',
      "input.writeUInt32BE(0, 24);",
      'input.write("jxlp", 28, "ascii");',
      "try { imageSize(input); } catch {}",
    ].join(" "),
  );

  assertFixtureFinishes(
    [
      'const { imageSize } = require("image-size");',
      "const input = Buffer.alloc(20);",
      "input.writeUInt32BE(12, 0);",
      'input.write("ftyp", 4, "ascii");',
      'input.write("avif", 8, "ascii");',
      "input.writeUInt32BE(0, 12);",
      'input.write("meta", 16, "ascii");',
      "try { imageSize(input); } catch {}",
    ].join(" "),
  );
});

function parseNpmPackOutput(output) {
  const normalized = String(output).trim();
  const jsonStart = normalized.lastIndexOf("\n[");
  const payload =
    jsonStart === -1 ? normalized : normalized.slice(jsonStart + 1);
  const parsed = JSON.parse(payload);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
  assert.equal(Array.isArray(parsed[0]?.files), true);
  return parsed[0].files;
}

test("npm pack JSON remains strict after package build output", () => {
  const files = parseNpmPackOutput(
    'ℹ Building target codegen\n[{"files":[{"path":"package.json"}]}]\n',
  );
  assert.deepEqual(files, [{ path: "package.json" }]);
  assert.throws(() => parseNpmPackOutput("ℹ build only"), SyntaxError);
});

test("published React Native SDK omits the local Yarn security patch", () => {
  const packed = spawnSync(
    "npm",
    ["pack", "--dry-run", "--ignore-scripts", "--json"],
    {
      cwd: reactNativeRoot,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(packed.error?.code, undefined);
  assert.equal(packed.status, 0, packed.stderr);
  const files = parseNpmPackOutput(packed.stdout).map(({ path }) => path);
  assert.deepEqual(
    files.filter(
      (path) =>
        path.includes(".yarn") ||
        path.includes("image-size") ||
        path.includes("patch") ||
        path === "yarn.lock",
    ),
    [],
  );
});
