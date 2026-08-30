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
    displayName: "SuperBoard",
    dependencies: 1,
    libraryValues: 11,
    widgets: 9,
    pages: 3,
    actions: 88,
    errors: [],
  });
});

test("the FlutterFlow catalog publishes only the 18 canonical and 12 extended Support actions", async () => {
  const [library, surface, integrationTest] = await Promise.all([
    readFile(join(root, "config/flutterflow-library.json"), "utf8").then(JSON.parse),
    readFile(join(root, "config/flutterflow-custom-code.json"), "utf8").then(JSON.parse),
    readFile(
      join(root, "sdks/flutterflow/test/support/actions_test.dart"),
      "utf8",
    ),
  ]);
  const actions = library.actions.support;
  assert.equal(actions.length, 30);
  assert.equal(new Set(actions).size, 30);
  assert.ok(actions.every((name) => /^superboardSupport[A-Z]/u.test(name)));
  assert.deepEqual(
    [...surface.actions.support].sort(),
    [...actions].sort(),
  );
  assert.ok(
    surface.actions.compatibilityAliases.every(
      (name) => !actions.includes(name),
    ),
  );
  for (const name of actions) {
    assert.match(
      integrationTest,
      new RegExp(`\\b${name}\\s*\\(`, "u"),
      `${name} must be called by the FlutterFlow Support integration test`,
    );
  }
});

test("mutable or SSH dependencies are rejected", async () => {
  const source = await readFile(
    join(root, "tools/flutterflow-library/dsl/edit.dart"),
    "utf8",
  );
  const result = await validateFlutterFlowLibraryContract({
    sourceOverride: source
      .replace(
        "https://github.com/mabzadev/superboard.git",
        "git@github.com:mabzadev/superboard.git",
      )
      .replace("ref: sdk-flutterflow-v3.0.0", "ref: main"),
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.errors.some((error) => error.includes("public HTTPS")));
  assert.ok(result.errors.some((error) => error.includes("immutable")));
});
