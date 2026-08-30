#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

export const FLOWS_VERSION_SECRET_NAMES = Object.freeze([
  "INTERNAL_API_TOKEN",
  "FLOW_USER_ENCRYPTION_KEY",
  "FLOW_USER_HASH_KEY",
]);

export const FLOWS_REUSED_SECRET_NAMES = Object.freeze([
  "INTERNAL_API_TOKEN",
  "FLOW_USER_ENCRYPTION_KEY",
]);

export const FLOWS_FORBIDDEN_VERSION_SECRETS = Object.freeze([
  "EMAIL_INTERNAL_TOKEN",
]);

const MAX_SECRET_BYTES = 128 * 1024;
const MIN_SECRET_BYTES = 32;
const PROTECTED_ROOT = resolve(root, ".flows-cutover");
const PROTECTED_DIRECTORY = resolve(PROTECTED_ROOT, "secrets");

export function buildFlowsVersionBundlePlan({
  target,
  targetName,
  environment,
  outputPath = resolve(
    PROTECTED_DIRECTORY,
    `${targetName}-flows-${environment}.json`,
  ),
  versionTag = "mbza-flows-project-cutover-v1",
}) {
  assertFlowsVersionScope({ target, targetName, environment });
  const secretsFile = protectedOutputPath(outputPath);
  const obsoleteSecretsFile = protectedOutputPath(
    secretsFile.replace(/\.json$/u, ".remove-obsolete.json"),
  );
  const config = resolve(
    root,
    "deploy",
    "generated",
    `${targetName}-flows-${environment}.jsonc`,
  );
  const upload = flowsVersionUploadArgs({
    config,
    secretsFile,
    versionTag,
  });
  const obsoleteSecretCleanup = flowsObsoleteSecretBulkArgs({
    config,
    worker: target.workers.flows[environment],
    versionTag: `${versionTag}-without-email`,
    obsoleteSecretsFile,
  });
  return {
    schemaVersion: 1,
    mode: "value-free-flows-version-bundle-plan",
    target: targetName,
    environment,
    service: "flows",
    worker: target.workers.flows[environment],
    valuesIncluded: false,
    reusedSecrets: [...FLOWS_REUSED_SECRET_NAMES],
    generatedOnce: ["FLOW_USER_HASH_KEY"],
    forbiddenSecrets: [...FLOWS_FORBIDDEN_VERSION_SECRETS],
    secretsFile,
    secretsFileMode: "0600",
    protectedDirectory: PROTECTED_DIRECTORY,
    protectedDirectoryMode: "0700",
    config,
    versionTag,
    configCommand: [
      process.execPath,
      resolve(root, "scripts", "cloudflare-config.mjs"),
      "--target",
      targetName,
      "--environment",
      environment,
      "--service",
      "flows",
      "--no-routes",
    ],
    dryRunCommand: ["npx", ...upload, "--dry-run"],
    uploadCommand: ["npx", ...upload],
    obsoleteRemoteSecrets: [...FLOWS_FORBIDDEN_VERSION_SECRETS],
    obsoleteSecretsFile,
    obsoleteSecretsFileMode: "0600",
    postUploadInactiveCleanupCommand: ["npx", ...obsoleteSecretCleanup],
    deployOnlyCleanupVersion: true,
    verificationCommands: [
      ["npx", "wrangler", "versions", "list", "--config", config, "--json"],
      ["npx", "wrangler", "versions", "secret", "list", "--config", config, "--latest-version"],
      ["npx", "wrangler", "deployments", "status", "--config", config, "--json"],
    ],
    promotionIncluded: false,
    remoteMutationIncluded: false,
    notes: [
      "The bundle carries the two existing values and the stable hash key on the same inactive code version.",
      "No Email secret is accepted or emitted by the protected bundle.",
      "Wrangler uploads are additive, so an existing EMAIL_INTERNAL_TOKEN must be removed with the planned versions secret bulk cleanup, which creates another inactive version without an interactive prompt.",
      "Promote only the inspected cleanup version, never the intermediate upload version.",
    ],
  };
}

export function flowsVersionUploadArgs({ config, secretsFile, versionTag }) {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(String(versionTag ?? ""))) {
    throw new Error("Flows version tag is invalid");
  }
  return [
    "wrangler",
    "versions",
    "upload",
    "--config",
    resolve(config),
    "--secrets-file",
    protectedOutputPath(secretsFile),
    "--strict",
    "--tag",
    String(versionTag),
    "--message",
    "SuperBoard Flows MBZA project-scoped cutover",
  ];
}

