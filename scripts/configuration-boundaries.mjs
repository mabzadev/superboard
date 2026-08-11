#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  DOMAIN_SERVICE_REGISTRY,
  PLATFORM_SERVICE_SECRETS,
} from "./cloudflare-services.mjs";

export const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const defaultContractPath = "config/configuration-boundaries.json";
const cloudflareUuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const cloudflareHexIdPattern = /^[a-f0-9]{32}$/iu;
const secretLikeNamePattern =
  /(?:^|_)(?:API_KEY|CREDENTIALS?|ENCRYPTION_KEY|KEYSET|PASSWORD|PRIVATE_KEY|SECRET|SIGNING_KEY|TOKEN)$/u;
const commonLogicalServiceNames = new Set(
  [
    ...Object.keys(PLATFORM_SERVICE_SECRETS),
    ...Object.keys(DOMAIN_SERVICE_REGISTRY),
  ].map((service) => `opengrow-${service}`),
);

export async function auditConfigurationBoundaries({
  workspaceRoot = root,
  contractPath = defaultContractPath,
} = {}) {
  const errors = [];
  const contract = await readJson(resolve(workspaceRoot, contractPath));
  const contractSchema = await readJson(
    resolve(workspaceRoot, "schemas/configuration-boundaries.schema.json"),
  );
  validateJson(contract, contractSchema, "configuration boundary contract");
  await assertAuthorityPathsExist(workspaceRoot, contract, errors);

  const targetDirectory = contract.authorities.applications.targetDirectory;
  const targetSchema = await readJson(
    resolve(workspaceRoot, contract.authorities.applications.targetSchema),
  );
  const targets = await loadTargets(
    workspaceRoot,
    targetDirectory,
    targetSchema,
  );
  const project = await readJson(
    resolve(workspaceRoot, contract.authorities.sharedPlatform.projectManifest),
  );
  const referenceTargetName = String(project.development?.target ?? "").trim();
  const referenceTarget = targets.find(
    ({ target }) => target.target === referenceTargetName,
  );
  if (!referenceTargetName || !referenceTarget) {
    errors.push(
      "superboard.project.json development.target must select one existing reference target",
    );
  }

  if (referenceTarget) {
    validateReferenceTarget(referenceTarget, contract, errors);
  }
  if (targets.length < 2) {
    errors.push(
      "At least one application target in addition to the MBZA reference target is required",
    );
  }

  const secretNames = collectSecretBindingNames(
    targets.map(({ target }) => target),
  );
  validateTargetInjectionBoundaries(targets, secretNames, errors);
  await validateWranglerSecretBoundaries(
    workspaceRoot,
    contract,
    secretNames,
    errors,
  );

  const ownership = buildTargetOwnership(targets, referenceTargetName);
  await validateRootCommandPortability(workspaceRoot, targets, errors);
  const sharedFiles = await sharedRuntimeFiles(
    workspaceRoot,
    contract,
    targets,
  );
  const occurrences = await scanSharedRuntime(
    workspaceRoot,
    sharedFiles,
    ownership,
  );
  errors.push(...occurrences.map(formatOccurrence));

  const referenceSummary = referenceTarget
    ? summarizeTarget(referenceTarget.target, "reference")
    : null;
  const applicationSummaries = targets
    .filter(({ target }) => target.target !== referenceTargetName)
    .map(({ target }) => summarizeTarget(target, "application"));
  const report = {
    schemaVersion: 1,
    valid: errors.length === 0,
    errors,
    classification: {
      shared: {
        serviceRegistry: contract.authorities.sharedPlatform.serviceRegistry,
        runtimeRoots: contract.authorities.sharedPlatform.runtimeRoots,
        logicalServices: [
          ...Object.keys(PLATFORM_SERVICE_SECRETS),
          ...Object.keys(DOMAIN_SERVICE_REGISTRY),
        ].sort(),
        scannedFiles: sharedFiles.length,
      },
      reference: referenceSummary,
      applications: applicationSummaries,
      injected: {
        accountId: {
          defaultEnvironmentName:
            contract.injection.accountId.defaultEnvironmentName,
          scopedEnvironmentPrefix:
            contract.injection.accountId.scopedEnvironmentPrefix,
          storedInTargetManifest: false,
        },
        deploymentCredentialEnvironmentNames:
          contract.injection.deploymentCredentialEnvironmentNames,
        projectCredentialEnvironmentNames:
          contract.injection.projectCredentialEnvironmentNames,
        secretBindings: [...secretNames].sort(),
        secretValuesStoredInTargetOrWranglerVars: false,
      },
    },
  };
  return report;
}

