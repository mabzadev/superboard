import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  chatwootCredentialInventory,
  evaluateChatwootReadiness,
  scanLegacyClient,
} from "./opengrow-chatwoot-readiness.mjs";

test("Chatwoot readiness reports environment names without values", () => {
  const credentials = chatwootCredentialInventory({
    CHATWOOT_ACCOUNT_ID: "12",
    CHATWOOT_API_ACCESS_TOKEN: "must-not-appear",
  });
  const encoded = JSON.stringify(credentials);
  assert.equal(encoded.includes("must-not-appear"), false);
  assert.deepEqual(credentials, [
    {
      name: "CHATWOOT_ACCOUNT_ID",
      secret: false,
      required: true,
      configured: true,
      valid: true,
    },
    {
      name: "CHATWOOT_API_ACCESS_TOKEN",
      secret: true,
      required: true,
      configured: true,
      valid: true,
    },
    {
      name: "CHATWOOT_ATTACHMENT_HOSTS",
      secret: false,
      required: false,
      configured: false,
      valid: true,
    },
  ]);
});

test("Chatwoot retirement remains gated after export connectivity is ready", () => {
  const report = evaluateChatwootReadiness({
    supportEnabled: true,
    supportProjectIds: [11, 12],
    credentials: chatwootCredentialInventory({
      CHATWOOT_ACCOUNT_ID: "12",
      CHATWOOT_API_ACCESS_TOKEN: "configured",
    }),
    dns: { status: "resolved" },
    endpoint: { status: "reachable" },
    profile: { status: "authenticated" },
    legacyClientFiles: ["lib/support.dart"],
  });
  assert.equal(report.ready_for_export, true);
  assert.equal(report.ready_for_retirement, false);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.client_migration.inspected, true);
  assert.equal(report.client_migration.required, true);
  assert.deepEqual(report.retirement_blockers, ["legacy-client-code-present"]);
});

test("Chatwoot readiness never treats an uninspected client as migrated", () => {
  const report = evaluateChatwootReadiness({
    supportEnabled: true,
    supportProjectIds: [12],
    credentials: chatwootCredentialInventory({
      CHATWOOT_ACCOUNT_ID: "12",
      CHATWOOT_API_ACCESS_TOKEN: "configured",
    }),
    dns: { status: "resolved" },
    endpoint: { status: "reachable" },
    profile: { status: "authenticated" },
  });

  assert.equal(report.ready_for_export, true);
  assert.deepEqual(report.client_migration, {
    inspected: false,
    required: null,
    legacy_file_count: null,
    files: [],
  });
  assert.deepEqual(report.retirement_blockers, ["client-source-not-inspected"]);
});

test("Chatwoot readiness scans generated Flutter code even when Git ignores it", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "opengrow-chatwoot-client-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const generated = join(root, "generated_code/lib/custom_code/actions");
  mkdirSync(generated, { recursive: true });
  writeFileSync(join(root, ".gitignore"), "generated_code/\n");
  writeFileSync(
    join(generated, "support_init.dart"),
    "const legacySupport = 'https://sup.vocostar.com';\n",
  );

  assert.deepEqual(await scanLegacyClient(root), [
    "generated_code/lib/custom_code/actions/support_init.dart",
  ]);
});

test("Chatwoot readiness rejects malformed account and attachment configuration", () => {
  const credentials = chatwootCredentialInventory({
    CHATWOOT_ACCOUNT_ID: "not-an-id",
    CHATWOOT_API_ACCESS_TOKEN: "configured",
    CHATWOOT_ATTACHMENT_HOSTS: "https://unsafe.example.test",
  });
  const report = evaluateChatwootReadiness({
    supportEnabled: true,
    supportProjectIds: [12],
    credentials,
    dns: { status: "resolved" },
    endpoint: { status: "reachable" },
    profile: { status: "authenticated" },
  });
  assert.deepEqual(report.blockers, [
    "environment-invalid:CHATWOOT_ACCOUNT_ID",
    "environment-invalid:CHATWOOT_ATTACHMENT_HOSTS",
  ]);
});

test("Chatwoot readiness pinpoints unavailable data and credentials", () => {
  const report = evaluateChatwootReadiness({
    supportEnabled: true,
    supportProjectIds: [12],
    credentials: chatwootCredentialInventory({}),
    dns: { status: "unresolved" },
    endpoint: { status: "not-checked" },
    profile: { status: "not-checked" },
  });
  assert.equal(report.ready_for_export, false);
  assert.deepEqual(report.blockers, [
    "environment-missing:CHATWOOT_ACCOUNT_ID",
    "environment-missing:CHATWOOT_API_ACCESS_TOKEN",
    "chatwoot-dns-unresolved",
    "chatwoot-endpoint-unreachable",
    "chatwoot-token-unverified",
  ]);
});
