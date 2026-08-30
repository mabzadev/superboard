import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const migrationsDirectory = resolve(root, "workers/api/migrations");

test("the complete central API migration chain creates one healthy fresh D1 schema", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "opengrow-api-migrations-"));
  const database = join(temporary, "api.sqlite");
  t.after(() => rmSync(temporary, { recursive: true, force: true }));

  const migrations = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  assert.ok(migrations.length > 0, "No central API migrations were found");

  for (const filename of migrations) {
    assert.doesNotThrow(
      () =>
        execFileSync("sqlite3", [database], {
          input: readFileSync(join(migrationsDirectory, filename)),
          stdio: ["pipe", "pipe", "pipe"],
        }),
      `Fresh schema failed while applying ${filename}`,
    );
  }

  assert.equal(queryScalar(database, "PRAGMA integrity_check"), "ok");
  assert.deepEqual(queryRows(database, "PRAGMA foreign_key_check"), []);
  assert.equal(
    Number(
      queryScalar(
        database,
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      ),
    ),
    123,
  );

  assertTables(database, [
    "flows_legacy_cutover_state",
    "flows_legacy_cutover_commands",
    "support_notification_ingress",
  ]);

  assertColumns(database, "ios_push_configurations", ["encrypted_p8_key"]);
  assertColumns(database, "android_push_configurations", [
    "encrypted_fcm_server_key",
  ]);
  assertColumns(database, "rpush_apps", [
    "encrypted_apn_key",
    "encrypted_json_key",
    "encrypted_access_token",
    "encrypted_legacy_credentials",
  ]);
  assertColumns(database, "dashboard_auth_rate_limits", [
    "key_hash",
    "window_started_at",
    "attempt_count",
    "updated_at",
  ]);

  const indexes = new Set(
    queryRows(
      database,
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('index_rpush_notifications_on_delivery_claim','dashboard_auth_rate_limits_window_idx')",
    ).map((row) => row.name),
  );
  assert.deepEqual(
    indexes,
    new Set([
      "index_rpush_notifications_on_delivery_claim",
      "dashboard_auth_rate_limits_window_idx",
    ]),
  );
});

test("the Analytics fact backfill is verified-only and idempotent", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "opengrow-analytics-backfill-"));
  const database = join(temporary, "api.sqlite");
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const migrations = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const backfill = "0060_analytics_verified_fact_backfill.sql";
  for (const filename of migrations.filter((filename) => filename < backfill)) {
    execFileSync("sqlite3", [database], {
      input: readFileSync(join(migrationsDirectory, filename)),
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  execFileSync("sqlite3", [database], {
    input: `
      INSERT INTO instances (id, api_key, uri_scheme) VALUES (1, 'key', 'example');
      INSERT INTO projects (id, name, identifier, instance_id, is_test)
        VALUES (7, 'Example', 'example-prod', 1, 0);
      INSERT INTO applications (id, platform, instance_id, enabled)
        VALUES (10, 'android', 1, 1);
      INSERT INTO android_configurations (application_id, identifier)
        VALUES (10, 'com.example.app');
      INSERT INTO devices
        (id, ip, remote_ip, user_agent, platform, app_version)
        VALUES (20, '0.0.0.0', '0.0.0.0', 'test', 'android', '2.4.0');
      INSERT INTO installed_apps (id, device_id, project_id, created_at)
        VALUES (30, 20, 7, '2026-08-01 10:00:00');
      INSERT INTO billing_products
        (id, project_id, store, environment, store_product_id, product_type, active)
        VALUES ('product-1', '7', 'google', 'production', 'premium.yearly', 'subscription', 1);
      INSERT INTO billing_transactions
        (id, project_id, product_id, store, environment, store_transaction_id,
         event_type, status, price_micros, currency, verified_at, raw_payload)
        VALUES
        ('verified-1', '7', 'product-1', 'google', 'production', 'order-1',
         'DID_RENEW', 'active', 9900000, 'chf', '2026-08-02 10:00:00', '{}'),
        ('unverified-1', '7', 'product-1', 'google', 'production', 'order-2',
         'PURCHASED', 'pending', 19900000, 'CHF', NULL, '{}');
    `,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const sql = readFileSync(join(migrationsDirectory, backfill));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    execFileSync("sqlite3", [database], {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  const rows = queryRows(
    database,
    "SELECT project_id, fact_key, event_id, payload_json FROM analytics_fact_outbox ORDER BY fact_key",
  );
  assert.equal(rows.length, 2);
  const installation = rows.find((row) =>
    row.fact_key.startsWith("installation:"),
  );
  const purchase = rows.find((row) => row.fact_key.startsWith("purchase:"));
  assert.equal(installation.fact_key, "installation:7:com.example.app:20");
  assert.deepEqual(JSON.parse(installation.payload_json), {
    schema_version: 1,
    event_id: "installation-legacy-30",
    event_name: "superboard.analytics.installation.created.v1",
    occurred_at: "2026-08-01T10:00:00.000Z",
    source: "import",
    application_id: "com.example.app",
    app_instance_id: "dev_20",
    properties: { install_type: "historical" },
    context: { platform: "android", app_version: "2.4.0" },
  });
  assert.equal(
    purchase.fact_key,
    "purchase:7:google:production:order-1:renewal",
  );
  assert.deepEqual(JSON.parse(purchase.payload_json), {
    schema_version: 1,
    event_id: "purchase-legacy-verified-1",
    event_name: "superboard.analytics.purchase.verified.v1",
    occurred_at: "2026-08-02T10:00:00.000Z",
    source: "billing",
    application_id: "project-7",
    properties: {
      billing_transaction_id: "verified-1",
      store: "google",
      environment: "production",
      store_transaction_id: "order-1",
      event_type: "renewal",
      product_id: "premium.yearly",
      amount_micros: 9900000,
      currency: "CHF",
    },
  });
});

function queryRows(database, sql) {
  const output = execFileSync("sqlite3", ["-json", database, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output ? JSON.parse(output) : [];
}

function queryScalar(database, sql) {
  return execFileSync("sqlite3", [database, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function assertColumns(database, table, required) {
  const columns = new Set(
    queryRows(database, `PRAGMA table_info(${table})`).map((row) => row.name),
  );
  for (const column of required) {
    assert.equal(columns.has(column), true, `${table}.${column} is missing`);
  }
}

function assertTables(database, required) {
  const tables = new Set(
    queryRows(database, "SELECT name FROM sqlite_master WHERE type='table'").map(
      (row) => row.name,
    ),
  );
  for (const table of required) {
    assert.equal(tables.has(table), true, `${table} is missing`);
  }
}
