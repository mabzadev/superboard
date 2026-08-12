import assert from "node:assert/strict";
import { test } from "node:test";
import { FixtureAdapter, RemoteD1Adapter, parseD1Rows } from "./adapters.mjs";
import {
  CutoverMismatchError,
  applyPlan,
  buildPlan,
  buildReverseDelta,
  canonicalJson,
  compareDatasets,
  createRollbackPlan,
  createVerificationReport,
  parseProjectRef,
  reverseDeltaSql,
  sqlLiteral,
  upsertSql,
  validateApplySafety,
  validateMaintenanceEnableSafety,
} from "./core.mjs";
import { MODULE_CUTOVER_GUARDS, MODULE_CUTOVER_REGISTRY } from "./registry.mjs";

const exampleEntity = {
  id: "app.example",
  module: "app",
  columns: ["id", "project_id", "payload_json", "updated_at"],
  jsonColumns: ["payload_json"],
  keys: ["id"],
  projectColumn: "project_id",
  source: { database: "api", table: "legacy_examples", query: "" },
  target: { table: "examples", query: "" },
  reverse: (row) => ({ id: row.id, project_id: row.project_id, payload_json: row.payload_json, updated_at: row.updated_at }),
  reverseColumns: ["id", "project_id", "payload_json", "updated_at"],
  reverseKeys: ["id"],
};

function fixture(source = [], target = []) {
  return {
    project: { project_ref: "10-test", project_id: 12, instance_id: 10, environment: "test" },
    source_rows: { [exampleEntity.id]: source },
    target_rows: { [exampleEntity.id]: target },
    maintenance: { "10-test": { enabled: true, window_id: "window-1234" } },
  };
}

function row(id = "a", payload = { a: 1, b: 2 }) {
  return { id, project_id: 12, payload_json: JSON.stringify(payload), updated_at: "2026-08-07T10:00:00Z" };
}

function testSafety(projectRef = "10-test") {
  const window = {
    schema_version: 1,
    window_id: "window-1234",
    project_ref: projectRef,
    starts_at: "2026-08-07T09:00:00Z",
    ends_at: "2026-08-07T11:00:00Z",
    reason: "Module cutover",
    approved_by: "owner@example.com",
    maintenance: { enabled: true, window_id: "window-1234" },
    backup_receipt: {
      completed_at: "2026-08-07T09:10:00Z",
      artifacts: ["legacy-api", "legacy-messaging", "module-analytics", "module-app", "module-products", "module-paywalls", "module-dynamicLinks", "module-support", "module-marketing", "module-onboardings"]
        .map((name) => ({ name, bytes: 100, sha256: "a".repeat(64) })),
    },
  };
  return validateApplySafety({
    target: "vocostar",
    projectRef,
    window,
    confirm: `CUTOVER:vocostar:${projectRef}:window-1234`,
    allowProduction: projectRef.endsWith("-prod"),
    now: new Date("2026-08-07T10:00:00Z"),
  });
}

test("project_ref parsing distinguishes production from test without coercing the full ref", () => {
  assert.deepEqual(parseProjectRef("10-prod"), {
    project_ref: "10-prod", instance_id: 10, environment: "production", is_production_project: true,
  });
  assert.throws(() => parseProjectRef("10"), /project-ref/u);
});

