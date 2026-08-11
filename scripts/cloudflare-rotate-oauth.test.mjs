import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOauthRotationPlan,
  deployOauthVersionArgs,
  oauthRotationConfirmation,
  oauthRotationSql,
  versionedOauthSecretArgs,
} from "./cloudflare-rotate-oauth.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

test("OAuth rotation is value-free, deterministic and requires overlap migration", async () => {
  const { target } = await loadTarget("vocostar");
  const plan = buildOauthRotationPlan({
    targetName: "vocostar",
    target,
    environment: "production",
    overlapMinutes: 30,
  });
  assert.equal(plan.valuesIncluded, false);
  assert.equal(plan.confirmation, oauthRotationConfirmation(plan));
  assert.equal(plan.requiredMigration, "0056_oauth_client_secret_overlap.sql");
  assert.deepEqual(plan.steps, [
    "verify-overlap-schema",
    "upload-inactive-dashboard-secret-version",
    "move-current-verifier-to-bounded-previous-slot",
    "activate-tagged-dashboard-version",
    "rollback-database-verifier-if-activation-fails",
  ]);
});

test("OAuth rotation plan rejects unsafe overlap windows", async () => {
  const { target } = await loadTarget("vocostar");
  for (const overlapMinutes of [0, 4, 121, 5.5]) {
    assert.throws(
      () => buildOauthRotationPlan({
        targetName: "vocostar",
        target,
        environment: "production",
        overlapMinutes,
      }),
      /between 5 and 120/u,
    );
  }
});

test("OAuth rotation SQL preserves one bounded verifier and has a scoped rollback", () => {
  const digest = "a".repeat(64);
  const statements = oauthRotationSql({
    clientId: "dashboard-client",
    secretDigest: digest,
    overlapMinutes: 45,
  });
  assert.match(statements.apply, /previous_secret = oauth_applications\.secret/u);
  assert.match(statements.apply, /\+45 minutes/u);
  assert.match(statements.apply, new RegExp(digest, "u"));
  assert.match(statements.rollback, /secret = previous_secret/u);
  assert.match(statements.rollback, /previous_secret = NULL/u);
  assert.match(statements.rollback, /AND previous_secret IS NOT NULL/u);
  assert.throws(
    () => oauthRotationSql({
      clientId: "dashboard-client",
      secretDigest: "not-a-digest",
      overlapMinutes: 30,
    }),
    /SHA-256/u,
  );
});

test("OAuth secret upload is inactive and activation targets its unique tag", () => {
  const config = "/tmp/opengrow-dashboard.jsonc";
  const tag = "oauth-123-abc";
  assert.deepEqual(
    versionedOauthSecretArgs(config, tag, "vocostar", "production"),
    [
      "wrangler", "versions", "secret", "bulk",
      "--config", config,
      "--tag", tag,
      "--message", "OpenGrow Dashboard OAuth rotation for vocostar/production",
    ],
  );
  assert.deepEqual(
    deployOauthVersionArgs(config, tag, "vocostar", "production"),
    [
      "wrangler", "versions", "deploy",
      "--config", config,
      "--version-tag", `${tag}@100%`,
      "--message", "Activate OpenGrow Dashboard OAuth rotation for vocostar/production",
      "--yes",
    ],
  );
});
