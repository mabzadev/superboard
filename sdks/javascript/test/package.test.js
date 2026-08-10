import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("the published package keeps its public name and explicit dual-module exports", () => {
  assert.equal(packageJson.name, "@mbzadev/opengrow-js-sdk");
  assert.deepEqual(packageJson.exports, {
    ".": {
      import: "./dist/opengrow.js",
      require: "./dist/opengrow.umd.cjs",
      default: "./dist/opengrow.js",
    },
  });
  assert.deepEqual(packageJson.files, ["dist"]);
});

test("the built package loads through both ESM import and CommonJS require", async () => {
  const esm = await import(packageJson.name);
  const require = createRequire(import.meta.url);
  const commonJs = require(packageJson.name);

  assert.equal(typeof esm.default, "function");
  assert.equal(typeof commonJs, "function");
  assert.equal(typeof esm.default.prototype.start, "function");
  assert.equal(typeof commonJs.prototype.start, "function");
});