export function collectSecretBindingNames(targets) {
  const names = new Set();
  for (const serviceNames of Object.values(PLATFORM_SERVICE_SECRETS)) {
    for (const name of serviceNames) names.add(name);
  }
  for (const definition of Object.values(DOMAIN_SERVICE_REGISTRY)) {
    for (const name of definition.secrets) names.add(name);
  }
  for (const target of targets) {
    for (const name of target.customWorker?.secrets ?? []) names.add(name);
  }
  return names;
}

export function findForbiddenSharedOccurrences({ path, source, ownership }) {
  const occurrences = [];
  const ownedValues = new Set(
    ownership.exactLiterals.map(({ value }) => value.toLowerCase()),
  );
  for (const suffix of ownership.domainSuffixes) {
    const pattern = new RegExp(
      `(?:[a-z0-9-]+\\.)*${escapePattern(suffix)}\\b`,
      "giu",
    );
    for (const match of source.matchAll(pattern)) {
      occurrences.push(
        occurrence(path, source, match.index, "target-domain", match[0]),
      );
    }
  }
  for (const record of ownership.exactLiterals) {
    let offset = source.indexOf(record.value);
    while (offset !== -1) {
      occurrences.push(
        occurrence(
          path,
          source,
          offset,
          record.kind,
          record.value,
          record.target,
        ),
      );
      offset = source.indexOf(record.value, offset + record.value.length);
    }
  }
  const workersDevHost = /(?:[a-z0-9-]+\.)+workers\.dev\b/giu;
  for (const match of source.matchAll(workersDevHost)) {
    occurrences.push(
      occurrence(path, source, match.index, "workers-dev-host", match[0]),
    );
  }
  const quotedCloudflareId =
    /["']([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})["']/giu;
  for (const match of source.matchAll(quotedCloudflareId)) {
    const value = match[1];
    if (
      ownedValues.has(value.toLowerCase()) ||
      /^0{32}$/u.test(value) ||
      /^0{8}-0{4}-[0-9a-f]{4}-[0-9a-f]{4}-0{12}$/iu.test(value)
    ) {
      continue;
    }
    occurrences.push(
      occurrence(
        path,
        source,
        (match.index ?? 0) + 1,
        "unowned-cloudflare-id",
        value,
      ),
    );
  }
  const workstationPath = /(?:^|["'`\s])\/Users\/[A-Za-z0-9._-]+\//gmu;
  for (const match of source.matchAll(workstationPath)) {
    occurrences.push(
      occurrence(
        path,
        source,
        match.index,
        "workstation-path",
        match[0].trim(),
      ),
    );
  }
  const accountAssignment =
    /(?:account_id|accountId)\s*[:=]\s*["'][a-f0-9]{32}["']/giu;
  for (const match of source.matchAll(accountAssignment)) {
    occurrences.push(
      occurrence(path, source, match.index, "cloudflare-account-id", match[0]),
    );
  }
  return deduplicateOccurrences(occurrences);
}

function validateReferenceTarget(reference, contract, errors) {
  const target = reference.target;
  const referenceContract = contract.authorities.reference;
  const environments = Object.keys(target.environments ?? {});
  if (
    environments.length !== 1 ||
    environments[0] !== referenceContract.requiredEnvironment
  ) {
    errors.push(
      `${reference.path} must isolate the reference profile in development only`,
    );
  }
  if (target.mail?.transport !== referenceContract.requiredMailTransport) {
    errors.push(
      `${reference.path} must use capture mail and cannot carry production SMTP credentials`,
    );
  }
  const suffix = registrableConfigurationSuffix(target.domains?.api);
  if (!suffix) {
    errors.push(
      `${reference.path} domains.api must define the reference domain`,
    );
    return;
  }
  for (const [role, hostname] of Object.entries(target.domains ?? {})) {
    if (!hostnameBelongsToSuffix(hostname, suffix)) {
      errors.push(`${reference.path} domains.${role} must belong to ${suffix}`);
    }
  }
  const apiOrigin = `https://${target.domains?.api ?? ""}`;
  if (target.authGateway?.issuer !== apiOrigin) {
    errors.push(
      `${reference.path} authGateway.issuer must derive from domains.api`,
    );
  }
  if (target.authGateway?.jwksUrl !== `${apiOrigin}/.well-known/jwks.json`) {
    errors.push(
      `${reference.path} authGateway.jwksUrl must derive from domains.api`,
    );
  }
  for (const address of [
    target.mail?.fromAddress,
    target.mail?.replyToAddress,
  ]) {
    if (
      address &&
      !hostnameBelongsToSuffix(address.split("@").at(-1), suffix)
    ) {
      errors.push(`${reference.path} mail addresses must belong to ${suffix}`);
    }
  }
}

function validateTargetInjectionBoundaries(targets, secretNames, errors) {
  for (const { path, target } of targets) {
    const forbiddenAccountPaths = findObjectKeys(target, (key) =>
      new Set(["accountId", "account_id"]).has(key),
    );
    for (const keyPath of forbiddenAccountPaths) {
      errors.push(
        `${path} ${keyPath} stores a Cloudflare account id; inject it through the scoped environment binding`,
      );
    }
    for (const [name, value] of Object.entries(
      target.customWorker?.vars ?? {},
    )) {
      if (secretNames.has(name) || secretLikeNamePattern.test(name)) {
        errors.push(
          `${path} customWorker.vars.${name} is secret-like; declare the binding name in customWorker.secrets and inject its value`,
        );
      }
      if (looksLikeCredentialValue(value)) {
        errors.push(
          `${path} customWorker.vars.${name} resembles a credential value and cannot be committed`,
        );
      }
    }
  }
}

async function validateWranglerSecretBoundaries(
  workspaceRoot,
  contract,
  secretNames,
  errors,
) {
  const workerRoot = resolve(workspaceRoot, "workers");
  const files = await recursiveFiles(workerRoot, contract, workspaceRoot);
  for (const absolutePath of files.filter((path) =>
    /(?:^|\/)wrangler(?:\.test)?\.jsonc$/u.test(
      normalizePath(relative(workspaceRoot, path)),
    ),
  )) {
    const path = normalizePath(relative(workspaceRoot, absolutePath));
    const parsed = parseJsonc(await readFile(absolutePath, "utf8"), path);
    for (const [name, value] of Object.entries(parsed.vars ?? {})) {
      if (secretNames.has(name) || secretLikeNamePattern.test(name)) {
        errors.push(
          `${path} vars.${name} is a secret binding; inject it through Worker secrets or the test runtime`,
        );
      }
      if (looksLikeCredentialValue(value)) {
        errors.push(`${path} vars.${name} resembles a committed credential`);
      }
    }
  }
}

function buildTargetOwnership(targets, referenceTargetName) {
  const exact = new Map();
  const domainSuffixes = new Set();
  for (const { target } of targets) {
    const targetName = target.target;
    for (const hostname of Object.values(target.domains ?? {})) {
      addExact(exact, hostname, "target-host", targetName);
      domainSuffixes.add(registrableConfigurationSuffix(hostname));
    }
    addExact(
      exact,
      `${target.workersDevSubdomain}.workers.dev`,
      "workers-dev-host",
      targetName,
    );
    for (const [service, names] of Object.entries(target.workers ?? {})) {
      for (const workerName of Object.values(names ?? {})) {
        if (workerName !== `opengrow-${service}`) {
          addExact(exact, workerName, "worker-name", targetName);
        }
      }
    }
    for (const binding of target.customWorker?.serviceBindings ?? []) {
      for (const workerName of Object.values(binding.workers ?? {})) {
        const commonServiceName = Object.keys(target.workers ?? {}).some(
          (service) => workerName === `opengrow-${service}`,
        );
        if (!commonServiceName) {
          addExact(exact, workerName, "service-binding-worker", targetName);
        }
      }
    }
    for (const environment of Object.values(target.environments ?? {})) {
      const resources = environmentResourceValues(environment);
      for (const value of resources.ids) {
        addExact(exact, value, "cloudflare-resource-id", targetName);
      }
      for (const value of resources.names) {
        if (!commonLogicalServiceNames.has(value)) {
          addExact(exact, value, "cloudflare-resource-name", targetName);
        }
      }
    }
    for (const value of [
      target.applicationIdentity?.applicationAudience,
      ...(target.applicationIdentity?.googleAudiences ?? []),
      ...(target.applicationIdentity?.appleAudiences ?? []),
      target.oauth?.dashboardClientId,
    ]) {
      addExact(exact, value, "application-identity", targetName);
    }
  }
  return {
    referenceTargetName,
    domainSuffixes: [...domainSuffixes].filter(Boolean).sort(),
    exactLiterals: [...exact.values()].sort(
      (left, right) =>
        right.value.length - left.value.length ||
        left.value.localeCompare(right.value),
    ),
  };
}

async function validateRootCommandPortability(workspaceRoot, targets, errors) {
  const manifest = await readJson(resolve(workspaceRoot, "package.json"));
  for (const finding of findHardcodedTargetCommands(
    manifest.scripts ?? {},
    targets.map(({ target }) => target.target),
  )) {
    errors.push(
      `package.json scripts.${finding.script} hardcodes target ${finding.target}; select it from a target manifest or an injected operator argument`,
    );
  }
}

export function findHardcodedTargetCommands(scripts, targetNames) {
  const findings = [];
  for (const [script, command] of Object.entries(scripts)) {
    for (const target of targetNames) {
      const hardcodedSelection = new RegExp(
        `--target(?:=|\\s+)${escapePattern(target)}(?:\\s|$)`,
        "u",
      );
      if (hardcodedSelection.test(command)) findings.push({ script, target });
    }
  }
  return findings;
}

async function sharedRuntimeFiles(workspaceRoot, contract, targets) {
  const applicationRoots = targets
    .map(({ target }) => target.customWorker?.packagePath)
    .filter(Boolean);
  const paths = [];
  for (const relativeRoot of contract.authorities.sharedPlatform.runtimeRoots) {
    const absoluteRoot = resolve(workspaceRoot, relativeRoot);
    for (const path of await recursiveFiles(
      absoluteRoot,
      contract,
      workspaceRoot,
    )) {
      const relativePath = normalizePath(relative(workspaceRoot, path));
      if (!contract.scan.portableExtensions.includes(extname(relativePath)))
        continue;
      if (isLocalOnly(relativePath, contract)) continue;
      if (
        applicationRoots.some((rootPath) =>
          isPathInside(relativePath, rootPath),
        )
      ) {
        continue;
      }
      paths.push(path);
    }
  }
  return [...new Set(paths)].sort();
}

async function scanSharedRuntime(workspaceRoot, files, ownership) {
  const occurrences = [];
  for (const absolutePath of files) {
    const path = normalizePath(relative(workspaceRoot, absolutePath));
    const source = await readFile(absolutePath, "utf8");
    occurrences.push(
      ...findForbiddenSharedOccurrences({ path, source, ownership }),
    );
  }
  return occurrences;
}

function summarizeTarget(target, classification) {
  const resources = Object.values(target.environments ?? {});
  const ids = new Set();
  const names = new Set();
  for (const environment of resources) {
    const values = environmentResourceValues(environment);
    for (const value of values.ids) ids.add(value);
    for (const value of values.names) names.add(value);
  }
  return {
    classification,
    target: target.target,
    environments: Object.keys(target.environments ?? {}).sort(),
    domains: Object.keys(target.domains ?? {}).sort(),
    workers: nestedStringValues(target.workers ?? {}).length,
    cloudflareResourceIds: ids.size,
    cloudflareResourceNames: names.size,
    customWorker: target.customWorker?.packagePath ?? null,
  };
}

async function loadTargets(workspaceRoot, targetDirectory, schema) {
  const absoluteDirectory = resolve(workspaceRoot, targetDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const targets = [];
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".json") ||
      entry.name === "schema.json"
    ) {
      continue;
    }
    const path = normalizePath(`${targetDirectory}/${entry.name}`);
    const target = await readJson(resolve(absoluteDirectory, entry.name));
    validateJson(target, schema, path);
    if (target.target !== entry.name.slice(0, -5)) {
      throw new Error(`${path} target must match its file name`);
    }
    targets.push({ path, target });
  }
  return targets.sort((left, right) =>
    left.target.target.localeCompare(right.target.target),
  );
}

async function assertAuthorityPathsExist(workspaceRoot, contract, errors) {
  const paths = [
    contract.authorities.sharedPlatform.serviceRegistry,
    contract.authorities.sharedPlatform.projectManifest,
    ...contract.authorities.sharedPlatform.runtimeRoots,
    contract.authorities.applications.targetDirectory,
    contract.authorities.applications.targetSchema,
    ...contract.authorities.applications.derivedProjectionPaths,
    ...contract.scan.localWranglerTemplates,
  ];
  for (const path of paths) {
    try {
      await stat(resolve(workspaceRoot, path));
    } catch {
      errors.push(`Configuration authority path does not exist: ${path}`);
    }
  }
}

async function recursiveFiles(directory, contract, workspaceRoot) {
  const result = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    const relativePath = normalizePath(relative(workspaceRoot, absolutePath));
    if (entry.isDirectory()) {
      if (isIgnoredDirectory(relativePath, entry.name, contract)) continue;
      result.push(
        ...(await recursiveFiles(absolutePath, contract, workspaceRoot)),
      );
    } else if (
      entry.isFile() &&
      !contract.scan.ignoredFileSuffixes.some((suffix) =>
        entry.name.endsWith(suffix),
      )
    ) {
      result.push(absolutePath);
    }
  }
  return result;
}

export function isIgnoredDirectory(relativePath, name, contract) {
  return contract.scan.ignoredDirectoryNames.some(
    (ignored) =>
      name === ignored ||
      relativePath === ignored ||
      relativePath.startsWith(`${ignored}/`),
  );
}

export function isLocalOnly(path, contract) {
  const normalized = normalizePath(path);
  const surrounded = `/${normalized.toLowerCase()}/`;
  return (
    contract.scan.localOnlyPathSegments.some((segment) =>
      surrounded.includes(segment.toLowerCase()),
    ) ||
    contract.scan.localOnlyFileMarkers.some((marker) =>
      normalized.toLowerCase().includes(marker.toLowerCase()),
    ) ||
    contract.scan.localWranglerTemplates.includes(normalized)
  );
}

function addExact(records, value, kind, target) {
  if (typeof value !== "string" || value.length < 8 || value === "opengrow")
    return;
  const key = `${kind}\0${value}`;
  if (!records.has(key)) records.set(key, { value, kind, target });
}

function environmentResourceValues(environment) {
  const ids = new Set();
  const names = new Set();
  function visit(value, keys = []) {
    if (typeof value === "string") {
      if (
        cloudflareUuidPattern.test(value) ||
        cloudflareHexIdPattern.test(value)
      ) {
        ids.add(value);
        return;
      }
      const key = keys.at(-1);
      if (
        key === "name" ||
        key === "dlq" ||
        key === "analyticsDataset" ||
        keys.includes("queues") ||
        keys.includes("moduleQueues")
      ) {
        names.add(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child, keys);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        visit(child, [...keys, key]);
      }
    }
  }
  visit(environment);
  return { ids, names };
}

function nestedStringValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(nestedStringValues);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(nestedStringValues);
  }
  return [];
}

