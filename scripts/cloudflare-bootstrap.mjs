import { readFile, writeFile } from "node:fs/promises";
import { environmentFromArgs, loadTarget, parseArgs } from "./cloudflare-target.mjs";

const args = parseArgs();
const targetName = args.target ?? process.env.OPENGROW_TARGET ?? "vocostar";
const environment = environmentFromArgs(args);
const apply = Boolean(args.apply);
const { path, target } = await loadTarget(targetName);
const resources = target.environments[environment];
const token = process.env.CLOUDFLARE_API_TOKEN;

if (apply && !token) throw new Error("CLOUDFLARE_API_TOKEN is required with --apply");

const planned = [];
const d1 = await ensureNamed("D1 database", resources.d1, "/d1/database", { name: resources.d1.name });
const kv = await ensureNamed("KV namespace", resources.kv, "/storage/kv/namespaces", { title: resources.kv.name });
await ensureNamed("R2 bucket", resources.r2, "/r2/buckets", { name: resources.r2.name });
await ensureNamed("dashboard R2 cache", resources.dashboardCache, "/r2/buckets", { name: resources.dashboardCache.name });

for (const queue of Object.values(resources.queues)) {
  await ensureNamed("queue", { name: queue }, "/queues", { queue_name: queue });
}

if (apply) {
  if (d1?.uuid) resources.d1.id = d1.uuid;
  if (kv?.id) resources.kv.id = kv.id;
  await writeFile(path, `${JSON.stringify(target, null, 2)}\n`);
  console.log(`Updated ${path}`);
} else {
  console.log("Dry run. Re-run with --apply and CLOUDFLARE_API_TOKEN to create missing resources.");
}

for (const item of planned) console.log(`${item.action.padEnd(6)} ${item.type}: ${item.name}`);

async function ensureNamed(type, resource, endpoint, body) {
  if (!apply) {
    planned.push({ action: resource.id ? "reuse" : "ensure", type, name: resource.name });
    return resource.id ? { id: resource.id, uuid: resource.id, name: resource.name } : null;
  }
  const list = await cf(endpoint);
  const items = Array.isArray(list) ? list : list.buckets ?? list.result ?? [];
  const existing = items.find((item) =>
    item.name === resource.name || item.title === resource.name || item.queue_name === resource.name,
  );
  if (existing) {
    planned.push({ action: "reuse", type, name: resource.name });
    return existing;
  }
  const created = await cf(endpoint, { method: "POST", body: JSON.stringify(body) });
  planned.push({ action: "create", type, name: resource.name });
  return created;
}

async function cf(endpoint, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload = JSON.parse(await response.text());
  if (!response.ok || payload.success === false) {
    throw new Error(`Cloudflare ${endpoint}: ${JSON.stringify(payload.errors ?? payload)}`);
  }
  return payload.result;
}
