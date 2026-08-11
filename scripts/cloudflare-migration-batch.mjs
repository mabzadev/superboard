import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertProtectedBackupDirectory } from "./cloudflare-d1-backup.mjs";

const MAX_RECEIPT_BYTES = 1024 * 1024;
export const MIGRATION_BATCH_KIND = "opengrow-d1-migration-batch";

export function buildMigrationBatchReceipt({
  targetName,
  environment,
  result,
  expectedServices,
  now = new Date(),
}) {
  const services = uniqueStrings(expectedServices);
  if (services.length === 0) {
    throw new Error("A production migration batch requires D1 schema owners");
  }
  if (
    !result ||
    result.mode !== "apply" ||
    result.target !== targetName ||
    result.environment !== environment ||
    result.service_selector !== "all"
  ) {
    throw new Error(
      "D1 migration result does not match the requested full batch",
    );
  }
  const databases = Array.isArray(result.databases) ? result.databases : [];
  const backups = Array.isArray(result.backups) ? result.backups : [];
  assertExactServices(
    services,
    databases.map((entry) => entry?.service),
    "migrated databases",
  );
  assertExactServices(
    services,
    backups.map((entry) => entry?.service),
    "database backups",
  );
  const normalizedDatabases = databases.map((database) => {
    if (
      typeof database.database_name !== "string" ||
      !database.database_name ||
      typeof database.verified_at !== "string" ||
      !database.verified_at
    ) {
      throw new Error(
        `Migration verification is incomplete for ${database.service}`,
      );
    }
    return {
      service: database.service,
      databaseName: database.database_name,
      verifiedAt: database.verified_at,
    };
  });
  const normalizedBackups = backups.map((backup) => {
    if (
      typeof backup.path !== "string" ||
      !backup.path ||
      !Number.isSafeInteger(backup.bytes) ||
      backup.bytes <= 0 ||
      typeof backup.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(backup.sha256)
    ) {
      throw new Error(`Backup evidence is incomplete for ${backup.service}`);
    }
    return {
      service: backup.service,
      receiptPath: resolve(backup.path),
      bytes: backup.bytes,
      sha256: backup.sha256,
    };
  });
  return {
    schemaVersion: 1,
    kind: MIGRATION_BATCH_KIND,
    complete: true,
    target: targetName,
    environment,
    serviceSelector: "all",
    createdAt: now.toISOString(),
    services,
    databases: normalizedDatabases,
    backups: normalizedBackups,
  };
}

export async function writeMigrationBatchReceipt(directory, receipt) {
  const destination = assertProtectedBackupDirectory(directory);
  validateMigrationBatchReceipt(receipt);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const stamp = receipt.createdAt.replaceAll(":", "-");
  const path = resolve(
    destination,
    `${stamp}-${receipt.target}-${receipt.environment}-migration-batch.receipt.json`,
  );
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}

export async function readMigrationBatchReceipt(path, expected = {}) {
  const source = resolve(path);
  assertProtectedBackupDirectory(dirname(source));
  const metadata = await stat(source);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error("Migration batch receipt is empty");
  }
  if (metadata.size > MAX_RECEIPT_BYTES) {
    throw new Error("Migration batch receipt is too large");
  }
  let value;
  try {
    const contents = await readFile(source, "utf8");
    if (expected.sha256) {
      if (!/^[a-f0-9]{64}$/u.test(expected.sha256)) {
        throw new Error("Migration batch receipt digest is invalid");
      }
      const actual = createHash("sha256").update(contents).digest("hex");
      if (actual !== expected.sha256) {
        throw new Error("Migration batch receipt digest does not match");
      }
    }
    value = JSON.parse(contents);
  } catch {
    throw new Error("Migration batch receipt integrity validation failed");
  }
  return validateMigrationBatchReceipt(value, expected);
}

export function validateMigrationBatchReceipt(value, expected = {}) {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== MIGRATION_BATCH_KIND ||
    value.complete !== true ||
    typeof value.target !== "string" ||
    typeof value.environment !== "string" ||
    value.serviceSelector !== "all" ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.services) ||
    !Array.isArray(value.databases) ||
    !Array.isArray(value.backups)
  ) {
    throw new Error("Migration batch receipt contract is invalid");
  }
  const services = uniqueStrings(value.services);
  if (services.length === 0 || services.length !== value.services.length) {
    throw new Error("Migration batch receipt service list is invalid");
  }
  assertExactServices(
    services,
    value.databases.map((entry) => entry?.service),
    "receipt databases",
  );
  assertExactServices(
    services,
    value.backups.map((entry) => entry?.service),
    "receipt backups",
  );
  for (const database of value.databases) {
    if (
      !record(database) ||
      typeof database.databaseName !== "string" ||
      !database.databaseName ||
      typeof database.verifiedAt !== "string" ||
      !database.verifiedAt
    ) {
      throw new Error("Migration batch database evidence is invalid");
    }
  }
  for (const backup of value.backups) {
    if (
      !record(backup) ||
      typeof backup.receiptPath !== "string" ||
      !backup.receiptPath ||
      !Number.isSafeInteger(backup.bytes) ||
      backup.bytes <= 0 ||
      typeof backup.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(backup.sha256)
    ) {
      throw new Error("Migration batch backup evidence is invalid");
    }
  }
  if (expected.targetName && value.target !== expected.targetName) {
    throw new Error("Migration batch receipt belongs to another target");
  }
  if (expected.environment && value.environment !== expected.environment) {
    throw new Error("Migration batch receipt belongs to another environment");
  }
  if (expected.service && !services.includes(expected.service)) {
    throw new Error(
      `Migration batch receipt does not cover ${expected.service}`,
    );
  }
  return value;
}

function assertExactServices(expected, actual, label) {
  const normalized = uniqueStrings(actual);
  if (
    normalized.length !== actual.length ||
    expected.length !== normalized.length ||
    expected.some((service) => !normalized.includes(service))
  ) {
    throw new Error(`D1 migration batch has incomplete ${label}`);
  }
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter((value) => typeof value === "string" && value.length > 0),
    ),
  ];
}

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
