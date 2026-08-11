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
    119,
  );

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
