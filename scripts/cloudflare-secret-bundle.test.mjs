import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSecretAssignments,
  buildSecretBundlePlan,
  buildSecretUploadReceipt,
  secretBundleConfirmation,
  secretVersionTag,
  versionedSecretBundleArgs,
} from "./cloudflare-secret-bundle.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

test("secret bundle plan expands shared members without values", async () => {
  const { target } = await loadTarget("vocostar");
  const plan = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["email-internal-token", "files-internal-token"],
  });
  assert.equal(plan.valuesIncluded, false);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.confirmation, secretBundleConfirmation(plan));
  assert.deepEqual(
    plan.contracts[0].members.map(({ service, name }) => ({ service, name })),
    [
      { service: "api", name: "EMAIL_INTERNAL_TOKEN" },
      { service: "email", name: "EMAIL_INTERNAL_TOKEN" },
      { service: "identity", name: "EMAIL_INTERNAL_TOKEN" },
    ],
  );
});

test("shared contract input assigns the exact same value to every Worker", async () => {
  const { target } = await loadTarget("vocostar");
  const plan = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["email-internal-token"],
  });
  const assignments = buildSecretAssignments(plan, {
    contracts: {
      "email-internal-token": { value: "coordinated-test-value" },
    },
  });
  assert.deepEqual(assignments, {
    api: { EMAIL_INTERNAL_TOKEN: "coordinated-test-value" },
    email: { EMAIL_INTERNAL_TOKEN: "coordinated-test-value" },
    identity: { EMAIL_INTERNAL_TOKEN: "coordinated-test-value" },
  });
});

test("keyring alternatives require one allowed binding for all members", async () => {
  const { target } = await loadTarget("vocostar");
  const plan = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["billing-credential-keyring"],
  });
  const assignments = buildSecretAssignments(plan, {
    contracts: {
      "billing-credential-keyring": {
        name: "STORE_CREDENTIALS_ENCRYPTION_KEYS",
        value: "{\"v2\":\"key-material\"}",
      },
    },
  });
  assert.deepEqual(Object.keys(assignments), ["api", "billing"]);
  assert.equal(
    assignments.api.STORE_CREDENTIALS_ENCRYPTION_KEYS,
    assignments.billing.STORE_CREDENTIALS_ENCRYPTION_KEYS,
  );
  assert.throws(
    () => buildSecretAssignments(plan, {
      contracts: {
        "billing-credential-keyring": {
          name: "UNDECLARED_KEY",
          value: "test-value",
        },
      },
    }),
    /allowed binding/u,
  );
});

test("OAuth and external-peer contracts fail closed", async () => {
  const { target } = await loadTarget("vocostar");
  const oauth = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["dashboard-client-secret"],
  });
  assert.equal(oauth.blockers[0].id, "dashboard-oauth-pairing");

  const webhook = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["entitlement-webhook-secret"],
  });
  assert.equal(webhook.blockers[0].id, "entitlement-webhook-secret.external-peers");
  const confirmed = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["entitlement-webhook-secret"],
    externalPeersReady: true,
  });
  assert.equal(confirmed.blockers.length, 0);
  assert.notEqual(confirmed.confirmation, webhook.confirmation);
});

test("bundle input is exact and Wrangler upload creates inactive versions", async () => {
  const { target } = await loadTarget("vocostar");
  const plan = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["api-push-process-key"],
  });
  assert.throws(
    () => buildSecretAssignments(plan, {
      contracts: {
        "api-push-process-key": { value: "test-value" },
        extra: { value: "test-value" },
      },
    }),
    /exactly the planned contracts/u,
  );
  const tag = secretVersionTag(plan, "api");
  assert.match(tag, /^opengrow-secret-[a-f0-9]{12}-api$/u);
  assert.deepEqual(
    versionedSecretBundleArgs(
      "/tmp/api.jsonc",
      "vocostar",
      "production",
      "api",
      tag,
    ),
    [
      "wrangler", "versions", "secret", "bulk",
      "--config", "/tmp/api.jsonc",
      "--message", "OpenGrow coordinated secrets for vocostar/production/api",
      "--tag", tag,
    ],
  );
  assert.deepEqual(
    buildSecretUploadReceipt(plan, [{
      service: "api",
      worker: "opengrow-api",
      names: ["PUSH_PROCESS_KEY"],
      strategy: "inactive-version",
      versionTag: tag,
    }]),
    {
      schemaVersion: 1,
      mode: "inactive-secret-bundle-upload",
      target: "vocostar",
      environment: "production",
      valuesIncluded: false,
      planConfirmation: plan.confirmation,
      externalPeersReady: false,
      overlap: false,
      contracts: ["api-push-process-key"],
      services: [{
        service: "api",
        worker: "opengrow-api",
        names: ["PUSH_PROCESS_KEY"],
        strategy: "inactive-version",
        versionTag: tag,
      }],
      nextAction:
        "Promote only in a separately approved release window; inactive versions do not change traffic.",
    },
  );
});

test("overlap assigns the old token only to accepting consumers", async () => {
  const { target } = await loadTarget("vocostar");
  const plan = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["email-internal-token"],
    overlap: true,
  });
  assert.equal(plan.blockers.length, 0);
  const assignments = buildSecretAssignments(plan, {
    contracts: {
      "email-internal-token": {
        value: "new-email-token",
        previousValue: "old-email-token",
      },
    },
  });
  assert.deepEqual(assignments, {
    api: { EMAIL_INTERNAL_TOKEN: "new-email-token" },
    email: {
      EMAIL_INTERNAL_TOKEN: "new-email-token",
      EMAIL_INTERNAL_TOKEN_PREVIOUS: "old-email-token",
    },
    identity: { EMAIL_INTERNAL_TOKEN: "new-email-token" },
  });
  assert.throws(
    () => buildSecretAssignments(plan, {
      contracts: {
        "email-internal-token": {
          value: "same-token",
          previousValue: "same-token",
        },
      },
    }),
    /must differ/u,
  );
});
