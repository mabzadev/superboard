import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnalyticsReconciliationReport,
  parseProjectRef,
  parseWranglerRows,
  staticAnalyticsReconciliationPlan,
} from "./analytics-reconcile.mjs";

test("project references are strict and environment-aware", () => {
  assert.deepEqual(parseProjectRef("12-prod"), {
    project_ref: "12-prod",
    instance_id: 12,
    is_test: 0,
  });
  assert.deepEqual(parseProjectRef("12-test"), {
    project_ref: "12-test",
    instance_id: 12,
    is_test: 1,
  });
  assert.throws(() => parseProjectRef("12-production"), /project-ref/u);
});

test("static plans block disabled or unprovisioned Analytics safely", () => {
  const report = staticAnalyticsReconciliationPlan({
    targetName: "vocostar",
    environment: "development",
    projectRef: "12-test",
    target: {
      features: { analytics: false },
      environments: {
        development: {
          d1: { name: "api", id: "api-id" },
          moduleD1: { analytics: { name: "analytics", id: null } },
        },
      },
    },
  });
  assert.equal(report.ready, false);
  assert.deepEqual(
    report.blockers.map(({ code }) => code),
    ["analytics_feature_disabled", "analytics_database_unprovisioned"],
  );
});

test("reconciliation requires counts, dimensions, and outbox delivery to match", () => {
  const plan = {
    schema_version: 1,
    target: "mbza-development",
    environment: "development",
    project: parseProjectRef("12-test"),
    blockers: [],
  };
  const input = {
    plan,
    projectId: 22,
    source: {
      expected_installations: 4,
      expected_purchases: 2,
      delivered_installations: 4,
      delivered_purchases: 2,
      dead_letters: 0,
      in_flight: 0,
    },
    analytics: { installations: 4, purchases: 2 },
    sourcePurchaseDimensions: [
      {
        store: "apple",
        environment: "production",
        event_type: "initial_purchase",
        currency: "chf",
        facts: 2,
        amount_micros: 19800000,
      },
    ],
    analyticsPurchaseDimensions: [
      {
        store: "apple",
        environment: "production",
        event_type: "initial_purchase",
        currency: "CHF",
        facts: 2,
        amount_micros: 19800000,
      },
    ],
  };
  assert.equal(buildAnalyticsReconciliationReport(input).ready, true);
  assert.equal(
    buildAnalyticsReconciliationReport({
      ...input,
      source: { ...input.source, dead_letters: 1 },
    }).ready,
    false,
  );
});

test("Wrangler JSON output is parsed without depending on timing metadata", () => {
  assert.deepEqual(
    parseWranglerRows(
      JSON.stringify([{ results: [{ installations: 2 }], success: true }]),
    ),
    [{ installations: 2 }],
  );
});
