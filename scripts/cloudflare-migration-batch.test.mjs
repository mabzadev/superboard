import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildMigrationBatchReceipt,
  readMigrationBatchReceipt,
  validateMigrationBatchReceipt,
  writeMigrationBatchReceipt,
} from "./cloudflare-migration-batch.mjs";

const services = ["api", "email"];
const now = new Date("2026-08-09T12:00:00.000Z");

test("a migration batch proves every database backup before Worker deployment", async () => {
  const receipt = buildMigrationBatchReceipt({
    targetName: "example-production",
    environment: "production",
    expectedServices: services,
    now,
    result: migrationResult(),
  });
  assert.equal(receipt.complete, true);
  assert.deepEqual(receipt.services, services);
  assert.deepEqual(
    receipt.databases.map(({ service }) => service),
    services,
  );
  assert.deepEqual(
    receipt.backups.map(({ service }) => service),
    services,
  );
});

test("a missing backup or migration blocks the complete batch receipt", () => {
  const result = migrationResult();
  result.backups.pop();
  assert.throws(
    () =>
      buildMigrationBatchReceipt({
        targetName: "example-production",
        environment: "production",
        expectedServices: services,
        now,
        result,
      }),
    /incomplete database backups/u,
  );
});

test("a protected receipt is mode 0600 and scoped to target, environment and service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengrow-migration-batch-"));
  try {
    const receipt = buildMigrationBatchReceipt({
      targetName: "example-production",
      environment: "production",
      expectedServices: services,
      now,
      result: migrationResult(),
    });
    const path = await writeMigrationBatchReceipt(directory, receipt);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const contents = await readFile(path, "utf8");
    assert.match(contents, /opengrow-d1-migration-batch/u);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const parsed = await readMigrationBatchReceipt(path, {
      targetName: "example-production",
      environment: "production",
      service: "email",
      sha256,
    });
    assert.equal(parsed.complete, true);
    await assert.rejects(
      readMigrationBatchReceipt(path, { sha256: "f".repeat(64) }),
      /integrity validation failed/u,
    );
    await assert.rejects(
      readMigrationBatchReceipt(path, { targetName: "another-target" }),
      /another target/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a forged or incomplete receipt contract is rejected", () => {
  const receipt = buildMigrationBatchReceipt({
    targetName: "example-production",
    environment: "production",
    expectedServices: services,
    now,
    result: migrationResult(),
  });
  receipt.backups[0].sha256 = "not-a-digest";
  assert.throws(
    () => validateMigrationBatchReceipt(receipt),
    /backup evidence is invalid/u,
  );
});

function migrationResult() {
  return {
    schema_version: 1,
    mode: "apply",
    target: "example-production",
    environment: "production",
    service_selector: "all",
    backups: services.map((service) => ({
      service,
      path: `/protected/${service}.receipt.json`,
      bytes: 128,
      sha256: service === "api" ? "a".repeat(64) : "b".repeat(64),
    })),
    databases: services.map((service) => ({
      service,
      database_name: `example-${service}`,
      verified_at: now.toISOString(),
      remote_status: "No migrations to apply",
    })),
  };
}
