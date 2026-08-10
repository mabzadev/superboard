#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve4, resolve6 } from "node:dns/promises";
import { access, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";
import { chatwootOriginFromTarget } from "./superboard-chatwoot-export.mjs";

export const CHATWOOT_EXPORT_ENVIRONMENT = Object.freeze([
  { name: "CHATWOOT_ACCOUNT_ID", secret: false, required: true },
  { name: "CHATWOOT_API_ACCESS_TOKEN", secret: true, required: true },
  { name: "CHATWOOT_ATTACHMENT_HOSTS", secret: false, required: false },
]);

export function chatwootCredentialInventory(env = process.env) {
  return CHATWOOT_EXPORT_ENVIRONMENT.map(({ name, secret, required }) => {
    const value = typeof env[name] === "string" ? env[name].trim() : "";
    const configured = value.length > 0;
    return {
      name,
      secret,
      required,
      configured,
      valid: !configured ? !required : validEnvironmentInput(name, value),
    };
  });
}

export function evaluateChatwootReadiness({
  supportEnabled,
  supportProjectIds,
  credentials,
  dns,
  endpoint,
  profile,
  legacyClientFiles = null,
}) {
  const blockers = [];
  if (!supportEnabled) blockers.push("opengrow-support-disabled");
  if (!Array.isArray(supportProjectIds) || supportProjectIds.length === 0) {
    blockers.push("support-projects-missing");
  }
  for (const credential of credentials) {
    if (credential.required && !credential.configured) {
      blockers.push(`environment-missing:${credential.name}`);
    } else if (credential.configured && !credential.valid) {
      blockers.push(`environment-invalid:${credential.name}`);
    }
  }
  if (dns.status !== "resolved") blockers.push("chatwoot-dns-unresolved");
  if (endpoint.status !== "reachable")
    blockers.push("chatwoot-endpoint-unreachable");
  if (profile.status !== "authenticated")
    blockers.push("chatwoot-token-unverified");

  const clientInspected = Array.isArray(legacyClientFiles);
  const clientFiles = clientInspected ? legacyClientFiles : [];
  const retirementBlockers = [];
  if (!clientInspected) retirementBlockers.push("client-source-not-inspected");
  if (clientFiles.length > 0)
    retirementBlockers.push("legacy-client-code-present");

  return {
    ready_for_export: blockers.length === 0,
    ready_for_retirement: false,
    blockers,
    client_migration: {
      inspected: clientInspected,
      required: clientInspected ? clientFiles.length > 0 : null,
      legacy_file_count: clientInspected ? clientFiles.length : null,
      files: clientFiles,
    },
    retirement_blockers: retirementBlockers,
    retirement_gate:
      "Requires protected export, four backup receipts, verified OpenGrow import, client migration, rollback rehearsal and retention sign-off",
  };
}

function validEnvironmentInput(name, value) {
  if (name === "CHATWOOT_ACCOUNT_ID") return /^[1-9][0-9]*$/u.test(value);
  if (name === "CHATWOOT_ATTACHMENT_HOSTS") {
    return value
      .split(",")
      .every((item) =>
        /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/iu.test(item.trim()),
      );
  }
  return value.length > 0;
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const resources = target.environments?.[environment];
  if (!resources)
    throw new Error(`Target ${targetName} does not define ${environment}`);

  const origin = chatwootOriginFromTarget(target);
  const hostname = new URL(origin).hostname;
  const credentials = chatwootCredentialInventory();
  const dns = await inspectDns(hostname);
  const endpoint =
    dns.status === "resolved"
      ? await inspectEndpoint(origin)
      : { status: "not-checked", http_status: null };
  const tokenConfigured = credentials.find(
    ({ name }) => name === "CHATWOOT_API_ACCESS_TOKEN",
  )?.configured;
  const profile =
    endpoint.status === "reachable" && tokenConfigured
      ? await inspectProfile(origin, process.env.CHATWOOT_API_ACCESS_TOKEN)
      : { status: "not-checked", http_status: null };
  const legacyClientFiles = args["client-root"]
    ? await scanLegacyClient(args["client-root"])
    : null;
  const readiness = evaluateChatwootReadiness({
    supportEnabled: target.features?.support === true,
    supportProjectIds: resources.supportProjectIds,
    credentials,
    dns,
    endpoint,
    profile,
    legacyClientFiles,
  });
  const report = {
    schema_version: 2,
    mode: "read-only",
    values_included: false,
    target: targetName,
    environment,
    source: {
      provider: "chatwoot",
      origin,
      hostname,
      dns,
      endpoint,
      profile,
    },
    destination: {
      service: "opengrow-support",
      project_ids: resources.supportProjectIds ?? [],
      database_name: resources.moduleD1?.support?.name ?? null,
      bucket_name: resources.moduleR2?.support?.name ?? null,
    },
    credentials,
    ...readiness,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready_for_export) process.exitCode = 2;
}

async function inspectDns(hostname) {
  const [ipv4, ipv6] = await Promise.all([
    resolve4(hostname).catch(() => []),
    resolve6(hostname).catch(() => []),
  ]);
  return {
    status: ipv4.length > 0 || ipv6.length > 0 ? "resolved" : "unresolved",
    ipv4_count: ipv4.length,
    ipv6_count: ipv6.length,
  };
}

async function inspectEndpoint(origin) {
  try {
    const response = await fetch(origin, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html,application/json;q=0.8" },
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return {
      status:
        response.status >= 200 && response.status < 500
          ? "reachable"
          : "unavailable",
      http_status: response.status,
    };
  } catch {
    return { status: "unavailable", http_status: null };
  }
}

async function inspectProfile(origin, accessToken) {
  try {
    const response = await fetch(new URL("/api/v1/profile", origin), {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        api_access_token: accessToken,
      },
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return {
      status:
        response.status >= 200 && response.status < 300
          ? "authenticated"
          : "rejected",
      http_status: response.status,
    };
  } catch {
    return { status: "unavailable", http_status: null };
  }
}

export async function scanLegacyClient(value) {
  if (!isAbsolute(value))
    throw new Error("--client-root must be an absolute path");
  const clientRoot = resolve(value);
  await access(clientRoot);
  const result = spawnSync(
    "rg",
    [
      "--files-with-matches",
      "--ignore-case",
      "--hidden",
      "--no-ignore",
      "--glob",
      "!**/.git/**",
      "--glob",
      "!**/.env",
      "--glob",
      "!**/.flutterflow/**",
      "--glob",
      "!**/.ffai_staging/**",
      "--glob",
      "!**/build/**",
      "--glob",
      "!**/.dart_tool/**",
      "--glob",
      "!**/node_modules/**",
      "--glob",
      "!**/references/**",
      "--glob",
      "!**/test/**",
      "--glob",
      "*.dart",
      "chatwoot|openchat|sup\\.vocostar\\.com|SupportChatWidget|supportInit|supportFetchMessages|supportSendMessage",
      clientRoot,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    },
  );
  if (![0, 1].includes(result.status)) {
    return scanLegacyClientWithoutRipgrep(clientRoot);
  }
  return String(result.stdout || "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((path) => relative(clientRoot, path))
    .sort()
    .slice(0, 500);
}

const ignoredClientDirectories = new Set([
  ".git",
  ".flutterflow",
  ".ffai_staging",
  "build",
  ".dart_tool",
  "node_modules",
  "references",
  "test",
]);
const legacyClientPattern =
  /chatwoot|openchat|sup\.vocostar\.com|SupportChatWidget|supportInit|supportFetchMessages|supportSendMessage/iu;

export async function scanLegacyClientWithoutRipgrep(clientRoot) {
  const matches = [];

  async function walk(directory) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (matches.length >= 500 || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredClientDirectories.has(entry.name)) await walk(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".dart")) continue;
      if (legacyClientPattern.test(await readFile(path, "utf8"))) {
        matches.push(relative(clientRoot, path));
      }
    }
  }

  await walk(clientRoot);
  return matches.sort();
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  await main();
}
