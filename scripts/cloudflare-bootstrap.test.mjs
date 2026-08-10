import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCloudflareBootstrapPlan,
  buildCloudflareBootstrapPlan,
  cloudflareBootstrapConfirmation,
  desiredCloudflareResources,
} from "./cloudflare-bootstrap-core.mjs";
import { fetchCloudflareBootstrapInventories } from "./cloudflare-bootstrap.mjs";
import { loadTarget } from "./cloudflare-target.mjs";
import { targetWithoutResourceIds } from "./cloudflare-test-fixtures.mjs";

test("bootstrap inventory is derived from enabled target features", async () => {
  const { target } = await loadTarget("mbza-development");
  const resources = desiredCloudflareResources(target, "development");
  assert.equal(new Set(resources.map(({ key }) => key)).size, resources.length);
  assert.equal(
    new Set(resources.map(({ kind, name }) => `${kind}:${name}`)).size,
    resources.length,
  );
  assert.equal(
    resources.some(({ key }) => key === "messagingD1"),
    false,
  );
  assert.equal(
    resources.some(({ key }) => key === "messagingR2"),
    false,
  );
  assert.equal(
    resources.some(({ key }) => key === "moduleD1.marketing"),
    true,
  );
  assert.equal(
    resources.some(({ key }) => key === "moduleQueues.support.dlq"),
    true,
  );
});

test("VocoStar bootstrap owns the legacy media bucket used by managed Workers", async () => {
  const { target } = await loadTarget("vocostar");
  const resources = desiredCloudflareResources(target, "production");
  assert.ok(
    resources.some(
      ({ key, name }) =>
        key === "customR2" &&
        name === target.environments.production.customR2.name,
    ),
  );
});

test("remote resources with missing manifest ids are adopted without creation", async () => {
  const { target: source } = await loadTarget("mbza-development");
  const target = targetWithoutResourceIds(source, "development");
  const desired = desiredCloudflareResources(target, "development");
  const plan = buildCloudflareBootstrapPlan({
    target,
    environment: "development",
    accountId: "a".repeat(32),
    inventories: inventoriesFor(desired),
  });
  assert.equal(plan.blockers.length, 0);
  assert.equal(
    plan.operations.filter(({ type }) => type === "create").length,
    0,
  );
  assert.equal(
    plan.operations.filter(({ type }) => type === "adopt").length,
    13,
  );
  assert.equal(JSON.stringify(plan).includes("a".repeat(32)), false);
  assert.match(
    plan.confirmation,
    /^CLOUDFLARE:BOOTSTRAP:mbza-development:development:[a-f0-9]{12}$/u,
  );
  assert.equal(plan.confirmation, cloudflareBootstrapConfirmation(plan));
});

test("configured ids are fail-closed when Cloudflare reports another name", async () => {
  const { target: source } = await loadTarget("vocostar");
  const target = structuredClone(source);
  const desired = desiredCloudflareResources(target, "production");
  const inventories = inventoriesFor(desired);
  const central = inventories.d1.find(
    ({ uuid }) => uuid === target.environments.production.d1.id,
  );
  central.name = "wrong-database-name";
  const plan = buildCloudflareBootstrapPlan({
    target,
    environment: "production",
    accountId: "b".repeat(32),
    inventories,
  });
  assert.equal(plan.applicable, false);
  assert.ok(
    plan.blockers.some(
      ({ type, key }) =>
        type === "configured-resource-name-mismatch" && key === "d1",
    ),
  );
  await assert.rejects(
    applyCloudflareBootstrapPlan(plan, target, {
      confirm: plan.confirmation,
      create: async () => ({}),
    }),
    /drift blockers/u,
  );
});

test("bootstrap requires the exact plan confirmation and records returned ids", async () => {
  const { target: source } = await loadTarget("mbza-development");
  const target = targetWithoutResourceIds(source, "development");
  const plan = buildCloudflareBootstrapPlan({
    target,
    environment: "development",
    accountId: "c".repeat(32),
    inventories: { d1: [], kv: [], r2: [], queue: [] },
  });
  let calls = 0;
  await assert.rejects(
    applyCloudflareBootstrapPlan(plan, target, {
      confirm: "CLOUDFLARE:BOOTSTRAP:wrong",
      create: async () => {
        calls += 1;
        return {};
      },
    }),
    /pass --confirm/u,
  );
  assert.equal(calls, 0);

  const applied = await applyCloudflareBootstrapPlan(plan, target, {
    confirm: plan.confirmation,
    create: async (operation) => {
      calls += 1;
      if (operation.kind === "d1") return { uuid: idFor(calls) };
      if (operation.kind === "kv") return { id: "f".repeat(32) };
      if (operation.kind === "queue") return { queue_id: idFor(calls) };
      return { name: operation.name };
    },
  });
  assert.equal(applied.length, plan.operations.length);
  assert.match(target.environments.development.d1.id, /^[a-f0-9-]{36}$/u);
  assert.equal(target.environments.development.kv.id, "f".repeat(32));
  assert.match(
    target.environments.development.moduleD1.support.id,
    /^[a-f0-9-]{36}$/u,
  );
});

test("remote inventory fetch follows page and R2 cursor pagination", async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url: url.toString(),
      authorization: init.headers.Authorization,
    });
    if (url.pathname.endsWith("/d1/database")) {
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        success: true,
        result: [{ uuid: idFor(page), name: `db-${page}` }],
        result_info: { page, total_pages: 2, total_count: 2 },
      });
    }
    if (url.pathname.endsWith("/storage/kv/namespaces")) {
      return Response.json({
        success: true,
        result: [{ id: "d".repeat(32), title: "kv" }],
        result_info: { page: 1, total_pages: 1, total_count: 1 },
      });
    }
    if (url.pathname.endsWith("/queues")) {
      return Response.json({
        success: true,
        result: [{ queue_id: idFor(4), queue_name: "queue" }],
        result_info: { page: 1, total_pages: 1, total_count: 1 },
      });
    }
    if (url.pathname.endsWith("/r2/buckets")) {
      const cursor = url.searchParams.get("cursor");
      return Response.json({
        success: true,
        result: { buckets: [{ name: cursor ? "r2-b" : "r2-a" }] },
        result_info: { cursor: cursor ? "" : "next-page" },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const inventories = await fetchCloudflareBootstrapInventories({
    accountId: "d".repeat(32),
    token: "secret-token",
    fetchImpl,
  });
  assert.equal(inventories.d1.length, 2);
  assert.equal(inventories.kv.length, 1);
  assert.equal(inventories.r2.length, 2);
  assert.equal(inventories.queue.length, 1);
  assert.equal(calls.length, 6);
  assert.equal(
    calls.every(({ authorization }) => authorization === "Bearer secret-token"),
    true,
  );
});

function inventoriesFor(resources) {
  const inventories = { d1: [], kv: [], r2: [], queue: [] };
  let index = 0;
  for (const resource of resources) {
    index += 1;
    if (resource.kind === "d1") {
      inventories.d1.push({
        uuid: resource.manifestId ?? idFor(index),
        name: resource.name,
      });
    } else if (resource.kind === "kv") {
      inventories.kv.push({
        id: resource.manifestId ?? index.toString(16).padStart(32, "0"),
        title: resource.name,
      });
    } else if (resource.kind === "r2") {
      inventories.r2.push({ name: resource.name });
    } else {
      inventories.queue.push({
        queue_id: idFor(index),
        queue_name: resource.name,
      });
    }
  }
  return inventories;
}

function idFor(value) {
  const hex = Number(value).toString(16).padStart(32, "0").slice(-32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
