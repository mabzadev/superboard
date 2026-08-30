import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("pointer rollback writes immutable history and a rollback outbox event", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "superboard-site-release-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const database = join(temporary, "site.sqlite");
  const migrations = new URL("../apps/site/migrations/", import.meta.url);
  const files = readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
  for (const filename of files) {
    execFileSync("sqlite3", [database], {
      input: readFileSync(new URL(filename, migrations)),
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  execute(
    database,
    `INSERT INTO superboard_release_signing_keys VALUES
       ('key', '{"kty":"EC"}', 'active', '2026-08-30T00:00:00.000Z', NULL);
     INSERT INTO superboard_front_release_candidates (
       candidate_id, instance_id, release_id, release_json, content_checksum,
       validation_set_checksum, signing_kid, status, approval_json, created_at
     ) VALUES
       ('candidate-a', 'vocostar', 'release-a', '{}', 'checksum-a', 'set-a', 'key', 'approved', '{}', '2026-08-30T00:00:00.000Z'),
       ('candidate-b', 'vocostar', 'release-b', '{}', 'checksum-b', 'set-b', 'key', 'approved', '{}', '2026-08-30T00:00:00.000Z');
     INSERT INTO superboard_operator_reauthentication_receipts VALUES
       ('reauth-a', 'operator', 'vocostar', 'front_release.approve', 'candidate-a',
        '2026-08-30T00:00:00.000Z', '2026-08-30T00:05:00.000Z', 'checksum',
        '2026-08-30T00:00:00.000Z');
     INSERT INTO superboard_front_approval_reauthentication VALUES
       ('candidate-a', 'reauth-a', '2026-08-30T00:00:00.000Z');
     INSERT INTO superboard_front_active_releases VALUES
       ('vocostar', 'release-a', NULL, 1, 'activation-a', '2026-08-30T00:01:00.000Z');
     UPDATE superboard_front_active_releases
       SET previous_release_id = active_release_id, active_release_id = 'release-b',
           pointer_revision = 2, activation_id = 'activation-b', activated_at = '2026-08-30T00:02:00.000Z'
       WHERE instance_id = 'vocostar';
     UPDATE superboard_front_active_releases
       SET previous_release_id = active_release_id, active_release_id = 'release-a',
           pointer_revision = 3, activation_id = 'rollback-a', activated_at = '2026-08-30T00:03:00.000Z'
       WHERE instance_id = 'vocostar';`,
  );

  assert.equal(query(database, "SELECT COUNT(*) FROM superboard_front_rollbacks"), "1");
  assert.equal(
    query(
      database,
      "SELECT from_release_id || ':' || target_release_id || ':' || pointer_revision FROM superboard_front_rollbacks",
    ),
    "release-b:release-a:3",
  );
  assert.equal(
    query(
      database,
      "SELECT COUNT(*) FROM superboard_front_outbox WHERE event_type = 'front_release.rolled_back'",
    ),
    "1",
  );
  assert.throws(
    () => execute(database, "UPDATE superboard_front_approval_reauthentication SET receipt_id = 'changed' WHERE candidate_id = 'candidate-a'"),
    /immutable/u,
  );
});

function execute(database, sql) {
  execFileSync("sqlite3", [database], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
}

function query(database, sql) {
  return execFileSync("sqlite3", [database, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
