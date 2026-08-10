import assert from "node:assert/strict";
import test from "node:test";
import {
  developmentDeploymentDispatchAction,
  evaluateDevelopmentDeploymentGate,
} from "./reference-deployment-gate.mjs";

const developmentBranch = "dev";

function evaluate(overrides) {
  return evaluateDevelopmentDeploymentGate({
    eventName: "push",
    refName: developmentBranch,
    dispatchAction: "",
    defaultBranch: developmentBranch,
    deploymentBranch: developmentBranch,
    ...overrides,
  });
}

test("a push to the declared development branch enables deployment", () => {
  assert.deepEqual(evaluate({}), {
    eligible: true,
    reason: "push-development-branch",
  });
});

test("pull requests never enable deployment", () => {
  assert.deepEqual(
    evaluate({ eventName: "pull_request", refName: "42/merge" }),
    { eligible: false, reason: "non-deployment-event" },
  );
});

test("a push to main never enables the development deployment", () => {
  assert.deepEqual(evaluate({ refName: "main" }), {
    eligible: false,
    reason: "push-outside-development-branch",
  });
});

test("only the explicit development repository dispatch is authorized", () => {
  assert.deepEqual(
    evaluate({
      eventName: "repository_dispatch",
      refName: developmentBranch,
      dispatchAction: developmentDeploymentDispatchAction,
    }),
    { eligible: true, reason: "authorized-development-dispatch" },
  );
  for (const dispatchAction of ["", "sdk-release-set-published", "unknown"]) {
    assert.deepEqual(
      evaluate({
        eventName: "repository_dispatch",
        refName: developmentBranch,
        dispatchAction,
      }),
      { eligible: false, reason: "unauthorized-development-dispatch" },
    );
  }
  assert.deepEqual(
    evaluate({
      eventName: "repository_dispatch",
      refName: developmentBranch,
      dispatchAction: developmentDeploymentDispatchAction,
      defaultBranch: "main",
    }),
    { eligible: false, reason: "unauthorized-development-dispatch" },
  );
});

test("manual and unexpected events fail closed", () => {
  for (const eventName of ["workflow_dispatch", "schedule", ""]) {
    assert.equal(evaluate({ eventName }).eligible, false);
  }
});

test("invalid manifest-derived branch metadata is rejected", () => {
  for (const invalidBranch of ["", " dev", "dev\nforged=true"]) {
    assert.throws(
      () => evaluate({ deploymentBranch: invalidBranch }),
      /deploymentBranch must be a safe, non-empty Git branch name/u,
    );
  }
});
