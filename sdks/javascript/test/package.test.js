import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const forbiddenSupportPublication = [
  /\b(?:openchat|chatwoot)\b/iu,
  /\baction[ _-]?cable\b/iu,
  /\bactive[ _-]?storage\b/iu,
  /\/api\/v1\/accounts(?:\/|\b)/iu,
  /\/rails(?:\/|\b)/iu,
  /\/twilio(?:\/|\b)/iu,
];

test("the published package keeps its public name and explicit dual-module exports", () => {
  assert.equal(packageJson.name, "@mbzadev/opengrow-js-sdk");
  assert.deepEqual(packageJson.exports, {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/opengrow.js",
      require: "./dist/opengrow.umd.cjs",
      default: "./dist/opengrow.js",
    },
    "./support": {
      types: "./dist/support.d.ts",
      import: "./dist/support.js",
      require: "./dist/support.umd.cjs",
      default: "./dist/support.js",
    },
  });
  assert.deepEqual(packageJson.files, ["dist"]);
  assert.equal(packageJson.dependencies, undefined);
});

test("the first-party check audits production and development dependencies", () => {
  assert.equal(
    packageJson.scripts["audit:production"],
    "npm audit --omit=dev --workspaces=false --audit-level=low",
  );
  assert.equal(
    packageJson.scripts["audit:development"],
    "npm audit --include=dev --workspaces=false --audit-level=low",
  );
  assert.equal(
    packageJson.scripts.audit,
    "npm run audit:production && npm run audit:development",
  );
  assert.match(packageJson.scripts.check, /^npm run audit && /u);
});

test("the built package loads through both ESM import and CommonJS require", async () => {
  const esm = await import(packageJson.name);
  const require = createRequire(import.meta.url);
  const commonJs = require(packageJson.name);

  assert.equal(typeof esm.default, "function");
  assert.equal(typeof commonJs, "function");
  assert.equal(typeof esm.default.prototype.start, "function");
  assert.equal(typeof commonJs.prototype.start, "function");
  assert.equal(typeof esm.SuperBoardSupportClient, "function");
  assert.equal(typeof esm.SuperBoardSupportException, "function");
  assert.equal(typeof esm.SuperBoardSupportWidget, "function");
  assert.equal(typeof commonJs.SuperBoardSupportClient, "function");
  assert.equal(typeof commonJs.SuperBoardSupportException, "function");
  assert.equal(typeof commonJs.SuperBoardSupportWidget, "function");
});

test("the Support subpath loads through both ESM import and CommonJS require", async () => {
  const esm = await import(`${packageJson.name}/support`);
  const require = createRequire(import.meta.url);
  const commonJs = require(`${packageJson.name}/support`);

  for (const name of [
    "SuperBoardSupportClient",
    "SuperBoardSupportException",
    "SuperBoardSupportRealtime",
    "SuperBoardSupportWidget",
  ]) {
    assert.equal(typeof esm[name], "function");
    assert.equal(typeof commonJs[name], "function");
  }
});

test("published Support bundles, declarations, and examples contain no inherited surface", async () => {
  const publications = await Promise.all(
    [
      "../dist/support.js",
      "../dist/support.umd.cjs",
      "../dist/support.d.ts",
      "../README.md",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  for (const source of publications) {
    for (const pattern of forbiddenSupportPublication) {
      assert.doesNotMatch(source, pattern);
    }
  }
});