export function flowsObsoleteSecretBulkArgs({
  config,
  worker,
  versionTag,
  obsoleteSecretsFile,
}) {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(String(versionTag ?? ""))) {
    throw new Error("Flows cleanup version tag is invalid");
  }
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/u.test(String(worker ?? ""))) {
    throw new Error("Flows Worker name is invalid");
  }
  return [
    "wrangler",
    "versions",
    "secret",
    "bulk",
    protectedOutputPath(obsoleteSecretsFile),
    "--config",
    resolve(config),
    "--name",
    String(worker),
    "--tag",
    String(versionTag),
    "--message",
    "Remove obsolete Flows Email secret before MBZA activation",
  ];
}

export function parseExistingFlowsSecrets(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Existing Flows secret source must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Existing Flows secret source must be a JSON object");
  }
  const allowed = new Set(FLOWS_VERSION_SECRET_NAMES);
  const names = Object.keys(parsed).sort();
  for (const name of names) {
    if (FLOWS_FORBIDDEN_VERSION_SECRETS.includes(name)) {
      throw new Error(`${name} is forbidden in the Flows version secret bundle`);
    }
    if (!allowed.has(name)) {
      throw new Error(`Unexpected Flows version secret: ${name}`);
    }
  }
  for (const name of FLOWS_REUSED_SECRET_NAMES) {
    validateSecret(name, parsed[name]);
  }
  if (Object.hasOwn(parsed, "FLOW_USER_HASH_KEY")) {
    validateSecret("FLOW_USER_HASH_KEY", parsed.FLOW_USER_HASH_KEY);
  }
  return Object.fromEntries(names.map((name) => [name, parsed[name]]));
}

export function buildFlowsVersionSecrets({
  existingSecrets,
  preparedSecrets,
  generateHashKey = () => randomBytes(48).toString("base64url"),
}) {
  const source = parseExistingFlowsSecrets(JSON.stringify(existingSecrets));
  const prepared = preparedSecrets
    ? parseExistingFlowsSecrets(JSON.stringify(preparedSecrets))
    : null;
  for (const name of FLOWS_REUSED_SECRET_NAMES) {
    if (prepared && !equalSecret(source[name], prepared[name])) {
      throw new Error(`${name} differs from the already prepared protected bundle`);
    }
  }
  const hashKey = prepared?.FLOW_USER_HASH_KEY ??
    source.FLOW_USER_HASH_KEY ?? generateHashKey();
  validateSecret("FLOW_USER_HASH_KEY", hashKey);
  const bundle = {
    INTERNAL_API_TOKEN: source.INTERNAL_API_TOKEN,
    FLOW_USER_ENCRYPTION_KEY: source.FLOW_USER_ENCRYPTION_KEY,
    FLOW_USER_HASH_KEY: hashKey,
  };
  if (new Set(Object.values(bundle)).size !== FLOWS_VERSION_SECRET_NAMES.length) {
    throw new Error("Flows token, encryption key and hash key must be distinct");
  }
  return bundle;
}

