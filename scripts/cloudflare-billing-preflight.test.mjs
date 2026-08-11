import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateBillingPreflight,
  parseD1Metrics,
  parseD1MigrationNames,
  parseSecretNames,
  validPublicEs256Jwks,
} from "./cloudflare-billing-preflight.mjs";

const publicKey = {
  kid: "signing-key-1",
  kty: "EC",
  crv: "P-256",
  alg: "ES256",
  use: "sig",
  x: "public-x",
  y: "public-y",
};

test("passes only when queue ownership, readiness, keys, and secrets agree", () => {
  const report = evaluateBillingPreflight(readyInput());
  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
});

test("blocks cutover when the API still owns Billing or the DLQ is unconsumed", () => {
  const report = evaluateBillingPreflight({
    ...readyInput(),
    mainConsumer: "opengrow-api",
    dlqConsumer: null,
  });
  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.key), [
    "main_queue_consumer",
    "dead_letter_queue_consumer",
  ]);
});

test("blocks cutover when a required D1 migration is pending", () => {
  const report = evaluateBillingPreflight({
    ...readyInput(),
    requiredMigrations: ["0044_dead_letters.sql", "0045_delivery_leases.sql"],
    appliedMigrations: ["0044_dead_letters.sql"],
  });
  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers, [{
    key: "database_migrations",
    detail: "Apply pending D1 migrations: 0045_delivery_leases.sql.",
  }]);
});

test("blocks cutover when an operational Billing counter is non-zero", () => {
  const input = readyInput();
  input.operationalCounts.provider_events_stale = 2;
  const report = evaluateBillingPreflight(input);
  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers, [{
    key: "billing_operational_state",
    detail: "Resolve non-zero Billing counters: provider_events_stale=2.",
  }]);
});

test("rejects a private or non-ES256 JWKS", () => {
  assert.equal(validPublicEs256Jwks({ keys: [publicKey] }), true);
  assert.equal(validPublicEs256Jwks({ keys: [{ ...publicKey, d: "private" }] }), false);
  assert.equal(validPublicEs256Jwks({ keys: [{ ...publicKey, alg: "HS256" }] }), false);
});

test("parses only secret names from Wrangler JSON output", () => {
  assert.deepEqual(parseSecretNames('[{"name":"FIRST","type":"secret_text"},{"name":"SECOND"}]'), [
    "FIRST",
    "SECOND",
  ]);
});

test("parses applied migration names from Wrangler D1 output", () => {
  assert.deepEqual(parseD1MigrationNames('[{"results":[{"name":"0044.sql"},{"name":"0045.sql"}],"success":true}]'), [
    "0044.sql",
    "0045.sql",
  ]);
});

test("parses named operational counters from multiple D1 result batches", () => {
  assert.deepEqual(parseD1Metrics('[{"results":[{"metric":"failed","value":0}]},{"results":[{"metric":"stale","value":2}]}]'), {
    failed: 0,
    stale: 2,
  });
});

function readyInput() {
  return {
    executionMode: "service",
    expectedMainConsumer: "opengrow-billing",
    expectedDlqConsumer: "opengrow-billing",
    mainConsumer: "opengrow-billing",
    dlqConsumer: "opengrow-billing",
    requiredMigrations: ["0044_dead_letters.sql"],
    appliedMigrations: ["0044_dead_letters.sql"],
    operationalCounts: Object.fromEntries([
      "billing_events_failed",
      "billing_events_stale",
      "provider_events_failed",
      "provider_events_stale",
      "subscription_verification_failed",
      "subscription_verification_stale",
      "entitlement_deliveries_failed",
      "entitlement_deliveries_stale",
      "refund_actions_failed",
      "refund_actions_stale",
      "refund_deadlines_missed",
      "dead_letters_quarantined",
    ].map((name) => [name, 0])),
    health: {
      ready_for_traffic: true,
      execution: "private-service-binding",
      credential_copies_ready: true,
      credential_decryption_ready: true,
      signing_authority_ready: true,
      missing_secrets: [],
      routing_mode: "service",
    },
    purchasesJwks: { keys: [publicKey] },
    authJwks: { keys: [publicKey] },
    billingSecretNames: [
      "APPLE_ROOT_CERTIFICATES_B64",
      "OPENGROW_ENTITLEMENT_WEBHOOK_SECRET",
      "PURCHASES_SIGNING_KEYSET",
      "STORE_CREDENTIALS_ENCRYPTION_KEYS",
    ],
  };
}
