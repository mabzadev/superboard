import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  backupEncryptionKey,
  decryptBackupFile,
  encryptBackupDirectory,
} from "./cloudflare-d1-backup-crypto.mjs";
import {
  buildMigrationBatchReceipt,
  writeMigrationBatchReceipt,
} from "./cloudflare-migration-batch.mjs";

test("production backup artifacts are authenticated, encrypted and restorable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengrow-encrypted-backup-"));
  const key = backupEncryptionKey(Buffer.alloc(32, 7).toString("base64"));
  const source = join(directory, "support.sql");
  const plaintext = "CREATE TABLE protected_customer_data(id TEXT);\n";
  try {
    await writeFile(source, plaintext, { mode: 0o600 });
    const index = await encryptBackupDirectory(
      directory,
      key,
      new Date("2026-08-08T12:00:00.000Z"),
    );
    assert.equal(index.artifact_count, 1);
    await assert.rejects(stat(source));
    const encrypted = join(directory, index.artifacts[0].path);
    assert.doesNotMatch(
      (await readFile(encrypted)).toString("utf8"),
      /protected_customer_data/u,
    );
    const restored = join(directory, "restored", "support.sql");
    await decryptBackupFile(encrypted, restored, key);
    assert.equal(await readFile(restored, "utf8"), plaintext);
    await assert.rejects(
      decryptBackupFile(
        encrypted,
        join(directory, "restored", "wrong.sql"),
        Buffer.alloc(32, 8),
      ),
      /authentication failed/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup encryption rejects malformed keys", () => {
  assert.throws(
    () => backupEncryptionKey("not-a-key"),
    /base64-encoded 32-byte/u,
  );
});

test("backup encryption refuses an empty successful artifact set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengrow-empty-backup-"));
  const key = backupEncryptionKey(Buffer.alloc(32, 7).toString("base64"));
  try {
    await assert.rejects(
      encryptBackupDirectory(directory, key),
      /No plaintext D1 backup artifacts/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("directory encryption keeps plaintext and emits no index after an encryption failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengrow-atomic-backup-"));
  const key = backupEncryptionKey(Buffer.alloc(32, 7).toString("base64"));
  const source = join(directory, "api.sql");
  try {
    await writeFile(source, "CREATE TABLE durable(id TEXT);\n", {
      mode: 0o600,
    });
    await writeFile(`${source}.enc`, "collision", { mode: 0o600 });
    await assert.rejects(encryptBackupDirectory(directory, key), /EEXIST/u);
    assert.match(await readFile(source, "utf8"), /durable/u);
    await assert.rejects(stat(join(directory, "encrypted-backups.index.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("successful production retention verifies the complete migration batch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengrow-complete-backup-"));
  const key = backupEncryptionKey(Buffer.alloc(32, 7).toString("base64"));
  const services = ["api", "email"];
  const now = new Date("2026-08-09T12:00:00.000Z");
  try {
    const backups = [];
    for (const service of services) {
      const sqlPath = join(directory, `${service}.sql`);
      const sql = `CREATE TABLE ${service}_evidence(id TEXT);\n`;
      await writeFile(sqlPath, sql, { mode: 0o600 });
      const digest = createHash("sha256").update(sql).digest("hex");
      const receiptPath = join(directory, `${service}.receipt.json`);
      await writeFile(
        receiptPath,
        `${JSON.stringify({
          schema_version: 1,
          kind: "cloudflare-d1-export",
          target: "example-production",
          environment: "production",
          service,
          artifact: {
            path: `${service}.sql`,
            bytes: Buffer.byteLength(sql),
            sha256: digest,
          },
        })}\n`,
        { mode: 0o600 },
      );
      backups.push({
        service,
        path: receiptPath,
        bytes: Buffer.byteLength(sql),
        sha256: digest,
      });
    }
    const result = {
      schema_version: 1,
      mode: "apply",
      target: "example-production",
      environment: "production",
      service_selector: "all",
      backups,
      databases: services.map((service) => ({
        service,
        database_name: `example-${service}`,
        verified_at: now.toISOString(),
      })),
    };
    const receipt = buildMigrationBatchReceipt({
      targetName: "example-production",
      environment: "production",
      result,
      expectedServices: services,
      now,
    });
    await writeMigrationBatchReceipt(directory, receipt);
    const index = await encryptBackupDirectory(directory, key, now, {
      requireBatchReceipt: true,
    });
    assert.equal(index.artifact_count, 5);
    assert.equal(
      index.artifacts.filter(({ path }) => path.endsWith(".enc")).length,
      5,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
