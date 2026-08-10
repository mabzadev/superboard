import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(new URL("../..", import.meta.url).pathname);
const planner = resolve(root, ".github", "scripts", "ci-change-plan.sh");

test("API changes validate API and the isolated Billing Worker", () => {
  const plan = runPlan(["workers/api/src/index.ts"]);
  assert.equal(plan.api, "true");
  assert.equal(plan.billing, "true");
  assert.equal(plan.workers, "true");
  assert.equal(plan.dashboard, "false");
});

test("Flutter core changes validate Flutter and FlutterFlow only", () => {
  const plan = runPlan(["sdks/flutter/lib/opengrow_purchases.dart"]);
  assert.equal(plan.flutter, "true");
  assert.equal(plan.flutterflow, "true");
  assert.equal(plan.flutter_packages, "true");
  assert.equal(plan.workers, "false");
});

test("Messaging changes select only the affected Worker", () => {
  const plan = runPlan(["workers/messaging/src/index.ts"]);
  assert.equal(plan.messaging, "true");
  assert.equal(plan.workers, "true");
  assert.equal(plan.api, "false");
});

test("MCP runtime and plugin changes select the MCP Worker checks", () => {
  for (const path of ["workers/mcp/src/index.ts", "apps/mcp/src/server.ts"]) {
    const plan = runPlan([path]);
    assert.equal(plan.mcp, "true", path);
    assert.equal(plan.workers, "true", path);
    assert.equal(plan.api, "false", path);
  }
});

test("documentation changes keep heavy jobs disabled", () => {
  const plan = runPlan(["docs/DEPLOYMENT.md"]);
  assert.equal(plan.workers, "false");
  assert.equal(plan.dashboard, "false");
  assert.equal(plan.flutter_packages, "false");
  assert.equal(plan.node_sdks, "false");
  assert.equal(plan.native_sdks, "false");
});

test("each standalone SDK selects its maintained validation job", () => {
  const cases = [
    ["sdks/ios/Sources/OpenGrow/OpenGrow.swift", "ios", "native_sdks"],
    ["sdks/android/OpenGrow/OpenGrow/build.gradle.kts", "android", "native_sdks"],
    ["sdks/javascript/src/opengrow.js", "javascript", "node_sdks"],
    ["sdks/react-native/src/index.tsx", "react_native", "node_sdks"],
  ];
  for (const [path, flag, aggregate] of cases) {
    const plan = runPlan([path]);
    assert.equal(plan[flag], "true", path);
    assert.equal(plan[aggregate], "true", path);
    assert.equal(plan.workers, "false", path);
    assert.equal(plan.dashboard, "false", path);
  }
});

test("an unclassified production path fails safe with the supported matrix", () => {
  const plan = runPlan(["new-service/config.json"]);
  assert.equal(plan.workers, "true");
  assert.equal(plan.dashboard, "true");
  assert.equal(plan.flutter_packages, "true");
  assert.equal(plan.node_sdks, "true");
  assert.equal(plan.native_sdks, "true");
});

test("manual dispatch selects the complete supported matrix", () => {
  const plan = runPlan([], true);
  assert.equal(plan.api, "true");
  assert.equal(plan.billing, "true");
  assert.equal(plan.messaging, "true");
  assert.equal(plan.dashboard, "true");
  assert.equal(plan.flutter_packages, "true");
});

function runPlan(paths, fullValidation = false) {
  const directory = mkdtempSync(resolve(tmpdir(), "opengrow-ci-plan-"));
  try {
    const changed = resolve(directory, "changed.txt");
    const output = resolve(directory, "output.txt");
    writeFileSync(changed, `${paths.join("\n")}${paths.length ? "\n" : ""}`);
    writeFileSync(output, "");
    const result = spawnSync("bash", [planner], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        CHANGED_FILES_FILE: changed,
        FULL_VALIDATION: fullValidation ? "true" : "false",
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("=", 2)),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