test("canonical checksums ignore object key and row order but detect value changes", () => {
  const first = [row("b", { z: 2, a: 1 }), row("a")];
  const reordered = [row("a", { b: 2, a: 1 }), row("b", { a: 1, z: 2 })];
  assert.equal(compareDatasets(first, reordered, exampleEntity).matches, true);
  assert.equal(compareDatasets(first, [row("a"), row("b", { z: 3 })], exampleEntity).matches, false);
  assert.equal(canonicalJson({ z: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"z":1}');
});

test("backfill apply is idempotent and resumes from a verified checkpoint", async () => {
  const adapter = new FixtureAdapter(fixture([row()]));
  const plan = await buildPlan({ adapter, registry: [exampleEntity], projectRef: "10-test", modules: ["app"] });
  assert.equal(plan.ready, false);
  let saved;
  const first = await applyPlan({
    adapter, registry: [exampleEntity], plan, safety: testSafety(),
    onCheckpoint: async (checkpoint) => { saved = structuredClone(checkpoint); },
  });
  assert.equal(first.ready, true);
  assert.equal(adapter.upsertCalls.length, 1);
  const repeated = await applyPlan({ adapter, registry: [exampleEntity], plan, safety: testSafety(), checkpoint: saved });
  assert.equal(repeated.entities[0].resumed, true);
  assert.equal(adapter.upsertCalls.length, 1);
  const verification = await buildPlan({ adapter, registry: [exampleEntity], projectRef: "10-test", modules: ["app"] });
  assert.equal(verification.ready, true);
});

test("an entity-scoped plan leaves unrelated live module rows outside the cutover", async () => {
  const secondEntity = { ...exampleEntity, id: "app.unrelated", source: { ...exampleEntity.source, table: "legacy_unrelated" }, target: { ...exampleEntity.target, table: "unrelated" } };
  const adapter = new FixtureAdapter({
    ...fixture([row()]),
    source_rows: { [exampleEntity.id]: [row()], [secondEntity.id]: [row("live")] },
    target_rows: { [exampleEntity.id]: [], [secondEntity.id]: [row("live")] },
  });
  const plan = await buildPlan({
    adapter,
    registry: [exampleEntity, secondEntity],
    projectRef: "10-test",
    modules: ["app"],
    entityIds: [exampleEntity.id],
  });
  assert.deepEqual(plan.entity_ids, [exampleEntity.id]);
  assert.deepEqual(plan.entities.map((entity) => entity.id), [exampleEntity.id]);
});

test("a checksum mismatch aborts immediately and does not mark a checkpoint verified", async () => {
  class CorruptingAdapter extends FixtureAdapter {
    async upsert(entity, rows, context, sql) {
      await super.upsert(entity, rows.map((value) => ({ ...value, payload_json: '{"corrupt":true}' })), context, sql);
    }
  }
  const adapter = new CorruptingAdapter(fixture([row()]));
  const plan = await buildPlan({ adapter, registry: [exampleEntity], projectRef: "10-test", modules: ["app"] });
  let checkpointWrites = 0;
  await assert.rejects(
    applyPlan({ adapter, registry: [exampleEntity], plan, safety: testSafety(), onCheckpoint: async () => { checkpointWrites += 1; } }),
    CutoverMismatchError,
  );
  assert.equal(checkpointWrites, 0);
});

test("a project/window checkpoint cannot be reused for another cutover", async () => {
  const adapter = new FixtureAdapter(fixture([row()]));
  const plan = await buildPlan({ adapter, registry: [exampleEntity], projectRef: "10-test", modules: ["app"] });
  await assert.rejects(applyPlan({
    adapter, registry: [exampleEntity], plan, safety: testSafety(),
    checkpoint: { schema_version: 1, project_ref: "10-prod", project_id: 11, window_id: "window-1234", entities: {} },
  }), /Checkpoint does not belong/u);
  assert.equal(adapter.upsertCalls.length, 0);
});

test("data-shape guards block apply before the first write", async () => {
  const adapter = new FixtureAdapter({ ...fixture([row()]), guard_rows: { "app.lossy": [{ id: "bad" }] } });
  const guards = [{ id: "app.lossy", module: "app", message: "lossy", source: { database: "api", query: "" } }];
  const plan = await buildPlan({ adapter, registry: [exampleEntity], guards, projectRef: "10-test", modules: ["app"] });
  assert.equal(plan.blockers.length, 1);
  assert.equal(createVerificationReport(plan).ready, false);
  await assert.rejects(applyPlan({ adapter, registry: [exampleEntity], plan, safety: testSafety() }), /blocked/u);
  assert.equal(adapter.upsertCalls.length, 0);
});

test("production apply fails closed without explicit approval, maintenance and backups", () => {
  const base = {
    schema_version: 1, window_id: "window-1234", project_ref: "10-prod",
    starts_at: "2026-08-07T09:00:00Z", ends_at: "2026-08-07T11:00:00Z",
    reason: "Production cutover", approved_by: "owner@example.com",
  };
  assert.throws(() => validateApplySafety({
    target: "vocostar", projectRef: "10-prod", window: base,
    confirm: "CUTOVER:vocostar:10-prod:window-1234", now: new Date("2026-08-07T10:00:00Z"),
  }), /allow-production/u);
  assert.throws(() => validateApplySafety({
    target: "vocostar", projectRef: "10-prod", window: base, allowProduction: true,
    confirm: "CUTOVER:vocostar:10-prod:window-1234", now: new Date("2026-08-07T10:00:00Z"),
  }), /backup receipt/u);
  assert.throws(() => validateApplySafety({
    target: "vocostar", projectRef: "10-prod", window: { ...base, backup_receipt: testSafetyWindowReceipt() }, allowProduction: true,
    confirm: "CUTOVER:vocostar:10-prod:window-1234", now: new Date("2026-08-07T10:00:00Z"),
  }), /maintenance/u);
  assert.equal(testSafety("10-prod").window_id, "window-1234");
  const preEnable = { ...base, backup_receipt: testSafetyWindowReceipt() };
  assert.equal(validateMaintenanceEnableSafety({
    projectRef: "10-prod", window: preEnable, allowProduction: true, now: new Date("2026-08-07T10:00:00Z"),
  }).window_id, "window-1234");
});

function testSafetyWindowReceipt() {
  return {
    completed_at: "2026-08-07T09:10:00Z",
    artifacts: ["legacy-api", "legacy-messaging", "module-analytics", "module-app", "module-products", "module-paywalls", "module-dynamicLinks", "module-support", "module-marketing", "module-onboardings"]
      .map((name) => ({ name, bytes: 100, sha256: "a".repeat(64) })),
  };
}

test("reverse delta emits legacy upserts and blocks deleted or non-reversible data", () => {
  const baseline = {
    project: fixture().project,
    entities: [{ id: exampleEntity.id, module: "app", rows: [row()] }],
  };
  const changed = row("a", { changed: true });
  const delta = buildReverseDelta({ baseline, currentRowsByEntity: { [exampleEntity.id]: [changed] }, registry: [exampleEntity] });
  assert.equal(delta.replayable, true);
  assert.match(reverseDeltaSql(delta, [exampleEntity]).api, /INSERT INTO "legacy_examples"/u);
  const deleted = buildReverseDelta({ baseline, currentRowsByEntity: { [exampleEntity.id]: [] }, registry: [exampleEntity] });
  assert.equal(deleted.replayable, false);
  assert.throws(() => reverseDeltaSql(deleted, [exampleEntity]), /manual reconciliation/u);
});

test("rollback plans are blocked by an unreplayable reverse delta", () => {
  const plan = createRollbackPlan({
    backupPlan: { target: "vocostar", project_ref: "10-prod", worker_versions: [], database_exports: [] },
    reverseDelta: { replayable: false },
  });
  assert.equal(plan.blocked, true);
  assert.equal(plan.blockers.includes("reverse_delta_not_replayable"), true);
});

test("rollback remains blocked until backups, versions and a replayable delta are present", () => {
  const backupPlan = {
    target: "vocostar", project_ref: "10-prod",
    worker_versions: [{ service: "api", worker_name: "opengrow-api" }],
    database_exports: [{ name: "legacy-api", database_id: "db" }],
  };
  const incomplete = createRollbackPlan({ backupPlan });
  assert.equal(incomplete.blocked, true);
  assert.deepEqual(incomplete.blockers.sort(), ["backup_receipt_missing:legacy-api", "reverse_delta_missing", "worker_version_missing:api"].sort());
  const complete = createRollbackPlan({
    backupPlan,
    versions: { api: "version-1" },
    backupReceipt: { artifacts: [{ name: "legacy-api", bytes: 1, sha256: "a".repeat(64) }] },
    reverseDelta: { replayable: true },
  });
  assert.equal(complete.blocked, false);
  assert.deepEqual(complete.blockers, []);
});

test("SQL literals and D1 JSON parsing are bounded to structured values", () => {
  assert.equal(sqlLiteral("O'Reilly"), "'O''Reilly'");
  assert.deepEqual(parseD1Rows('wrangler notice\n[{"results":[{"id":1}],"success":true}]'), [{ id: 1 }]);
  assert.throws(() => parseD1Rows('[{"success":false,"error":"boom"}]'), /boom/u);
});

test("immutable audit backfills never trigger an update on conflict", () => {
  const sql = upsertSql({ ...exampleEntity, immutable: true }, [row()]);
  assert.match(sql, /DO NOTHING/u);
  assert.doesNotMatch(sql, /DO UPDATE/u);
  assert.doesNotMatch(sql, /BEGIN/u);
});

test("the remote adapter rejects every mutation while write authority is disabled", async () => {
  let commands = 0;
  const adapter = new RemoteD1Adapter({
    root: "/tmp",
    targetName: "test",
    environment: "production",
    allowWrites: false,
    commandRunner: () => { commands += 1; return "[]"; },
    target: {
      accountId: "0".repeat(32), domains: { shortlinks: "example.test" },
      environments: { production: { d1: { name: "api" }, messagingD1: { name: "messaging" }, moduleD1: { app: { name: "app" } } } },
    },
  });
  await assert.rejects(adapter.upsert(exampleEntity, [], fixture().project, "SELECT 1;"), /writes are disabled/u);
  await assert.rejects(adapter.setMaintenance("10-test", { enabled: true }), /writes are disabled/u);
  assert.equal(commands, 0);
});

test("the production registry is unique and a zero-row rehearsal covers every entity", async () => {
  const ids = MODULE_CUTOVER_REGISTRY.map((entity) => entity.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...new Set(MODULE_CUTOVER_REGISTRY.map((entity) => entity.module))].sort(), ["app", "dynamic-links", "paywalls", "products", "support"]);
  const adapter = new FixtureAdapter({
    project: fixture().project,
    source_rows: Object.fromEntries(ids.map((id) => [id, []])),
    target_rows: Object.fromEntries(ids.map((id) => [id, []])),
    guard_rows: Object.fromEntries(MODULE_CUTOVER_GUARDS.map((guard) => [guard.id, []])),
  });
  const plan = await buildPlan({ adapter, registry: MODULE_CUTOVER_REGISTRY, guards: MODULE_CUTOVER_GUARDS, projectRef: "10-test" });
  assert.equal(plan.ready, true);
  assert.equal(plan.entities.length, ids.length);
});

test("legacy App access keys are project-specific hashes and never retain plaintext", () => {
  const entity = MODULE_CUTOVER_REGISTRY.find((candidate) => candidate.id === "app.access_keys");
  const source = [{ id: 10, api_key: "server-api-key", created_at: "2026-01-01T00:00:00Z" }];
  const production = entity.transform(source, { project_id: 11, environment: "production" })[0];
  const sandbox = entity.transform(source, { project_id: 12, environment: "test" })[0];
  assert.match(production.key_hash, /^[a-f0-9]{64}$/u);
  assert.match(sandbox.key_hash, /^[a-f0-9]{64}$/u);
  assert.notEqual(production.key_hash, sandbox.key_hash);
  assert.equal(JSON.stringify([production, sandbox]).includes("server-api-key"), false);
});
