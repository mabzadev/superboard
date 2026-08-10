import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateFlutterFlowLibraryContract } from "./flutterflow-library-contract.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("the Git-owned FlutterFlow library contract is complete", async () => {
  const result = await validateFlutterFlowLibraryContract();
  assert.deepEqual(result, {
    schemaVersion: 1,
    status: "ok",
    displayName: "OpenGrow",
    dependencies: 2,
    libraryValues: 11,
    widgets: 5,
    pages: 3,
    actions: 64,
    errors: [],
  });
});

test("mutable or SSH dependencies are rejected", async () => {
  const source = await readFile(
    join(root, "tools/flutterflow-library/dsl/edit.dart"),
    "utf8",
  );
  const result = await validateFlutterFlowLibraryContract({
    sourceOverride: source
      .replace(
        "https://github.com/mbzadev/opengrow-platform.git",
        "git@github.com:mbzadev/opengrow-platform.git",
      )
      .replace("ref: sdk-flutterflow-v2.2.4", "ref: main"),
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.errors.some((error) => error.includes("public HTTPS")));
  assert.ok(result.errors.some((error) => error.includes("immutable")));
});
