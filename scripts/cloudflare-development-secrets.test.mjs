import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDevelopmentSecretPlan,
  developmentSecretConfirmation,
  generateDevelopmentSecretAssignments,
  versionedSecretBulkArgs,
} from "./cloudflare-development-secrets.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

test("development secret plan is value-free, account-scoped and deterministic", async () => {
  const { target } = await loadTarget("mbza-development");
  const plan = buildDevelopmentSecretPlan({
    target,
    environment: "development",
    accountId: "a".repeat(32),
    analyticsTokenConfigured: true,
  });
  assert.equal(plan.valuesIncluded, false);
  assert.equal(plan.blockers.length, 0);
  assert.equal(JSON.stringify(plan).includes("a".repeat(32)), false);
  assert.equal(plan.confirmation, developmentSecretConfirmation(plan));
  assert.equal(
    plan.services.find(({ service }) => service === "dashboard").strategy,
    "rotate-dashboard-oauth",
  );
});

test("development secret plan refuses production and treats analytics credentials as optional", async () => {
  const { target } = await loadTarget("mbza-development");
  assert.throws(
    () =>
      buildDevelopmentSecretPlan({
        target,
        environment: "production",
        accountId: "a".repeat(32),
        analyticsTokenConfigured: true,
      }),
    /forbidden outside development/u,
  );
  const plan = buildDevelopmentSecretPlan({
    target,
    environment: "development",
    accountId: "a".repeat(32),
    analyticsTokenConfigured: false,
  });
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.optionalCapabilities.analyticsQueries, "disabled");
});

test("generated assignments satisfy every private cross-service contract without operator secrets", async () => {
  const { target } = await loadTarget("mbza-development");
  const assignments = await generateDevelopmentSecretAssignments({
    target,
    environment: "development",
    accountId: "a".repeat(32),
    analyticsToken: "",
    appleRootBase64: "apple-root",
  });
  assert.equal(
    assignments.api.MODULE_INTERNAL_TOKEN,
    assignments.support.INTERNAL_API_TOKEN,
  );
  assert.equal(
    assignments.api.EMAIL_INTERNAL_TOKEN,
    assignments.identity.EMAIL_INTERNAL_TOKEN,
  );
  assert.equal(
    assignments.api.MODULE_INTERNAL_TOKEN,
    assignments.identity.INTERNAL_API_TOKEN,
  );
  assert.equal(
    assignments.api.MODULE_INTERNAL_TOKEN,
    assignments.billing.INTERNAL_API_TOKEN,
  );
  assert.equal(
    assignments.api.EMAIL_INTERNAL_TOKEN,
    assignments.email.EMAIL_INTERNAL_TOKEN,
  );
  assert.equal(
    assignments.api.EMAIL_INTERNAL_TOKEN,
    assignments.marketing.EMAIL_INTERNAL_TOKEN,
  );
  assert.equal(
    assignments.identity.FILES_INTERNAL_TOKEN,
    assignments.files.FILES_INTERNAL_TOKEN,
  );
  assert.equal(typeof assignments.files.FILES_DOWNLOAD_SIGNING_KEY, "string");
  assert.equal(
    assignments.api.CUSTOM_WORKER_TOKEN,
    assignments.custom.CUSTOM_WORKER_TOKEN,
  );
  assert.equal(
    assignments.api.PURCHASES_SIGNING_KEYSET,
    assignments.billing.PURCHASES_SIGNING_KEYSET,
  );
  assert.deepEqual(Object.keys(assignments.observability), [
    "OBSERVABILITY_INTERNAL_TOKEN",
  ]);
  assert.equal(Object.hasOwn(assignments, "dashboard"), false);
});

test("development assignments include analytics credentials only when supplied", async () => {
  const { target } = await loadTarget("mbza-development");
  const assignments = await generateDevelopmentSecretAssignments({
    target,
    environment: "development",
    accountId: "a".repeat(32),
    analyticsToken: "analytics-token",
    appleRootBase64: "apple-root",
  });
  assert.deepEqual(assignments.observability, {
    OBSERVABILITY_INTERNAL_TOKEN: assignments.api.OBSERVABILITY_INTERNAL_TOKEN,
    CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_ANALYTICS_TOKEN: "analytics-token",
  });
});

test("secret bootstrap always creates an inactive secret version", () => {
  assert.deepEqual(
    versionedSecretBulkArgs(
      "/tmp/generated.jsonc",
      "mbza-development",
      "development",
      "email",
    ),
    [
      "wrangler",
      "versions",
      "secret",
      "bulk",
      "--config",
      "/tmp/generated.jsonc",
      "--message",
      "SuperBoard generated secrets for mbza-development/development/email",
    ],
  );
});
