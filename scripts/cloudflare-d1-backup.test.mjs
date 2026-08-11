import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assertProtectedBackupDirectory,
  backupPaths,
  createD1Backup,
} from "./cloudflare-d1-backup.mjs";
import { d1Descriptor } from "./cloudflare-d1-registry.mjs";
import { loadTarget, root } from "./cloudflare-target.mjs";
import { targetWithoutResourceIds } from "./cloudflare-test-fixtures.mjs";

test("D1 backups are protected, hashed and carry database ownership evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengrow-d1-backup-"));
  try {
    const { target } = await loadTarget("vocostar");
    const descriptor = d1Descriptor(target, "vocostar", "production", "support");
    const now = new Date("2026-08-08T10:20:30.000Z");
    const result = await createD1Backup({
      descriptor,
      outputDirectory: directory,
      env: {},
      now,
      execute: async ({ output }) => writeFile(output, "-- D1 export\nSELECT 1;\n"),
    });
    assert.equal(result.receipt.service, "support");
    assert.equal(result.receipt.database.name, "opengrow-support-db");
    assert.equal(result.receipt.artifact.bytes, 23);
    assert.match(result.receipt.artifact.sha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(JSON.parse(await readFile(result.paths.receipt, "utf8")), result.receipt);
    assert.match(backupPaths(directory, descriptor, now).sql, /vocostar\/production\/support/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("D1 backups refuse repository paths and unprovisioned resources", async () => {
  assert.throws(() => assertProtectedBackupDirectory(resolve(root, "backups")), /inside the Git repository/u);
  const { target: source } = await loadTarget("mbza-development");
  const target = targetWithoutResourceIds(source, "development");
  const descriptor = d1Descriptor(target, "mbza-development", "development", "identity");
  await assert.rejects(() => createD1Backup({
    descriptor,
    outputDirectory: tmpdir(),
    env: {},
    execute: async () => {},
  }), /not provisioned/u);
});
