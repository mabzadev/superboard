#!/usr/bin/env node
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertProtectedBackupDirectory,
  sha256File,
} from "./cloudflare-d1-backup.mjs";
import { validateMigrationBatchReceipt } from "./cloudflare-migration-batch.mjs";
import { parseArgs } from "./cloudflare-target.mjs";

const MAGIC = Buffer.from("OGD1ENC1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function backupEncryptionKey(value) {
  const encoded = String(value || "").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(encoded)) {
    throw new Error(
      "OPENGROW_BACKUP_ENCRYPTION_KEY must be one base64-encoded 32-byte key",
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32)
    throw new Error("Backup encryption key must contain exactly 32 bytes");
  return key;
}

export async function encryptBackupFile(
  input,
  key,
  iv = randomBytes(IV_BYTES),
  { removeSource = true } = {},
) {
  const source = resolve(input);
  const output = `${source}.enc`;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const target = await open(output, "wx", 0o600);
  try {
    await target.write(Buffer.concat([MAGIC, iv]));
    for await (const chunk of createReadStream(source)) {
      await target.write(cipher.update(chunk));
    }
    await target.write(cipher.final());
    await target.write(cipher.getAuthTag());
  } catch (error) {
    await target.close().catch(() => {});
    await unlink(output).catch(() => {});
    throw error;
  } finally {
    await target.close().catch(() => {});
  }
  if (removeSource) await unlink(source);
  return output;
}

export async function decryptBackupFile(input, output, key) {
  const source = resolve(input);
  if (!isAbsolute(output))
    throw new Error("--output must be an absolute protected path");
  assertProtectedBackupDirectory(dirname(resolve(output)));
  const metadata = await stat(source);
  const minimum = MAGIC.byteLength + IV_BYTES + TAG_BYTES + 1;
  if (!metadata.isFile() || metadata.size < minimum)
    throw new Error("Encrypted backup is truncated");
  const inputFile = await open(source, "r");
  const header = Buffer.alloc(MAGIC.byteLength + IV_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await inputFile.read(header, 0, header.byteLength, 0);
    await inputFile.read(tag, 0, TAG_BYTES, metadata.size - TAG_BYTES);
  } finally {
    await inputFile.close();
  }
  if (!header.subarray(0, MAGIC.byteLength).equals(MAGIC))
    throw new Error("Encrypted backup format is invalid");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    header.subarray(MAGIC.byteLength),
  );
  decipher.setAuthTag(tag);
  await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 });
  const target = await open(resolve(output), "wx", 0o600);
  try {
    const ciphertextEnd = metadata.size - TAG_BYTES - 1;
    for await (const chunk of createReadStream(source, {
      start: header.byteLength,
      end: ciphertextEnd,
    })) {
      await target.write(decipher.update(chunk));
    }
    await target.write(decipher.final());
  } catch (error) {
    await target.close();
    await unlink(resolve(output)).catch(() => {});
    throw new Error("Encrypted backup authentication failed", { cause: error });
  }
  await target.close();
  return resolve(output);
}