export async function prepareFlowsVersionSecretsFile({
  existingSecretsFile,
  outputPath,
  generateHashKey,
}) {
  const sourcePath = resolve(String(existingSecretsFile ?? ""));
  const targetPath = protectedOutputPath(outputPath);
  await assertProtectedRegularFile(sourcePath, "existing secret source");
  const source = parseExistingFlowsSecrets(await readFile(sourcePath, "utf8"));
  let prepared = null;
  let created = false;
  try {
    await assertProtectedRegularFile(targetPath, "prepared Flows secret bundle");
    prepared = parseExistingFlowsSecrets(await readFile(targetPath, "utf8"));
    assertExactBundle(prepared);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const bundle = buildFlowsVersionSecrets({
    existingSecrets: source,
    preparedSecrets: prepared,
    generateHashKey,
  });
  if (!prepared) {
    const targetDirectory = resolve(targetPath, "..");
    await ensureProtectedDirectory(targetDirectory);
    await writeFile(targetPath, `${JSON.stringify(bundle, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(targetPath, 0o600);
    created = true;
  }
  return {
    schemaVersion: 1,
    mode: "local-protected-flows-version-bundle",
    valuesIncluded: false,
    names: [...FLOWS_VERSION_SECRET_NAMES],
    reusedSecrets: [...FLOWS_REUSED_SECRET_NAMES],
    generatedOnce: ["FLOW_USER_HASH_KEY"],
    forbiddenSecretsPresent: false,
    outputPath: targetPath,
    fileMode: "0600",
    created,
    remoteMutation: false,
  };
}

export async function prepareFlowsObsoleteSecretsFile({ outputPath }) {
  const targetPath = protectedOutputPath(outputPath);
  const expected = { EMAIL_INTERNAL_TOKEN: null };
  let created = false;
  try {
    await assertProtectedRegularFile(
      targetPath,
      "obsolete Flows secret cleanup",
    );
    const parsed = JSON.parse(await readFile(targetPath, "utf8"));
    if (canonicalCleanupJson(parsed) !== canonicalCleanupJson(expected)) {
      throw new Error(
        "Obsolete Flows secret cleanup must contain only EMAIL_INTERNAL_TOKEN set to null",
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await ensureProtectedDirectory(resolve(targetPath, ".."));
    await writeFile(targetPath, `${JSON.stringify(expected, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(targetPath, 0o600);
    created = true;
  }
  return {
    schemaVersion: 1,
    mode: "local-protected-flows-obsolete-secret-cleanup",
    valuesIncluded: false,
    names: ["EMAIL_INTERNAL_TOKEN"],
    nullDeletes: true,
    outputPath: targetPath,
    fileMode: "0600",
    created,
    remoteMutation: false,
  };
}

export async function readProtectedFlowUserHashKey(path) {
  const bundlePath = protectedOutputPath(path);
  await assertProtectedRegularFile(bundlePath, "prepared Flows secret bundle");
  const bundle = parseExistingFlowsSecrets(await readFile(bundlePath, "utf8"));
  assertExactBundle(bundle);
  return bundle.FLOW_USER_HASH_KEY.trim();
}

function assertFlowsVersionScope({ target, targetName, environment }) {
  if (
    targetName !== "mbza-development" ||
    environment !== "development" ||
    target?.target !== targetName ||
    target?.features?.flows !== true ||
    !target?.workers?.flows?.[environment]
  ) {
    throw new Error(
      "Flows version bundle is restricted to enabled MBZA development",
    );
  }
}

function protectedOutputPath(value) {
  const output = resolve(String(value ?? ""));
  const pathFromProtectedRoot = relative(PROTECTED_DIRECTORY, output);
  if (
    !pathFromProtectedRoot ||
    pathFromProtectedRoot.startsWith("..") ||
    resolve(PROTECTED_DIRECTORY, pathFromProtectedRoot) !== output ||
    !output.endsWith(".json")
  ) {
    throw new Error(
      `Flows version secrets must be a JSON file below ${PROTECTED_DIRECTORY}`,
    );
  }
  return output;
}

function validateSecret(name, value) {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (value !== value.trim()) throw new Error(`${name} must not contain surrounding whitespace`);
  const bytes = Buffer.byteLength(value);
  if (bytes < MIN_SECRET_BYTES || bytes > MAX_SECRET_BYTES) {
    throw new Error(`${name} has an unsafe byte length`);
  }
}

function assertExactBundle(bundle) {
  const expected = [...FLOWS_VERSION_SECRET_NAMES].sort();
  const actual = Object.keys(bundle).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Prepared Flows secret bundle must contain exactly three names");
  }
}

function equalSecret(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  return leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes);
}

function canonicalCleanupJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort()));
}

async function assertProtectedRegularFile(path, label) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`${label} permissions must be 0600`);
  }
}

async function ensureProtectedDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(PROTECTED_ROOT, 0o700);
  let current = resolve(path);
  while (current === PROTECTED_ROOT || current.startsWith(`${PROTECTED_ROOT}/`)) {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Protected Flows secret path contains a non-directory or symlink");
    }
    await chmod(current, 0o700);
    if (current === PROTECTED_ROOT) break;
    current = resolve(current, "..");
  }
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const outputPath = args.output ?? resolve(
    PROTECTED_DIRECTORY,
    `${targetName}-flows-${environment}.json`,
  );
  const plan = buildFlowsVersionBundlePlan({
    target,
    targetName,
    environment,
    outputPath,
    versionTag: args["version-tag"] ?? "mbza-flows-project-cutover-v1",
  });
  if (!args.prepare) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (!args["existing-secrets-file"]) {
    throw new Error(
      "--prepare requires --existing-secrets-file with the protected existing INTERNAL_API_TOKEN and FLOW_USER_ENCRYPTION_KEY",
    );
  }
  const receipt = await prepareFlowsVersionSecretsFile({
    existingSecretsFile: args["existing-secrets-file"],
    outputPath,
  });
  const obsoleteReceipt = await prepareFlowsObsoleteSecretsFile({
    outputPath: plan.obsoleteSecretsFile,
  });
  process.stdout.write(`${JSON.stringify({
    ...receipt,
    uploadCommand: plan.uploadCommand,
    obsoleteRemoteSecrets: plan.obsoleteRemoteSecrets,
    obsoleteSecretsFile: plan.obsoleteSecretsFile,
    obsoleteSecretsFileMode: plan.obsoleteSecretsFileMode,
    obsoleteSecretsFileCreated: obsoleteReceipt.created,
    postUploadInactiveCleanupCommand: plan.postUploadInactiveCleanupCommand,
    deployOnlyCleanupVersion: plan.deployOnlyCleanupVersion,
  }, null, 2)}\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
