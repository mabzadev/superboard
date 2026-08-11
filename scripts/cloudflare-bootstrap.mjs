#!/usr/bin/env node
import { rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyCloudflareBootstrapPlan,
  buildCloudflareBootstrapPlan,
  cloudflareResourceKind,
  desiredCloudflareResources,
} from "./cloudflare-bootstrap-core.mjs";
import {
  cloudflareAccountId,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

const MAX_API_RESPONSE_BYTES = 8 * 1024 * 1024;

export async function fetchCloudflareBootstrapInventories({
  accountId,
  token,
  fetchImpl = fetch,
}) {
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required for --remote");
  const client = cloudflareClient({ accountId, token, fetchImpl });
  const [d1, kv, r2, queue] = await Promise.all([
    client.listPaged("/d1/database"),
    client.listPaged("/storage/kv/namespaces"),
    client.listR2Buckets(),
    client.listPaged("/queues"),
  ]);
  return { d1, kv, r2, queue };
}

export function cloudflareClient({ accountId, token, fetchImpl = fetch }) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
  const request = async (endpoint, init = {}) => {
    const response = await fetchImpl(`${base}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const payload = await readJsonLimited(response, MAX_API_RESPONSE_BYTES);
    if (!response.ok || payload.success === false) {
      throw new Error(
        `Cloudflare ${endpoint}: ${JSON.stringify(payload.errors ?? { status: response.status })}`,
      );
    }
    return payload;
  };
  return {
    async listPaged(endpoint) {
      const items = [];
      for (let page = 1; page <= 10_000; page += 1) {
        const separator = endpoint.includes("?") ? "&" : "?";
        const payload = await request(
          `${endpoint}${separator}page=${page}&per_page=1000`,
        );
        if (!Array.isArray(payload.result)) {
          throw new Error(`Cloudflare ${endpoint} returned a non-array result`);
        }
        items.push(...payload.result);
        const totalPages = Number(payload.result_info?.total_pages ?? 0);
        const totalCount = Number(payload.result_info?.total_count ?? 0);
        if (totalPages > 0 ? page >= totalPages : items.length >= totalCount) {
          return items;
        }
        if (payload.result.length === 0) return items;
      }
      throw new Error(`Cloudflare ${endpoint} pagination exceeded 10000 pages`);
    },
    async listR2Buckets() {
      const items = [];
      const cursors = new Set();
      let cursor = "";
      while (true) {
        const suffix = cursor
          ? `?per_page=1000&cursor=${encodeURIComponent(cursor)}`
          : "?per_page=1000";
        const payload = await request(`/r2/buckets${suffix}`);
        const buckets = payload.result?.buckets;
        if (!Array.isArray(buckets)) {
          throw new Error("Cloudflare /r2/buckets returned an invalid result");
        }
        items.push(...buckets);
        const next = String(payload.result_info?.cursor ?? "");
        if (!next) return items;
        if (cursors.has(next)) {
          throw new Error("Cloudflare R2 pagination repeated a cursor");
        }
        cursors.add(next);
        cursor = next;
      }
    },
    async create(operation) {
      const definition = cloudflareResourceKind(operation.kind);
      if (operation.endpoint !== definition.endpoint) {
        throw new Error(`Unexpected endpoint for ${operation.kind}`);
      }
      const payload = await request(operation.endpoint, {
        method: "POST",
        body: JSON.stringify(operation.body),
      });
      return payload.result;
    },
  };
}

async function readJsonLimited(response, maxBytes) {
  const announced = Number(response.headers.get("content-length") ?? 0);
  if (announced > maxBytes) {
    throw new Error(
      "Cloudflare API response exceeded the configured byte limit",
    );
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Cloudflare API response too large");
        throw new Error(
          "Cloudflare API response exceeded the configured byte limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return text ? JSON.parse(text) : {};
}

function offlineReport(target, environment) {
  return {
    schemaVersion: 1,
    mode: "offline-desired-state",
    target: target.target,
    accountAlias: target.accountAlias,
    environment,
    remoteInspected: false,
    ready: false,
    resources: desiredCloudflareResources(target, environment).map(
      ({
        key,
        kind,
        label,
        name,
        logicalName,
        physicalName,
        previousNames,
        migrationStrategy,
        manifestId,
      }) => ({
        key,
        kind,
        label,
        name,
        logicalName,
        physicalName,
        previousNames,
        migrationStrategy,
        manifestIdConfigured: Boolean(manifestId),
        state: "not-inspected",
      }),
    ),
    action:
      "Re-run with --remote and scoped credentials to build the exact drift-checked plan.",
  };
}

async function writeTargetAtomically(path, target) {
  const temporary = `${path}.bootstrap-${process.pid}.tmp`;
  const mode = (await stat(path)).mode & 0o777;
  await writeFile(temporary, `${JSON.stringify(target, null, 2)}\n`, {
    mode,
  });
  await rename(temporary, path);
}

function optionValue(args, name) {
  const value = args[name];
  return typeof value === "string" ? value : null;
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { path, target } = await loadTarget(targetName);
  if (!args.remote && !args.apply) {
    process.stdout.write(
      `${JSON.stringify(offlineReport(target, environment), null, 2)}\n`,
    );
    return;
  }
  const accountId = cloudflareAccountId(target);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const client = cloudflareClient({ accountId, token });
  const inventories = await fetchCloudflareBootstrapInventories({
    accountId,
    token,
  });
  const plan = buildCloudflareBootstrapPlan({
    target,
    environment,
    accountId,
    inventories,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!args.apply) {
    if (!plan.ready) process.exitCode = 2;
    return;
  }
  const applied = await applyCloudflareBootstrapPlan(plan, target, {
    confirm: optionValue(args, "confirm"),
    create: (operation) => client.create(operation),
  });
  await writeTargetAtomically(path, target);
  process.stdout.write(
    `${JSON.stringify({ mode: "applied", target: targetName, environment, applied }, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