export async function encryptBackupDirectory(
  directory,
  key,
  now = new Date(),
  { requireBatchReceipt = false } = {},
) {
  const protectedDirectory = assertProtectedBackupDirectory(directory);
  await mkdir(protectedDirectory, { recursive: true, mode: 0o700 });
  const entries = await readdir(protectedDirectory, {
    recursive: true,
    withFileTypes: true,
  });
  const sources = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith(".sql") || entry.name.endsWith(".receipt.json")),
    )
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
  if (sources.length === 0) {
    throw new Error("No plaintext D1 backup artifacts were found to encrypt");
  }
  if (requireBatchReceipt) {
    await assertCompleteMigrationBatchSources(protectedDirectory, sources);
  }
  const artifacts = [];
  const encryptedFiles = [];
  const indexPath = resolve(protectedDirectory, "encrypted-backups.index.json");
  try {
    for (const source of sources) {
      const encrypted = await encryptBackupFile(
        source,
        key,
        randomBytes(IV_BYTES),
        {
          removeSource: false,
        },
      );
      encryptedFiles.push(encrypted);
      const metadata = await stat(encrypted);
      artifacts.push({
        path: relative(protectedDirectory, encrypted),
        bytes: metadata.size,
        sha256: await sha256File(encrypted),
      });
    }
  } catch (error) {
    for (const encrypted of encryptedFiles) {
      await unlink(encrypted).catch(() => {});
    }
    throw error;
  }
  const index = {
    schema_version: 1,
    format: "opengrow-d1-aes-256-gcm-v1",
    encrypted_at: now.toISOString(),
    artifact_count: artifacts.length,
    artifacts,
  };
  try {
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    for (const encrypted of encryptedFiles) {
      await unlink(encrypted).catch(() => {});
    }
    throw error;
  }
  const removalFailures = [];
  for (const source of sources) {
    try {
      await unlink(source);
    } catch {
      removalFailures.push(source);
    }
  }
  if (removalFailures.length > 0) {
    throw new Error(
      `Encrypted backup is complete but ${removalFailures.length} plaintext artifact(s) could not be removed`,
    );
  }
  return index;
}

async function assertCompleteMigrationBatchSources(directory, sources) {
  const sourceSet = new Set(sources.map((source) => resolve(source)));
  const batchSources = sources.filter((source) =>
    source.endsWith("-migration-batch.receipt.json"),
  );
  if (batchSources.length !== 1) {
    throw new Error("Exactly one complete migration batch receipt is required");
  }
  let batch;
  try {
    batch = validateMigrationBatchReceipt(
      JSON.parse(await readFile(batchSources[0], "utf8")),
    );
  } catch (error) {
    throw new Error(
      "Migration batch receipt cannot authorize backup retention",
      {
        cause: error,
      },
    );
  }
  for (const backup of batch.backups) {
    const receiptPath = resolve(backup.receiptPath);
    const location = relative(directory, receiptPath);
    if (
      location.startsWith("..") ||
      isAbsolute(location) ||
      !sourceSet.has(receiptPath)
    ) {
      throw new Error(
        `Migration batch backup receipt is missing for ${backup.service}`,
      );
    }
    let receipt;
    try {
      receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    } catch {
      throw new Error(`D1 backup receipt is invalid for ${backup.service}`);
    }
    if (
      receipt?.schema_version !== 1 ||
      receipt?.kind !== "cloudflare-d1-export" ||
      receipt?.target !== batch.target ||
      receipt?.environment !== batch.environment ||
      receipt?.service !== backup.service ||
      receipt?.artifact?.bytes !== backup.bytes ||
      receipt?.artifact?.sha256 !== backup.sha256 ||
      typeof receipt?.artifact?.path !== "string"
    ) {
      throw new Error(
        `D1 backup receipt does not match the batch for ${backup.service}`,
      );
    }
    const sqlPath = resolve(dirname(receiptPath), receipt.artifact.path);
    if (!sourceSet.has(sqlPath)) {
      throw new Error(`D1 SQL export is missing for ${backup.service}`);
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const command = ["encrypt", "decrypt", "check-key"].includes(argv[0])
    ? argv[0]
    : "encrypt";
  const args = parseArgs(command === argv[0] ? argv.slice(1) : argv);
  const key = backupEncryptionKey(process.env.OPENGROW_BACKUP_ENCRYPTION_KEY);
  if (command === "check-key") {
    process.stdout.write(
      `${JSON.stringify({ valid: true, algorithm: "AES-256-GCM" })}\n`,
    );
    return;
  }
  if (command === "encrypt") {
    if (!args.directory) throw new Error("encrypt requires --directory");
    const index = await encryptBackupDirectory(
      args.directory,
      key,
      new Date(),
      {
        requireBatchReceipt: Boolean(args["require-batch-receipt"]),
      },
    );
    process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
    return;
  }
  if (!args.file || !args.output)
    throw new Error("decrypt requires --file and --output");
  const output = await decryptBackupFile(args.file, args.output, key);
  process.stdout.write(
    `${JSON.stringify({ decrypted: true, output, sha256: await sha256File(output) }, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
