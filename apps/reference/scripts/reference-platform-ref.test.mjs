import assert from "node:assert/strict";
import test from "node:test";
import { selectOfficialPlatformRef } from "./reference-platform-ref.mjs";

const deploymentBranch = "dev";
const productionBranch = "main";
const dispatchPlatformSha = "a".repeat(40);

function select(overrides = {}) {
  return selectOfficialPlatformRef({
    eventName: "pull_request",
    refName: "14/merge",
    baseRef: "main",
    dispatchPlatformSha: "",
    deploymentBranch,
    productionBranch,
    historyBridgeValidated: "",
    ...overrides,
  });
}

test("an exact validated bridge selects official Platform development", () => {
  assert.deepEqual(select({ historyBridgeValidated: "true" }), {
    ref: deploymentBranch,
    source: "validated-history-bridge-development",
  });
});

test("ordinary production and development PRs keep their exact base", () => {
  assert.deepEqual(select({ baseRef: "main" }), {
    ref: "main",
    source: "pull-request-production",
  });
  assert.deepEqual(select({ baseRef: deploymentBranch }), {
    ref: deploymentBranch,
    source: "pull-request-development",
  });
  assert.deepEqual(select({ baseRef: "release-candidate" }), {
    ref: deploymentBranch,
    source: "pull-request-development",
  });
});

test("pushes and manual validation use their exact workflow ref", () => {
  for (const eventName of ["push", "workflow_dispatch"]) {
    assert.deepEqual(select({ eventName, refName: "main" }), {
      ref: "main",
      source: "workflow-production",
    });
    assert.deepEqual(select({ eventName, refName: deploymentBranch }), {
      ref: deploymentBranch,
      source: "workflow-development",
    });
  }
  assert.deepEqual(
    select({
      eventName: "workflow_dispatch",
      refName: "automation/sdk-set-deadbeef",
    }),
    { ref: deploymentBranch, source: "workflow-development" },
  );
});

test("repository dispatch requires and preserves an exact Platform SHA", () => {
  assert.deepEqual(
    select({ eventName: "repository_dispatch", dispatchPlatformSha }),
    { ref: dispatchPlatformSha, source: "dispatch-exact-sha" },
  );
  assert.throws(
    () => select({ eventName: "repository_dispatch" }),
    /40-character commit SHA/u,
  );
});

test("bridge authorization cannot leak into another event", () => {
  for (const eventName of ["push", "workflow_dispatch", "repository_dispatch"]) {
    assert.throws(
      () => select({ eventName, historyBridgeValidated: "true" }),
      /must be a pull request/u,
    );
  }
});

test("forged bridge states and unsafe refs fail closed", () => {
  for (const historyBridgeValidated of ["TRUE", " true", "1", "yes"]) {
    assert.throws(
      () => select({ historyBridgeValidated }),
      /must be (?:exactly|an exact string)/u,
    );
  }
  for (const baseRef of ["", "../main", " main", "main.lock"]) {
    assert.throws(
      () => select({ baseRef }),
      /safe Git branch name|exact, non-empty/u,
    );
  }
});

test("unknown events fail closed", () => {
  for (const eventName of ["", "schedule", "pull_request_target"]) {
    assert.throws(
      () => select({ eventName }),
      /exact string|Unsupported GitHub event/u,
    );
  }
});

test("production and development branch metadata must be distinct and safe", () => {
  assert.throws(
    () => select({ productionBranch: deploymentBranch }),
    /must differ/u,
  );
  assert.throws(
    () => select({ productionBranch: "../main" }),
    /safe Git branch name/u,
  );
});