function registrableConfigurationSuffix(hostname) {
  const parts = String(hostname).toLowerCase().split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : "";
}

function hostnameBelongsToSuffix(hostname, suffix) {
  const normalized = String(hostname ?? "").toLowerCase();
  return normalized === suffix || normalized.endsWith(`.${suffix}`);
}

function occurrence(path, source, offset, kind, value, target = null) {
  const prefix = source.slice(0, Math.max(0, offset));
  return {
    path,
    line: prefix.split("\n").length,
    kind,
    value,
    target,
  };
}

function deduplicateOccurrences(occurrences) {
  const result = new Map();
  for (const entry of occurrences) {
    result.set(
      `${entry.path}:${entry.line}:${entry.kind}:${entry.value}`,
      entry,
    );
  }
  return [...result.values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line,
  );
}

function formatOccurrence(entry) {
  const owner = entry.target ? ` owned by target ${entry.target}` : "";
  return `${entry.path}:${entry.line} hardcodes ${entry.kind}${owner}: ${entry.value}`;
}

function findObjectKeys(value, predicate, path = "") {
  if (!value || typeof value !== "object") return [];
  const results = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (predicate(key)) results.push(childPath);
    results.push(...findObjectKeys(child, predicate, childPath));
  }
  return results;
}

function looksLikeCredentialValue(value) {
  if (typeof value !== "string") return false;
  return (
    /^(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{12,}$/u.test(value) ||
    /^-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/u.test(value)
  );
}

function parseJsonc(source, label) {
  try {
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "")
      .replace(/,\s*([}\]])/gu, "$1");
    return JSON.parse(withoutComments);
  } catch (error) {
    throw new Error(`${label} is not valid JSONC: ${error.message}`);
  }
}

