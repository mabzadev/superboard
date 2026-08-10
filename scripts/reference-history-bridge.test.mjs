import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedHistoryBridgeNames,
  validateHistoryBridgeEvidence,
} from "./reference-history-bridge.mjs";

const baseSha = "a".repeat(40);
const developmentSha = "b".repeat(40);
const headSha = "c".repeat(40);
const treeSha = "d".repeat(40);
const { auditBranch, bridgeBranch } = expectedHistoryBridgeNames({
  baseRef: "main",
  defaultBranch: "dev",
  baseSha,
  developmentSha,
});

const validEvidence = {
  eventName: "pull_request",
  repository: "mbzadev/opengrow-reference",
  headRepository: "mbzadev/opengrow-reference",
  baseRef: "main",
  headRef: bridgeBranch,
  baseSha,
  headSha,
  defaultBranch: "dev",
  remoteBaseSha: baseSha,
  remoteHeadSha: headSha,
  remoteDevelopmentSha: developmentSha,
  remoteAuditSha: baseSha,
  parents: [developmentSha, baseSha],
  headTree: treeSha,
  developmentTree: treeSha,
  mergeBase: baseSha,
};

test("an exact same-repository bridge of official dev is accepted", () => {
  assert.deepEqual(validateHistoryBridgeEvidence(validEvidence), {
    validated: true,
    auditBranch,
    bridgeBranch,
    baseSha,
    headSha,
    developmentSha,
    developmentBranch: "dev",
  });
});

test("bridge and audit names are derived only from reviewed remote evidence", () => {
  assert.equal(
    bridgeBranch,
    `history/bridge-main-dev-${baseSha.slice(0, 12)}-${developmentSha.slice(0, 12)}`,
  );
  assert.equal(
    auditBranch,
    `audit/pre-opengrow-main-${baseSha.slice(0, 12)}`,
  );
});

test("non-PR and cross-repository bridge attempts fail closed", () => {
  assert.throws(
    () =>
      validateHistoryBridgeEvidence({
        ...validEvidence,
        eventName: "push",
      }),
    /reserved for pull requests/u,
  );
  assert.throws(
    () =>
      validateHistoryBridgeEvidence({
        ...validEvidence,
        headRepository: "attacker/opengrow-reference",
      }),
    /originate in this repository/u,
  );
});

test("a forged or unsafe bridge branch name fails closed", () => {
  for (const headRef of [
    `history/bridge-main-dev-${baseSha.slice(0, 12)}-forged`,
    "history/bridge-main-dev/../forged",
    "history/bridge-main-dev/.hidden",
    "history/bridge-main-dev/locked.lock/forged",
    "-history/bridge-main-dev",
  ]) {
    assert.throws(
      () => validateHistoryBridgeEvidence({ ...validEvidence, headRef }),
      /must be (?:exactly|a safe Git branch name)/u,
    );
  }
});

test("remote drift of base, head, dev or audit fails closed", () => {
  const driftSha = "e".repeat(40);
  for (const [field, message] of [
    ["remoteBaseSha", /base advanced/u],
    ["remoteHeadSha", /bridge branch advanced/u],
    ["remoteDevelopmentSha", /parents must be/u],
    ["remoteAuditSha", /audit branch/u],
  ]) {
    assert.throws(
      () =>
        validateHistoryBridgeEvidence({
          ...validEvidence,
          [field]: driftSha,
        }),
      message,
    );
  }
});

test("parent cardinality and order are exact", () => {
  for (const parents of [
    [developmentSha],
    [baseSha, developmentSha],
    [developmentSha, baseSha, headSha],
  ]) {
    assert.throws(
      () => validateHistoryBridgeEvidence({ ...validEvidence, parents }),
      /exactly two parents|parents must be/u,
    );
  }
});

test("tree changes and a non-base merge base are rejected", () => {
  assert.throws(
    () =>
      validateHistoryBridgeEvidence({
        ...validEvidence,
        headTree: "e".repeat(40),
      }),
    /tree must equal/u,
  );
  assert.throws(
    () =>
      validateHistoryBridgeEvidence({
        ...validEvidence,
        mergeBase: developmentSha,
      }),
    /exact merge base/u,
  );
});

test("invalid SHAs and indistinct source commits are rejected", () => {
  assert.throws(
    () => validateHistoryBridgeEvidence({ ...validEvidence, headSha: "short" }),
    /40-character commit SHA/u,
  );
  assert.throws(
    () =>
      validateHistoryBridgeEvidence({
        ...validEvidence,
        headSha: developmentSha,
        remoteHeadSha: developmentSha,
      }),
    /distinct two-parent commit/u,
  );
});
