import assert from "node:assert/strict";
import test from "node:test";

import {
  nonNodeSecurityAuditContract,
  nonNodeSecurityAuditPlan,
  runNonNodeSecurityAudit,
} from "./non-node-security-audit.mjs";

test("non-Node audits pin tools and target the committed dependency inputs", () => {
  const plan = nonNodeSecurityAuditPlan("/repository");
  assert.deepEqual(nonNodeSecurityAuditContract, {
    python: {
      runtimeVersion: "3.13.7",
      tool: "pip-audit",
      toolVersion: "2.10.1",
      requirements:
        "workers/custom/vocostar/orchestrators/vocals/container/requirements.txt",
    },
    ruby: {
      runtimeVersion: "3.4.9",
      bundlerVersion: "2.7.2",
      tool: "bundler-audit",
      toolVersion: "0.9.3",
      lockfile: "sdks/react-native/example/Gemfile.lock",
    },
  });
  assert.deepEqual(
    plan.versionChecks.map(({ expected }) => expected),
    ["pip-audit 2.10.1", "bundler-audit 0.9.3"],
  );
  assert.deepEqual(plan.audits[0].args, [
    "-m",
    "pip_audit",
    "--requirement",
    "/repository/workers/custom/vocostar/orchestrators/vocals/container/requirements.txt",
    "--progress-spinner",
    "off",
    "--strict",
  ]);
  assert.deepEqual(plan.audits[1].args, ["check", "--update"]);
  assert.equal(plan.audits[1].cwd, "/repository/sdks/react-native/example");
});

test("non-Node audit refuses an unpinned tool before scanning", () => {
  const calls = [];
  assert.throws(
    () =>
      runNonNodeSecurityAudit((command, args) => {
        calls.push([command, ...args]);
        return command === "python3"
          ? "pip-audit 2.10.0\n"
          : "bundler-audit 0.9.3\n";
      }),
    /expected pip-audit 2\.10\.1/u,
  );
  assert.equal(calls.length, 1);
});

test("non-Node audit runs both scans only after exact version checks", () => {
  const calls = [];
  const result = runNonNodeSecurityAudit((command, args, options = {}) => {
    calls.push({ command, args, options });
    if (!options.capture) return "";
    return command === "python3"
      ? "pip-audit 2.10.1\n"
      : "bundler-audit 0.9.3\n";
  });
  assert.equal(calls.length, 4);
  assert.equal(calls.filter(({ options }) => options.capture).length, 2);
  assert.deepEqual(result, {
    status: "ok",
    audits: 2,
    tools: { python: "2.10.1", ruby: "0.9.3" },
  });
});