function validateJson(value, schema, label) {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    schema,
  );
  if (!validate(value)) {
    const detail = validate.errors
      ?.map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    throw new Error(`${label} is invalid: ${detail}`);
  }
}

function isPathInside(path, parent) {
  return path === parent || path.startsWith(`${normalizePath(parent)}/`);
}

function normalizePath(path) {
  return path.split(sep).join("/").replace(/^\.\//u, "");
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const json = process.argv.includes("--json");
  const report = await auditConfigurationBoundaries();
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const reference = report.classification.reference;
    console.log(
      `Configuration boundaries: ${report.valid ? "valid" : "invalid"}`,
    );
    console.log(
      `Shared runtime: ${report.classification.shared.scannedFiles} files, ${report.classification.shared.logicalServices.length} logical services`,
    );
    if (reference) {
      console.log(
        `Reference: ${reference.target} (${reference.cloudflareResourceIds} Cloudflare ids, ${reference.workers} Workers)`,
      );
    }
    for (const application of report.classification.applications) {
      console.log(
        `Application: ${application.target} (${application.cloudflareResourceIds} Cloudflare ids, ${application.workers} Workers)`,
      );
    }
    console.log(
      `Injected secrets: ${report.classification.injected.secretBindings.length} binding names, zero values in target/vars config`,
    );
    for (const error of report.errors) console.error(`- ${error}`);
  }
  if (!report.valid) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
