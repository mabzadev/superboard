import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FixtureFlowsCutoverAdapter, RemoteFlowsCutoverAdapter } from "./adapters.mjs";
import {
  applyFlowsCutoverPlan,
  assertMbzaDevelopment,
  assertPlanIntegrity,
  buildFlowsCutoverPlan,
  buildReverseDelta,
  compareDatasets,
  confirmationValue,
  createBackupPlan,
  createCutoverWindow,
  createRollbackPlan,
  datasetEvidence,
  reverseDeltaSql,
  routingVerificationEvidence,
  upsertSql,
  validateApplySafety,
  validateBackupReceiptForBackupPlan,
  verifyFlowsCutoverPlan,
  verifyMbzaRoutingGate,
  FLOWS_CUTOVER_SCHEMA_VERSION,
} from "./core.mjs";
import { FLOW_CUTOVER_ENTITIES, FLOW_CUTOVER_ENTITY_BY_ID, FLOW_SOURCE_QUERIES } from "./registry.mjs";
import { canonicalJson, sha256 } from "./core-primitives.mjs";

const CAPTURED_AT = "2026-08-13T10:00:00.000Z";

test("cutover registry is strictly project/environment scoped and excludes SaaS billing tables", () => {
  for (const entity of FLOW_CUTOVER_ENTITIES) {
    assert.equal(entity.columns.includes("organization_id"), false, entity.id);
    assert.equal(entity.keys.includes("organization_id"), false, entity.id);
    assert.equal(entity.targetQuery.includes("organization_id"), false, entity.id);
    assert.doesNotMatch(entity.table, /organization|member|invitation|billing|mtu|usage/u, entity.id);
  }
  assert.deepEqual(FLOW_CUTOVER_ENTITY_BY_ID.get("paywalls.claims").keys, ["project_id", "source_module", "event_id"]);
  assert.deepEqual(FLOW_CUTOVER_ENTITY_BY_ID.get("paywalls.analytics").keys, ["project_id", "event_id"]);
});

test("backup evidence covers API, both legacy sources and Flows before any schema or routing write", () => {
  const backupPlan = createBackupPlan({
    target: "mbza-development",
    environment: "development",
    projectRef: "42-test",
    resources: fakeResources(),
    workers: fakeWorkers(),
    outputDirectory: "/protected/all-cutover-databases",
    generatedAt: CAPTURED_AT,
  });
  assert.equal(backupPlan.ready, true);
  assert.deepEqual(
    backupPlan.databases.map((database) => database.logical_name),
    ["api", "paywalls", "onboardings", "flows"],
  );
  assert.equal(
    backupPlan.databases.find((database) => database.logical_name === "api")
      .database_name,
    "superboard-dev-db",
  );
  assert.ok(backupPlan.databases.every((database) =>
    database.time_travel_command &&
    database.export_command &&
    database.upload_command &&
    database.r2_bucket === "flows-archive"));
});

test("backup receipt validation fails closed when API D1 evidence is absent", () => {
  const backupPlan = createBackupPlan({
    target: "mbza-development",
    environment: "development",
    projectRef: "42-test",
    resources: fakeResources(),
    workers: fakeWorkers(),
    outputDirectory: "/protected/all-cutover-databases",
    generatedAt: CAPTURED_AT,
  });
  const receipt = {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    receipt_id: "backup-without-api",
    target: "mbza-development",
    environment: "development",
    project_ref: "42-test",
    window_id: "window-1234",
    backup_plan_id: backupPlan.backup_plan_id,
    completed_at: CAPTURED_AT,
    automatic_deletion: false,
    artifacts: backupPlan.databases
      .filter((database) => database.logical_name !== "api")
      .map((database) => ({
        logical_name: database.logical_name,
        database_name: database.database_name,
        database_id: database.database_id,
        time_travel_bookmark: `bookmark-${database.logical_name}`,
        bytes: 42,
        sha256: "b".repeat(64),
        r2_bucket: database.r2_bucket,
        r2_key: database.r2_key,
        r2_etag: `etag-${database.logical_name}`,
        r2_verified_at: CAPTURED_AT,
      })),
  };
  assert.throws(
    () => validateBackupReceiptForBackupPlan(receipt, backupPlan),
    /API|api/u,
  );
});

test("remote environment resolution is bound to project id, project_ref and logical environment", async () => {
  let statement = "";
  const adapter = new RemoteFlowsCutoverAdapter({
    root: resolve("."),
    targetName: "mbza-development",
    environment: "development",
    target: {
      environments: {
        development: {
          moduleD1: { flows: { name: "flows", id: "flows-id" } },
        },
      },
    },
  });
  adapter.query = async (_database, sql) => {
    statement = sql;
    return [{ id: "env-1", key: "test", name: "Test" }];
  };
  const scope = await adapter.resolveFlowEnvironment({
    project_id: 7,
    project_ref: "42-test",
    environment: "test",
  });
  assert.deepEqual(scope, { environment_id: "env-1" });
  assert.match(statement, /e\.project_id = 7/u);
  assert.match(statement, /p\.project_ref = '42-test'/u);
  assert.match(statement, /e\.key = 'test'/u);
  assert.equal(statement.includes("organization"), false);
});

test("missing default environment is derived deterministically and bootstrapped only by guarded apply", async () => {
  const adapter = new RemoteFlowsCutoverAdapter({
    root: resolve("."),
    targetName: "mbza-development",
    environment: "development",
    allowWrites: true,
    target: {
      environments: {
        development: {
          moduleD1: { flows: { name: "flows", id: "flows-id" } },
        },
      },
    },
  });
  adapter.query = async (_database, sql) =>
    sql.includes("SELECT p.project_id")
      ? [{ project_id: 7, project_ref: "42-test", environment_id: "flow-project-7-environment-test", key: "test" }]
      : [];
  const scope = await adapter.resolveFlowEnvironment({
    project_id: 7,
    project_ref: "42-test",
    environment: "test",
  });
  assert.deepEqual(scope, {
    environment_id: "flow-project-7-environment-test",
  });
  let bootstrapSql = "";
  adapter.executeFile = async (_database, _filename, sql) => {
    bootstrapSql = sql;
  };
  const receipt = await adapter.ensureProjectScope(
    { project_id: 7, project_ref: "42-test", environment: "test" },
    scope.environment_id,
  );
  assert.equal(receipt.environment_id, scope.environment_id);
  assert.match(bootstrapSql, /INSERT OR IGNORE INTO flow_projects/u);
  assert.match(bootstrapSql, /INSERT OR IGNORE INTO flow_environments/u);
  assert.match(bootstrapSql, /flow-project-7-environment-test/u);
  assert.doesNotMatch(bootstrapSql, /FLOW_USER_HASH_KEY|INTERNAL_API_TOKEN/u);

  const readOnly = new RemoteFlowsCutoverAdapter({
    root: resolve("."),
    targetName: "mbza-development",
    environment: "development",
    target: {
      environments: {
        development: {
          moduleD1: { flows: { name: "flows", id: "flows-id" } },
        },
      },
    },
  });
  await assert.rejects(
    readOnly.ensureProjectScope(
      { project_id: 7, project_ref: "42-test", environment: "test" },
      scope.environment_id,
    ),
    /guarded apply authority/u,
  );
});

test("freeze identity validation accepts only an absent deterministic default scope", async () => {
  const adapter = new RemoteFlowsCutoverAdapter({
    root: resolve("."),
    targetName: "mbza-development",
    environment: "development",
    target: {
      environments: {
        development: {
          moduleD1: {
            flows: { name: "flows", id: "flows-id" },
            paywalls: { name: "paywalls", id: "paywalls-id" },
            onboardings: { name: "onboardings", id: "onboardings-id" },
          },
        },
      },
    },
  });
  adapter.resolveProject = async () => ({
    project_id: 7,
    project_ref: "42-test",
    instance_id: 42,
    environment: "test",
  });
  adapter.query = async () => [];
  const plan = {
    project: {
      project_id: 7,
      project_ref: "42-test",
      instance_id: 42,
    },
    environment_id: "flow-project-7-environment-test",
    source_databases: {
      paywalls: "paywalls",
      onboardings: "onboardings",
    },
    source_database_ids: {
      paywalls: "paywalls-id",
      onboardings: "onboardings-id",
    },
  };
  await adapter.validatePlanIdentity(plan, { allowMissingDefaultScope: true });

  await assert.rejects(
    adapter.validatePlanIdentity(
      { ...plan, environment_id: "custom-missing-environment" },
      { allowMissingDefaultScope: true },
    ),
    /Expected exactly one project-scoped Flows environment/u,
  );

  adapter.query = async () => [{
    project_id: 8,
    project_ref: "42-test",
    environment_id: null,
    key: null,
  }];
  await assert.rejects(
    adapter.validatePlanIdentity(plan, { allowMissingDefaultScope: true }),
    /conflicts with the live MBZA scope/u,
  );
});

test("remote user hash resolution is ordered, batched and never receives the HMAC secret", async () => {
  const adapter = new RemoteFlowsCutoverAdapter({
    root: resolve("."),
    targetName: "mbza-development",
    environment: "development",
    gatewayToken: "cutover-token",
    target: {
      domains: { api: "api.mbza.dev" },
      environments: { development: {} },
    },
  });
  const calls = [];
  adapter.cutoverRequest = async (method, path, body, headers) => {
    calls.push({ method, path, body, headers });
    return {
      items: body.user_ids.map((userId) => ({
        user_id: userId,
        user_id_hash: createHmac("sha256", "server-only-test-key")
          .update(`42-test\n${userId}`)
          .digest("hex"),
      })),
    };
  };
  const rawUserIds = Array.from({ length: 501 }, (_, index) => `user-${500 - index}`);
  rawUserIds.push("user-0");
  const resolved = await adapter.resolveUserHashes(
    { project_ref: "42-test" },
    rawUserIds,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.user_ids.length, 500);
  assert.equal(calls[1].body.user_ids.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "user-hashes/42-test");
  assert.match(calls[0].headers["idempotency-key"], /^flows-cutover-user-hashes-[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(calls).includes("server-only-test-key"), false);
  assert.equal(resolved.size, 501);
  assert.equal(
    resolved.get("user-0"),
    createHmac("sha256", "server-only-test-key")
      .update("42-test\nuser-0")
      .digest("hex"),
  );
});

test("routing verification evidence is exact-plan bound and rejects incomplete reports", async () => {
  const adapter = new FixtureFlowsCutoverAdapter();
  const plan = await buildFlowsCutoverPlan({
    snapshot: sourceSnapshot(),
    adapter,
    environmentId: "env-1",
  });
  await applyFlowsCutoverPlan({ plan, adapter, safety: applySafety(plan) });
  const verification = await verifyFlowsCutoverPlan({ plan, adapter });
  const evidence = routingVerificationEvidence(plan, verification);
  assert.equal(evidence.plan_id, plan.plan_id);
  assert.equal(evidence.project_ref, plan.project.project_ref);
  assert.match(evidence.verification_checksum_sha256, /^[a-f0-9]{64}$/u);

  const failed = structuredClone(verification);
  failed.ready = false;
  assert.throws(
    () => routingVerificationEvidence(plan, failed),
    /successful verification report/u,
  );
  const foreign = structuredClone(verification);
  foreign.project.project_id = 999;
  assert.throws(
    () => routingVerificationEvidence(plan, foreign),
    /exact protected plan\/project/u,
  );
});

test("the API promotion routing gate requires both fixed MBZA project scopes", async () => {
  const scopeInput = async (projectId, projectRef, environmentId) => {
    const snapshot = sourceSnapshot();
    snapshot.project = {
      project_id: projectId,
      project_ref: projectRef,
      instance_id: 1,
      environment: projectRef.endsWith("-test") ? "test" : "production",
    };
    for (const source of ["paywalls", "onboardings"]) {
      snapshot.sources[source].tables = Object.fromEntries(
        Object.entries(snapshot.sources[source].tables).map(([table, rows]) => [
          table,
          rows.map((row) => ({ ...row, project_id: projectId })),
        ]),
      );
    }
    const adapter = new FixtureFlowsCutoverAdapter();
    const plan = await buildFlowsCutoverPlan({
      snapshot,
      adapter,
      environmentId,
    });
    await applyFlowsCutoverPlan({ plan, adapter, safety: applySafety(plan) });
    const verification = await verifyFlowsCutoverPlan({ plan, adapter });
    const evidence = routingVerificationEvidence(plan, verification);
    return {
      plan,
      verification,
      window: { project_ref: projectRef, window_id: "window-0001" },
      state: {
        project_id: projectId,
        enabled: true,
        window_id: "window-0001",
        plan_id: plan.plan_id,
        verification_checksum_sha256: evidence.verification_checksum_sha256,
      },
    };
  };
  const prod = await scopeInput(1, "1-prod", "env-prod");
  const testScope = await scopeInput(2, "1-test", "env-test");
  const inventory = [
    { project_id: 1, project_ref: "1-prod" },
    { project_id: 2, project_ref: "1-test" },
  ];
  const report = verifyMbzaRoutingGate({
    inventory,
    scopes: [prod, testScope],
    checkedAt: CAPTURED_AT,
  });
  assert.equal(report.ready, true);
  assert.deepEqual(report.scopes.map((scope) => scope.matches), [true, true]);

  testScope.state.enabled = false;
  assert.equal(verifyMbzaRoutingGate({
    inventory,
    scopes: [prod, testScope],
    checkedAt: CAPTURED_AT,
  }).ready, false);
  assert.throws(
    () => verifyMbzaRoutingGate({
      inventory: [...inventory, { project_id: 3, project_ref: "2-prod" }],
      scopes: [prod, testScope],
      checkedAt: CAPTURED_AT,
    }),
    /project inventory changed/u,
  );
});

test("remote routing writes are direct, project-scoped, idempotent and evidence-bound", async () => {
  const adapter = new RemoteFlowsCutoverAdapter({
    root: resolve("."),
    targetName: "mbza-development",
    environment: "development",
    allowWrites: true,
    target: {
      environments: {
        development: {
          d1: { name: "api", id: "api-id" },
        },
      },
    },
  });
  const state = {
    enabled: true,
    window_id: "window-0001",
    plan_id: "a".repeat(64),
    verification_checksum_sha256: "b".repeat(64),
  };
  let stored = null;
  const executed = [];
  adapter.resolveProject = async () => ({
    project_id: 7,
    project_ref: "42-test",
    instance_id: 42,
    environment: "test",
  });
  adapter.query = async (_database, sql) => {
    if (sql.includes("FROM flows_legacy_cutover_commands")) return [];
    if (sql.includes("FROM flows_legacy_cutover_state")) {
      return stored ? [{ ...stored, enabled: stored.enabled ? 1 : 0 }] : [];
    }
    throw new Error(`Unexpected routing query: ${sql}`);
  };
  adapter.executeFile = async (database, filename, sql) => {
    executed.push({ database, filename, sql });
    stored = state;
  };

  const result = await adapter.setFlowsRouting(
    "42-test",
    state,
    `flows-routing-enable-${"c".repeat(64)}`,
  );
  assert.deepEqual(result, {
    project_ref: "42-test",
    project_id: 7,
    ...state,
  });
  assert.equal(executed.length, 1);
  assert.equal(executed[0].database.id, "api-id");
  assert.match(executed[0].sql, /INSERT INTO flows_legacy_cutover_state/u);
  assert.match(executed[0].sql, /INSERT INTO flows_legacy_cutover_commands/u);
  assert.ok(
    executed[0].sql.indexOf("INSERT INTO flows_legacy_cutover_state") <
      executed[0].sql.indexOf("INSERT INTO flows_legacy_cutover_commands"),
    "the receipt must be sealed only after replay-safe state and audit writes",
  );
  assert.match(executed[0].sql, /INSERT OR IGNORE INTO module_cutover_audit/u);
  assert.match(executed[0].sql, /flows-routing-[a-f0-9]{48}/u);
  assert.match(executed[0].sql, /project_id,enabled,window_id,plan_id,verification_checksum_sha256/u);
  assert.doesNotMatch(executed[0].sql, /organization/u);
});

test("direct maintenance writes and verifies the API D1 state without an operator token", async () => {
  const adapter = new RemoteFlowsCutoverAdapter({
    root: resolve("."),
    targetName: "mbza-development",
    environment: "development",
    allowWrites: true,
    directMaintenance: true,
    target: {
      environments: {
        development: {
          d1: { name: "api", id: "api-id" },
        },
      },
    },
  });
  let stored = null;
  const executed = [];
  adapter.resolveProject = async () => ({
    project_id: 7,
    project_ref: "42-test",
    instance_id: 42,
    environment: "test",
  });
  adapter.query = async (_database, sql) => {
    assert.match(sql, /FROM module_cutover_maintenance/u);
    return stored ? [{ ...stored, enabled: stored.enabled ? 1 : 0 }] : [];
  };
  adapter.executeFile = async (database, filename, sql) => {
    executed.push({ database, filename, sql });
    stored = {
      enabled: true,
      window_id: "window-0001",
      reason: "Verified Flows cutover",
      updated_by: "flows-cutover-cli",
      updated_at: CAPTURED_AT,
    };
  };

  const result = await adapter.setMaintenance("42-test", {
    enabled: true,
    window_id: "window-0001",
    reason: "Verified Flows cutover",
  });
  assert.equal(result.enabled, true);
  assert.equal(result.window_id, "window-0001");
  assert.equal(executed.length, 1);
  assert.equal(executed[0].database.id, "api-id");
  assert.match(executed[0].sql, /INSERT INTO module_cutover_maintenance/u);
  assert.match(executed[0].sql, /INSERT OR IGNORE INTO module_cutover_audit/u);
  assert.match(executed[0].sql, /maintenance\.enabled/u);
  assert.doesNotMatch(executed[0].sql, /OPENGROW_CUTOVER_TOKEN/u);
});

test("a routing receipt is replayed only when its payload and active state still match", async () => {
  const adapter = new RemoteFlowsCutoverAdapter({
    root: resolve("."),
    targetName: "mbza-development",
    environment: "development",
    allowWrites: true,
    target: {
      environments: {
        development: {
          d1: { name: "api", id: "api-id" },
        },
      },
    },
  });
  const state = {
    enabled: true,
    window_id: "window-0001",
    plan_id: "a".repeat(64),
    verification_checksum_sha256: "b".repeat(64),
  };
  const response = {
    project_ref: "42-test",
    project_id: 7,
    ...state,
  };
  const payloadChecksum = sha256(canonicalJson(response));
  adapter.resolveProject = async () => ({
    project_id: 7,
    project_ref: "42-test",
    instance_id: 42,
    environment: "test",
  });
  adapter.query = async (_database, sql) => {
    if (sql.includes("FROM flows_legacy_cutover_commands")) {
      return [{
        payload_checksum_sha256: payloadChecksum,
        response_json: canonicalJson(response),
      }];
    }
    if (sql.includes("FROM flows_legacy_cutover_state")) {
      return [{
        ...state,
        enabled: 0,
      }];
    }
    throw new Error(`Unexpected routing query: ${sql}`);
  };

  await assert.rejects(
    adapter.setFlowsRouting(
      "42-test",
      state,
      `flows-routing-enable-${"c".repeat(64)}`,
    ),
    /receipt exists but the active D1 state does not match/u,
  );
});

test("protected local hash resolution matches the Worker without requiring the new API route", async () => {
  const adapter = new RemoteFlowsCutoverAdapter({
    root: resolve("."),
    targetName: "mbza-development",
    environment: "development",
    flowUserHashKey: "server-only-test-key",
    target: {
      domains: { api: "api.mbza.dev" },
      environments: { development: {} },
    },
  });
  adapter.cutoverRequest = async () => {
    throw new Error("The API hash route must not be called before cutover");
  };
  const resolved = await adapter.resolveUserHashes(
    { project_ref: "42-test" },
    ["customer-1", "customer-1", "customer-2"],
  );
  assert.equal(resolved.size, 2);
  assert.equal(
    resolved.get("customer-1"),
    createHmac("sha256", "server-only-test-key")
      .update("42-test\ncustomer-1")
      .digest("hex"),
  );
});

test("plan conversion and canonical checksums are deterministic", async () => {
  const snapshot = sourceSnapshot();
  const first = await buildFlowsCutoverPlan({ snapshot, adapter: new FixtureFlowsCutoverAdapter(), environmentId: "env-1" });
  const second = await buildFlowsCutoverPlan({ snapshot: structuredClone(snapshot), adapter: new FixtureFlowsCutoverAdapter(), environmentId: "env-1" });

  assert.equal(first.plan_id, second.plan_id);
  assert.deepEqual(first.entities.map((item) => item.expected), second.entities.map((item) => item.expected));
  assert.equal(first.ready_to_apply, true);
  assert.equal(first.converged, false);
  assert.equal(first.automatic_deletion, false);
  assertPlanIntegrity(first);

  const analytics = first.entities.flatMap((item) => item.id.endsWith(".analytics") ? item.rows : []);
  assert.equal(analytics.length, 2);
  assert.deepEqual(analytics.map((row) => row.event_id).sort(), ["legacy:onboardings:paywall-event-1", "legacy:paywalls:paywall-event-1"]);
  assert.deepEqual(analytics.map((row) => row.source_event_id).sort(), ["paywall-event-1", "paywall-event-1"]);
  assert.equal(
    analytics.find((row) => row.source_module === "paywalls").user_id_hash,
    createHmac("sha256", "fixture-flow-user-hash-key")
      .update("42-test\ncustomer-1")
      .digest("hex"),
  );
  assert.ok(analytics.every((row) => /^[a-f0-9]{64}$/u.test(row.user_id_hash)));
  assert.ok(analytics.every((row) => !row.user_id_hash.startsWith("legacy_")));
  const claims = first.entities.flatMap((item) => item.id.endsWith(".claims") ? item.rows : []);
  assert.deepEqual(claims.map((row) => row.event_id).sort(), analytics.map((row) => row.source_event_id).sort());
  const onboardingExperiment = first.entities.find((item) => item.id === "onboardings.experiments").rows[0];
  assert.equal(onboardingExperiment.traffic_basis_points, 1234);
  const states = first.entities.flatMap((item) => item.id.endsWith(".states") ? item.rows : []);
  assert.ok(states.every((row) => row.generation === 1 && row.revision >= 1));
  const onboardingState = first.entities.find((item) => item.id === "onboardings.states").rows[0];
  assert.deepEqual(JSON.parse(onboardingState.active_block_ids_json), []);
  assert.deepEqual(JSON.parse(onboardingState.tour_indexes_json), {});
  assert.ok(analytics.every((row) => !new Set(["purchase", "installation", "install"]).has(row.event_name)));
  assert.ok(analytics.every((row) => {
    const properties = JSON.parse(row.properties_json);
    return properties.analytics_namespace === "flows.legacy" && properties.verified_fact_eligible === false &&
      properties.legacy.imported_history === true &&
      new Set(["paywalls", "onboardings"]).has(properties.legacy.source) &&
      properties.excluded_metrics.includes("purchase") && properties.excluded_metrics.includes("installation");
  }));
  assert.equal(
    JSON.parse(analytics.find((row) => row.source_module === "paywalls").properties_json)
      .legacy.authoritative_purchase,
    true,
  );
  assert.equal(
    JSON.parse(analytics.find((row) => row.source_module === "onboardings").properties_json)
      .legacy.authoritative_purchase,
    false,
  );
  const paywallAnalyticsEntity = FLOW_CUTOVER_ENTITY_BY_ID.get("paywalls.analytics");
  const paywallAnalyticsRows = first.entities.find((item) => item.id === "paywalls.analytics").rows;
  assert.match(
    upsertSql(paywallAnalyticsEntity, paywallAnalyticsRows),
    /ON CONFLICT \("project_id", "event_id"\) DO NOTHING/u,
  );
  assert.ok(!first.entities.some((item) => /purchase|installation|billing|mtu|usage/u.test(item.target_table)));
  assert.equal(JSON.stringify(first).includes("organization_id"), false);

  const workflows = FLOW_CUTOVER_ENTITY_BY_ID.get("paywalls.workflows");
  const rows = first.entities.find((item) => item.id === workflows.id).rows;
  assert.deepEqual(datasetEvidence(rows, workflows), datasetEvidence([...rows].reverse(), workflows));
  assert.equal(compareDatasets(rows, structuredClone(rows), workflows).matches, true);
});

test("apply is idempotent and a verified checkpoint avoids duplicate writes", async () => {
  const adapter = new FixtureFlowsCutoverAdapter();
  const plan = await buildFlowsCutoverPlan({ snapshot: sourceSnapshot(), adapter, environmentId: "env-1" });
  const safety = applySafety(plan);
  let checkpoint;
  const first = await applyFlowsCutoverPlan({ plan, adapter, safety, onCheckpoint: (value) => { checkpoint = structuredClone(value); } });
  const callsAfterFirst = adapter.upsertCalls.length;
  assert.equal(first.ready, true);
  assert.equal(callsAfterFirst, plan.entities.filter((item) => item.expected.count > 0).length);

  const second = await applyFlowsCutoverPlan({ plan, adapter, safety, checkpoint, onCheckpoint: (value) => { checkpoint = structuredClone(value); } });
  assert.equal(adapter.upsertCalls.length, callsAfterFirst);
  assert.ok(second.entities.every((item) => item.resumed));
  assert.equal((await verifyFlowsCutoverPlan({ plan, adapter })).ready, true);
});

test("an interrupted apply resumes only after the last verified entity", async () => {
  const adapter = new FixtureFlowsCutoverAdapter({ fail_on_upsert_attempt: 3 });
  const plan = await buildFlowsCutoverPlan({ snapshot: sourceSnapshot(), adapter, environmentId: "env-1" });
  const safety = applySafety(plan);
  let checkpoint;
  await assert.rejects(
    applyFlowsCutoverPlan({ plan, adapter, safety, onCheckpoint: (value) => { checkpoint = structuredClone(value); } }),
    /Fixture interrupted/u,
  );
  assert.equal(Object.keys(checkpoint.entities).length, 2);
  const successfulBeforeResume = adapter.upsertCalls.length;
  adapter.fixture.fail_on_upsert_attempt = -1;
  const result = await applyFlowsCutoverPlan({ plan, adapter, safety, checkpoint, onCheckpoint: (value) => { checkpoint = structuredClone(value); } });
  assert.equal(result.ready, true);
  assert.ok(result.entities.slice(0, 2).every((item) => item.resumed));
  assert.equal(adapter.upsertCalls.length, successfulBeforeResume + plan.entities.filter((item, index) => index >= 2 && item.expected.count > 0).length);
});

test("runtime legacy events may append during freeze without invalidating imported checksums", async () => {
  const adapter = new FixtureFlowsCutoverAdapter();
  const plan = await buildFlowsCutoverPlan({ snapshot: sourceSnapshot(), adapter, environmentId: "env-1" });
  await applyFlowsCutoverPlan({ plan, adapter, safety: applySafety(plan) });
  const analytics = adapter.fixture.target_rows["paywalls.analytics"];
  const appended = structuredClone(analytics[0]);
  appended.event_id = "legacy:paywalls:runtime-event-after-snapshot";
  appended.source_event_id = "runtime-event-after-snapshot";
  appended.source_module = "paywalls";
  appended.environment_id = "env-1";
  appended.occurred_at = "2026-08-13T10:00:01.000Z";
  appended.projected_at = "2026-08-13T10:00:02.000Z";
  appended.properties_json = JSON.stringify({
    legacy: { source: "paywalls", type: "view", placement: "settings", platform: "ios", workflow_id: "paywall-1" },
    payload: {},
  });
  analytics.push(appended);
  const claim = structuredClone(adapter.fixture.target_rows["paywalls.claims"][0]);
  claim.event_id = appended.source_event_id;
  claim.claimed_at = appended.occurred_at;
  adapter.fixture.target_rows["paywalls.claims"].push(claim);

  const report = await verifyFlowsCutoverPlan({ plan, adapter });
  assert.equal(report.ready, true);
  assert.equal(report.entities.find((item) => item.id === "paywalls.analytics").extra_count, 1);
  assert.equal(report.entities.find((item) => item.id === "paywalls.claims").extra_count, 1);

  const currentRowsByEntity = Object.fromEntries(await Promise.all(plan.entities.map(async (item) => [item.id, await adapter.readTarget(FLOW_CUTOVER_ENTITY_BY_ID.get(item.id))])));
  const delta = buildReverseDelta({ baselinePlan: plan, currentRowsByEntity });
  assert.equal(delta.replayable, true);
  assert.match(reverseDeltaSql(delta).paywalls.sql, /runtime-event-after-snapshot/u);
});

test("tampered rows fail closed and identical raw ids are safely namespaced across modules", async () => {
  const plan = await buildFlowsCutoverPlan({ snapshot: sourceSnapshot(), adapter: new FixtureFlowsCutoverAdapter(), environmentId: "env-1" });
  const tampered = structuredClone(plan);
  tampered.entities.find((item) => item.id === "paywalls.workflows").rows[0].name = "tampered";
  assert.throws(() => assertPlanIntegrity(tampered), /integrity check failed/u);
  const organizationScoped = structuredClone(plan);
  organizationScoped.organization_id = "forbidden";
  assert.throws(() => assertPlanIntegrity(organizationScoped), /scoped only by project and environment/u);
  const preCompositeEventKeyPlan = structuredClone(plan);
  preCompositeEventKeyPlan.tool_version = "2.1.0";
  assert.throws(() => assertPlanIntegrity(preCompositeEventKeyPlan), /Unsupported Flows cutover plan/u);

  const collision = sourceSnapshot();
  collision.sources.onboardings.tables.onboardings[0].id = "paywall-1";
  collision.sources.onboardings.tables.onboarding_versions[0].onboarding_id = "paywall-1";
  collision.sources.onboardings.tables.placements[0].onboarding_id = "paywall-1";
  const namespaced = await buildFlowsCutoverPlan({ snapshot: collision, adapter: new FixtureFlowsCutoverAdapter(), environmentId: "env-1" });
  const importedWorkflowIds = namespaced.entities
    .filter((item) => item.id.endsWith(".workflows"))
    .flatMap((item) => item.rows.map((row) => row.id));
  assert.equal(new Set(importedWorkflowIds).size, importedWorkflowIds.length);
});

test("runtime-compatible user hashes merge a shared legacy identity and unidentified state fails closed", async () => {
  const snapshot = sourceSnapshot();
  snapshot.sources.onboardings.tables.events[0].customer_id = "customer-1";
  const plan = await buildFlowsCutoverPlan({
    snapshot,
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-1",
  });
  const paywallUsers = plan.entities.find((item) => item.id === "paywalls.users").rows;
  const onboardingUsers = plan.entities.find((item) => item.id === "onboardings.users").rows;
  assert.equal(paywallUsers.length, 1);
  assert.equal(onboardingUsers.length, 0);
  assert.equal(paywallUsers[0].first_seen_at, "2026-08-12T10:00:00.000Z");
  assert.equal(paywallUsers[0].last_seen_at, "2026-08-12T11:00:00.000Z");
  assert.equal(paywallUsers[0].platform, "web");
  assert.equal(
    paywallUsers[0].user_id_hash,
    createHmac("sha256", "fixture-flow-user-hash-key")
      .update("42-test\ncustomer-1")
      .digest("hex"),
  );

  const unidentified = sourceSnapshot();
  unidentified.sources.onboardings.tables.events[0].customer_id = null;
  await assert.rejects(
    buildFlowsCutoverPlan({
      snapshot: unidentified,
      adapter: new FixtureFlowsCutoverAdapter(),
      environmentId: "env-1",
    }),
    /cannot resume workflow state or an experiment assignment/u,
  );
});

test("in-progress legacy projections resume on a canonical block and preserve the Onboarding step index", async () => {
  const snapshot = sourceSnapshot();
  snapshot.sources.paywalls.tables.events[0].event_type = "impression";
  snapshot.sources.onboardings.tables.onboarding_versions[0].definition_json = JSON.stringify({
    screens: [
      { id: "welcome", blocks: [] },
      { id: "intro", blocks: [] },
    ],
    theme: {},
  });
  snapshot.sources.onboardings.tables.events[0].event_type = "progress";
  const plan = await buildFlowsCutoverPlan({
    snapshot,
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-1",
  });
  const paywallState = plan.entities.find((item) => item.id === "paywalls.states").rows[0];
  const onboardingState = plan.entities.find((item) => item.id === "onboardings.states").rows[0];
  const paywallBlockId = `${paywallState.workflow_id}:placement:paywall-placement-1:variant:paywall-variant-1:commerce`;
  const onboardingBlockId = `${onboardingState.workflow_id}:placement:onboarding-placement-1:variant:onboarding-variant-1:onboarding-tour`;
  assert.equal(paywallState.state, "in-progress");
  assert.deepEqual(JSON.parse(paywallState.active_block_ids_json), [paywallBlockId]);
  assert.deepEqual(JSON.parse(paywallState.tour_indexes_json), {});
  assert.equal(onboardingState.state, "in-progress");
  assert.deepEqual(JSON.parse(onboardingState.active_block_ids_json), [onboardingBlockId]);
  assert.deepEqual(JSON.parse(onboardingState.tour_indexes_json), { [onboardingBlockId]: 1 });
});

test("a canonical Paywall release preserves simultaneous placements on different versions", async () => {
  const snapshot = sourceSnapshot();
  snapshot.sources.paywalls.tables.paywall_versions.push({
    id: "paywall-version-2",
    paywall_id: "paywall-1",
    project_id: 7,
    version: 2,
    status: "published",
    definition_json: JSON.stringify({
      schema_version: 1,
      components: [{ type: "title", text: "Business" }],
      theme: { accent: "#00f" },
      metadata: { offering_identifier: "business" },
    }),
    schema_version: 1,
    changelog: "Business",
    created_by: "user-1",
    published_at: "2026-08-03T10:00:00.000Z",
    created_at: "2026-08-03T09:00:00.000Z",
  });
  snapshot.sources.paywalls.tables.placements.push({
    id: "paywall-placement-2",
    project_id: 7,
    key: "upgrade",
    paywall_id: "paywall-1",
    active_version_id: "paywall-version-2",
    experience_id: null,
    targeting_json: JSON.stringify({ platforms: ["android"] }),
    priority: 90,
    active: 1,
    created_at: "2026-08-03T09:00:00.000Z",
    updated_at: CAPTURED_AT,
  });

  const first = await buildFlowsCutoverPlan({
    snapshot,
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-1",
  });
  const second = await buildFlowsCutoverPlan({
    snapshot: structuredClone(snapshot),
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-1",
  });
  const versions = first.entities.find((item) => item.id === "paywalls.versions").rows;
  const release = first.entities.find((item) => item.id === "paywalls.releases").rows[0];
  const canonical = versions.find((row) => row.id === release.workflow_version_id);
  assert.equal(versions.length, 3);
  assert.ok(canonical);
  assert.equal(canonical.version, 3);
  assert.match(canonical.changelog, /Canonical cutover release/u);
  assert.equal(
    release.workflow_version_id,
    second.entities.find((item) => item.id === "paywalls.releases").rows[0].workflow_version_id,
  );
  const graph = JSON.parse(canonical.graph_json);
  const commerce = graph.blocks.filter((block) => block.componentType === "superboard-commerce");
  assert.deepEqual([...new Set(commerce.map((block) => block.slotId))].sort(), ["settings", "upgrade"]);
  assert.ok(commerce.some((block) => block.slotId === "settings" && block.data.original_definition.components[0].text === "Premium"));
  assert.ok(commerce.some((block) => block.slotId === "upgrade" && block.data.original_definition.components[0].text === "Business"));
  const split = graph.blocks.find((block) => block.id === `${release.workflow_id}:placement:paywall-placement-1:experiment:paywall-experience-1:split`);
  assert.deepEqual(split.data, {
    variants: [{ key: "control", weight: 100 }],
    legacy_source: "paywalls",
    legacy_project_id: 7,
    legacy_placement_id: "paywall-placement-1",
    legacy_experience_id: "paywall-experience-1",
    traffic_basis_points: 10000,
  });
  assert.deepEqual(split.exitNodes, ["control", "holdout"]);
  const holdoutPath = graph.paths.find((candidate) =>
    candidate.sourceBlockId === split.id && candidate.sourceExitNode === "holdout"
  );
  const holdout = graph.blocks.find((block) => block.id === holdoutPath.targetBlockId);
  assert.equal(holdout.data.legacy_holdout, true);
  assert.equal(holdout.data.original_definition.components[0].text, "Premium");
  assert.ok(graph.blocks.filter((block) => ["start", "component"].includes(block.type)).every(
    (block) => Number.isSafeInteger(block.data.legacy_priority),
  ));
});

test("a Paywall release preserves simultaneous placements sharing one version", async () => {
  const snapshot = sourceSnapshot();
  snapshot.sources.paywalls.tables.placements.push({
    id: "paywall-placement-2",
    project_id: 7,
    key: "upgrade",
    paywall_id: "paywall-1",
    active_version_id: "paywall-version-1",
    experience_id: null,
    targeting_json: JSON.stringify({ platforms: ["android"] }),
    priority: 90,
    active: 1,
    created_at: "2026-08-03T09:00:00.000Z",
    updated_at: CAPTURED_AT,
  });
  const plan = await buildFlowsCutoverPlan({
    snapshot,
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-1",
  });
  const release = plan.entities.find((item) => item.id === "paywalls.releases").rows[0];
  const versions = plan.entities.find((item) => item.id === "paywalls.versions").rows;
  assert.equal(versions.length, 1);
  const graph = JSON.parse(
    versions.find((row) => row.id === release.workflow_version_id).graph_json,
  );
  const commerce = graph.blocks.filter(
    (block) => block.componentType === "superboard-commerce",
  );
  assert.deepEqual(
    [...new Set(commerce.map((block) => block.slotId))].sort(),
    ["settings", "upgrade"],
  );
  assert.ok(graph.blocks.some((block) =>
    block.id === `${release.workflow_id}:placement:paywall-placement-2:start`
  ));
});

test("a canonical Onboarding release preserves each placement version, rules and experiment", async () => {
  const snapshot = sourceSnapshot();
  snapshot.sources.onboardings.tables.onboarding_versions.push({
    id: "onboarding-version-2",
    onboarding_id: "onboarding-1",
    project_id: 7,
    version: 2,
    status: "published",
    definition_json: JSON.stringify({
      screens: [{ id: "profile", blocks: [{ type: "text", text: "Profile" }] }],
      theme: { accent: "blue" },
    }),
    published_at: "2026-08-03T11:00:00.000Z",
    created_at: "2026-08-03T10:00:00.000Z",
  });
  snapshot.sources.onboardings.tables.placements.push({
    id: "onboarding-placement-2",
    project_id: 7,
    key: "profile-setup",
    name: "Profile setup",
    onboarding_id: "onboarding-1",
    active_version_id: "onboarding-version-2",
    priority: 90,
    active: 1,
    created_at: "2026-08-03T10:00:00.000Z",
    updated_at: CAPTURED_AT,
  });
  snapshot.sources.onboardings.tables.targeting_rules.push({
    id: "target-rule-2",
    project_id: 7,
    placement_id: "onboarding-placement-2",
    name: "Android",
    priority: 90,
    conditions_json: JSON.stringify([{ key: "platform", operator: "equals", value: "android" }]),
    active: 1,
    created_at: "2026-08-03T10:00:00.000Z",
    updated_at: CAPTURED_AT,
  });
  snapshot.sources.onboardings.tables.experiences.push({
    id: "onboarding-experience-2",
    project_id: 7,
    placement_id: "onboarding-placement-2",
    name: "Profile split",
    status: "running",
    traffic_percentage: 6000,
    created_at: "2026-08-03T10:00:00.000Z",
    updated_at: CAPTURED_AT,
  });
  snapshot.sources.onboardings.tables.experience_variants.push({
    id: "onboarding-variant-2",
    project_id: 7,
    experience_id: "onboarding-experience-2",
    name: "profile-control",
    weight: 10000,
    version_id: "onboarding-version-2",
    created_at: "2026-08-03T10:00:00.000Z",
  });

  const first = await buildFlowsCutoverPlan({
    snapshot,
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-1",
  });
  const second = await buildFlowsCutoverPlan({
    snapshot: structuredClone(snapshot),
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-1",
  });
  const versions = first.entities.find((item) => item.id === "onboardings.versions").rows;
  const release = first.entities.find((item) => item.id === "onboardings.releases").rows[0];
  const canonical = versions.find((row) => row.id === release.workflow_version_id);
  assert.equal(versions.length, 3);
  assert.ok(canonical);
  assert.equal(canonical.version, 3);
  assert.match(canonical.changelog, /Canonical cutover release/u);
  assert.equal(
    release.workflow_version_id,
    second.entities.find((item) => item.id === "onboardings.releases").rows[0].workflow_version_id,
  );
  const graph = JSON.parse(canonical.graph_json);
  const tours = graph.blocks.filter((block) => block.type === "tour");
  assert.deepEqual([...new Set(tours.map((block) => block.slotId))].sort(), ["first-run", "profile-setup"]);
  assert.ok(tours.some((block) => block.slotId === "first-run" && block.data.original_definition.screens[0].id === "intro"));
  assert.ok(tours.some((block) => block.slotId === "profile-setup" && block.data.original_definition.screens[0].id === "profile"));
  const firstSplit = graph.blocks.find((block) => block.id === `${release.workflow_id}:placement:onboarding-placement-1:experiment:onboarding-experience-1:split`);
  const secondSplit = graph.blocks.find((block) => block.id === `${release.workflow_id}:placement:onboarding-placement-2:experiment:onboarding-experience-2:split`);
  assert.equal(firstSplit.data.traffic_basis_points, 1234);
  assert.equal(secondSplit.data.traffic_basis_points, 6000);
  assert.deepEqual(
    {
      source: firstSplit.data.legacy_source,
      project: firstSplit.data.legacy_project_id,
      placement: firstSplit.data.legacy_placement_id,
      experience: firstSplit.data.legacy_experience_id,
      exits: firstSplit.exitNodes,
    },
    {
      source: "onboardings",
      project: 7,
      placement: "onboarding-placement-1",
      experience: "onboarding-experience-1",
      exits: ["control", "holdout"],
    },
  );
  const firstHoldoutPath = graph.paths.find((candidate) =>
    candidate.sourceBlockId === firstSplit.id && candidate.sourceExitNode === "holdout"
  );
  const firstHoldout = graph.blocks.find((block) =>
    block.id === firstHoldoutPath.targetBlockId
  );
  assert.equal(firstHoldout.data.legacy_holdout, true);
  assert.equal(firstHoldout.data.original_definition.screens[0].id, "intro");
  assert.ok(graph.blocks.filter((block) => ["start", "tour"].includes(block.type)).every(
    (block) => Number.isSafeInteger(block.data.legacy_priority),
  ));
  assert.ok(graph.blocks.some((block) => block.id === `${release.workflow_id}:placement:onboarding-placement-1:rule:target-rule-1:start`));
  assert.ok(graph.blocks.some((block) => block.id === `${release.workflow_id}:placement:onboarding-placement-2:rule:target-rule-2:start`));
});

test("legacy traffic holdout preserves exact zero and full basis-point boundaries", async () => {
  const snapshot = sourceSnapshot();
  snapshot.sources.paywalls.tables.experiences[0].traffic_percent = 0;
  snapshot.sources.onboardings.tables.experiences[0].traffic_percentage = 10000;
  const plan = await buildFlowsCutoverPlan({
    snapshot,
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-1",
  });
  const splitBySource = Object.fromEntries(["paywalls", "onboardings"].map((source) => {
    const release = plan.entities.find((item) => item.id === `${source}.releases`).rows[0];
    const version = plan.entities.find((item) => item.id === `${source}.versions`).rows
      .find((row) => row.id === release.workflow_version_id);
    const split = JSON.parse(version.graph_json).blocks.find((block) =>
      block.type === "traffic-split"
    );
    return [source, split];
  }));
  assert.equal(splitBySource.paywalls.data.traffic_basis_points, 0);
  assert.equal(splitBySource.onboardings.data.traffic_basis_points, 10000);
  assert.ok(splitBySource.paywalls.exitNodes.includes("holdout"));
  assert.ok(splitBySource.onboardings.exitNodes.includes("holdout"));
});

test("an Onboarding release preserves simultaneous placements sharing one version", async () => {
  const snapshot = sourceSnapshot();
  snapshot.sources.onboardings.tables.placements.push({
    id: "onboarding-placement-2",
    project_id: 7,
    key: "profile-setup",
    name: "Profile setup",
    onboarding_id: "onboarding-1",
    active_version_id: "onboarding-version-1",
    priority: 90,
    active: 1,
    created_at: "2026-08-03T10:00:00.000Z",
    updated_at: CAPTURED_AT,
  });
  const plan = await buildFlowsCutoverPlan({
    snapshot,
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-1",
  });
  const release = plan.entities.find((item) => item.id === "onboardings.releases").rows[0];
  const versions = plan.entities.find((item) => item.id === "onboardings.versions").rows;
  assert.equal(versions.length, 1);
  const graph = JSON.parse(
    versions.find((row) => row.id === release.workflow_version_id).graph_json,
  );
  const tours = graph.blocks.filter((block) => block.type === "tour");
  assert.deepEqual(
    [...new Set(tours.map((block) => block.slotId))].sort(),
    ["first-run", "profile-setup"],
  );
  assert.ok(graph.blocks.some((block) =>
    block.id === `${release.workflow_id}:placement:onboarding-placement-2:start`
  ));
});

test("the same raw legacy event id in both modules stays isolated and reversible", async () => {
  const snapshot = sourceSnapshot();
  snapshot.sources.onboardings.tables.events[0].id = "paywall-event-1";
  const plan = await buildFlowsCutoverPlan({ snapshot, adapter: new FixtureFlowsCutoverAdapter(), environmentId: "env-1" });
  const eventIds = plan.entities.flatMap((item) => item.id.endsWith(".analytics") ? item.rows.map((row) => row.event_id) : []);
  assert.deepEqual(eventIds.sort(), ["legacy:onboardings:paywall-event-1", "legacy:paywalls:paywall-event-1"]);
  const claims = plan.entities.flatMap((item) => item.id.endsWith(".claims") ? item.rows : []);
  assert.equal(claims.length, 2);
  assert.ok(claims.every((row) => row.event_id === "paywall-event-1"));
  assert.deepEqual(claims.map((row) => row.source_module).sort(), ["onboardings", "paywalls"]);
});

test("apply authority is bound to MBZA, the exact D1 identities, window, freeze and confirmation", async () => {
  const plan = await buildFlowsCutoverPlan({ snapshot: sourceSnapshot(), adapter: new FixtureFlowsCutoverAdapter(), environmentId: "env-1" });
  assert.throws(() => assertMbzaDevelopment("vocostar", "production"), /VocoStar production is intentionally disabled/u);
  const window = createCutoverWindow({ projectRef: plan.project.project_ref, startsAt: "2026-08-13T09:00:00Z", endsAt: "2026-08-13T11:00:00Z", reason: "test", approvedBy: "qa", windowId: "window-1234" });
  const backupPlan = createBackupPlan({
    target: "mbza-development", environment: "development", projectRef: plan.project.project_ref,
    resources: fakeResources(), workers: fakeWorkers(), outputDirectory: "/protected/apply", generatedAt: CAPTURED_AT,
  });
  const backupReceipt = {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION, receipt_id: "backup-1", target: "mbza-development", environment: "development",
    project_ref: plan.project.project_ref, window_id: window.window_id, backup_plan_id: backupPlan.backup_plan_id, completed_at: CAPTURED_AT, automatic_deletion: false,
    artifacts: backupPlan.databases.map((database) => ({
      logical_name: database.logical_name,
      database_name: database.database_name,
      database_id: database.database_id,
      time_travel_bookmark: `bookmark-${database.logical_name}`, bytes: 42, sha256: "b".repeat(64),
      r2_bucket: database.r2_bucket, r2_key: database.r2_key, r2_etag: `etag-${database.logical_name}`, r2_verified_at: CAPTURED_AT,
    })),
  };
  const freezeReceipt = {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION, receipt_id: "freeze-1", target: "mbza-development", environment: "development",
    project_ref: plan.project.project_ref, project_id: plan.project.project_id, plan_id: "pre-freeze-plan-id",
    window_id: window.window_id, enabled: true, confirmed_at: CAPTURED_AT,
  };
  const confirm = confirmationValue("CUTOVER", plan.project.project_ref, window.window_id, plan.plan_id);
  const safety = validateApplySafety({ plan, window, backupPlan, backupReceipt, freezeReceipt, confirm, now: new Date(CAPTURED_AT) });
  assert.equal(safety.plan_id, plan.plan_id);
  const forged = structuredClone(backupReceipt);
  forged.artifacts.find((item) => item.logical_name === "paywalls").database_id = "another-db";
  assert.throws(() => validateApplySafety({ plan, window, backupPlan, backupReceipt: forged, freezeReceipt, confirm, now: new Date(CAPTURED_AT) }), /canonical backup plan|protected import plan/u);
});

test("reverse delta and rollback simulation preserve evidence and never delete, restore, or thaw", async () => {
  const adapter = new FixtureFlowsCutoverAdapter();
  const plan = await buildFlowsCutoverPlan({ snapshot: sourceSnapshot(), adapter, environmentId: "env-1" });
  await applyFlowsCutoverPlan({ plan, adapter, safety: applySafety(plan) });
  adapter.fixture.target_rows["paywalls.workflows"][0].name = "Edited after cutover";
  adapter.fixture.target_rows["paywalls.legacy_versions"][0].changelog = "Edited version";
  adapter.fixture.target_rows["paywalls.placements"][0].priority = 101;
  adapter.fixture.target_rows["paywalls.variants"][0].weight = 101;
  adapter.fixture.target_rows["onboardings.experiments"][0].name = "Edited experiment";
  adapter.fixture.target_rows["onboardings.targeting_rules"][0].priority = 101;
  const currentRowsByEntity = Object.fromEntries(await Promise.all(plan.entities.map(async (item) => [item.id, await adapter.readTarget(FLOW_CUTOVER_ENTITY_BY_ID.get(item.id))])));
  const delta = buildReverseDelta({ baselinePlan: plan, currentRowsByEntity });
  assert.equal(delta.replayable, true);
  const sql = reverseDeltaSql(delta);
  assert.match(sql.paywalls.sql, /INSERT INTO "paywalls"/u);
  assert.doesNotMatch(sql.paywalls.sql, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/u);
  const onboardingExperience = delta.destinations.find((item) => item.source_module === "onboardings" && item.table === "experiences");
  assert.equal(onboardingExperience.rows[0].id, "onboarding-experience-1");
  assert.equal(onboardingExperience.rows[0].placement_id, "onboarding-placement-1");
  assert.equal(onboardingExperience.rows[0].traffic_percentage, 1234);
  const paywallWorkflow = delta.destinations.find((item) => item.source_module === "paywalls" && item.table === "paywalls");
  assert.equal(paywallWorkflow.rows[0].id, "paywall-1");
  const paywallVersion = delta.destinations.find((item) => item.source_module === "paywalls" && item.table === "paywall_versions");
  assert.equal(paywallVersion.rows[0].id, "paywall-version-1");
  assert.equal(paywallVersion.rows[0].paywall_id, "paywall-1");
  const paywallPlacement = delta.destinations.find((item) => item.source_module === "paywalls" && item.table === "placements");
  assert.equal(paywallPlacement.rows[0].id, "paywall-placement-1");
  assert.equal(paywallPlacement.rows[0].active_version_id, "paywall-version-1");
  assert.equal(paywallPlacement.rows[0].experience_id, "paywall-experience-1");
  const paywallVariant = delta.destinations.find((item) => item.source_module === "paywalls" && item.table === "variants");
  assert.equal(paywallVariant.rows[0].id, "paywall-variant-1");
  assert.equal(paywallVariant.rows[0].experience_id, "paywall-experience-1");
  assert.equal(paywallVariant.rows[0].version_id, "paywall-version-1");
  const onboardingRule = delta.destinations.find((item) => item.source_module === "onboardings" && item.table === "targeting_rules");
  assert.equal(onboardingRule.rows[0].id, "target-rule-1");
  assert.equal(onboardingRule.rows[0].placement_id, "onboarding-placement-1");

  const backupPlan = createBackupPlan({
    target: "mbza-development",
    environment: "development",
    projectRef: plan.project.project_ref,
    resources: fakeResources(),
    workers: fakeWorkers(),
    outputDirectory: "/protected/flows-cutover",
    generatedAt: CAPTURED_AT,
  });
  const freezeReceipt = {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION, receipt_id: "freeze-1", target: "mbza-development", environment: "development",
    project_ref: plan.project.project_ref, project_id: plan.project.project_id, plan_id: plan.plan_id, window_id: "window-1234", enabled: true,
    confirmed_at: CAPTURED_AT,
  };
  const backupReceipt = {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION, receipt_id: "backup-1", target: "mbza-development", environment: "development",
    project_ref: plan.project.project_ref, window_id: freezeReceipt.window_id, backup_plan_id: backupPlan.backup_plan_id, completed_at: CAPTURED_AT,
    automatic_deletion: false,
    artifacts: backupPlan.databases.map((database) => ({
      logical_name: database.logical_name, database_name: database.database_name, database_id: database.database_id,
      time_travel_bookmark: `bookmark-${database.logical_name}`, bytes: 10, sha256: "a".repeat(64),
      r2_bucket: database.r2_bucket, r2_key: database.r2_key, r2_etag: `etag-${database.logical_name}`, r2_verified_at: CAPTURED_AT,
    })),
  };
  const versions = { dashboard: "v-dashboard", api: "v-api", paywalls: "v-paywalls", onboardings: "v-onboardings" };
  const confirm = confirmationValue("ROLLBACK", plan.project.project_ref, freezeReceipt.window_id, plan.plan_id);
  const rollback = createRollbackPlan({ plan, backupPlan, backupReceipt, freezeReceipt, reverseDelta: delta, versions, confirm });
  assert.equal(rollback.blocked, false);
  assert.equal(rollback.thaw_included, false);
  assert.deepEqual(rollback.deletion_commands, []);
  assert.ok(rollback.manual_emergency_only.every((item) => item.warning.includes("never executed")));
  assert.ok(rollback.steps.every((step) => step.action !== "thaw"));
  assert.equal(rollback.steps[0].action, "keep-freeze-enabled");
  assert.equal(rollback.steps[1].action, "disable-flows-routing-before-replay");

  const anotherBackupPlan = createBackupPlan({
    target: "mbza-development", environment: "development", projectRef: "43-test",
    resources: fakeResources(), workers: fakeWorkers(), outputDirectory: "/protected/other", generatedAt: CAPTURED_AT,
  });
  assert.throws(
    () => createRollbackPlan({ plan, backupPlan: anotherBackupPlan, backupReceipt, freezeReceipt, reverseDelta: delta, versions, confirm }),
    /canonical backup plan/u,
  );
  const forgedDelta = structuredClone(delta);
  forgedDelta.baseline_plan_id = "another-plan";
  assert.throws(
    () => createRollbackPlan({ plan, backupPlan, backupReceipt, freezeReceipt, reverseDelta: forgedDelta, versions, confirm }),
    /exact protected import plan/u,
  );

  const deletedRows = structuredClone(currentRowsByEntity);
  deletedRows["paywalls.workflows"] = [];
  const blocked = buildReverseDelta({ baselinePlan: plan, currentRowsByEntity: deletedRows });
  assert.equal(blocked.replayable, false);
  assert.ok(blocked.blockers.some((item) => item.includes("deletions_require_manual_reconciliation")));
});

test("the complete generated import executes twice with identical raw ids isolated across projects", async () => {
  const plan = await buildFlowsCutoverPlan({ snapshot: sourceSnapshot(), adapter: new FixtureFlowsCutoverAdapter(), environmentId: "env-1" });
  const otherSnapshot = sourceSnapshot();
  otherSnapshot.project = { project_id: 8, project_ref: "43-test", instance_id: 43 };
  for (const source of ["paywalls", "onboardings"]) {
    otherSnapshot.sources[source].tables = Object.fromEntries(
      Object.entries(otherSnapshot.sources[source].tables).map(([table, rows]) => [
        table,
        rows.map((row) => ({ ...row, project_id: 8 })),
      ]),
    );
  }
  const otherPlan = await buildFlowsCutoverPlan({
    snapshot: otherSnapshot,
    adapter: new FixtureFlowsCutoverAdapter(),
    environmentId: "env-2",
  });
  const directory = await mkdtemp(join(tmpdir(), "flows-cutover-schema-test-"));
  const database = join(directory, "flows.sqlite3");
  try {
    const migrationDirectory = resolve("workers/flows/migrations");
    const migrationNames = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
    const migrations = await Promise.all(migrationNames.map((name) => readFile(resolve(migrationDirectory, name), "utf8")));
    const seeds = `
      INSERT INTO flow_projects (project_id,project_ref,sdk_identifier,created_by,created_at,updated_at)
      VALUES (7,'42-test','project-42-test','test','${CAPTURED_AT}','${CAPTURED_AT}');
      INSERT INTO flow_environments (id,project_id,name,key,kind,sdk_key_hash,active,allow_draft,created_at,updated_at)
      VALUES ('env-1',7,'Test','test','test','hash',1,1,'${CAPTURED_AT}','${CAPTURED_AT}');
      INSERT INTO flow_projects (project_id,project_ref,sdk_identifier,created_by,created_at,updated_at)
      VALUES (8,'43-test','project-43-test','test','${CAPTURED_AT}','${CAPTURED_AT}');
      INSERT INTO flow_environments (id,project_id,name,key,kind,sdk_key_hash,active,allow_draft,created_at,updated_at)
      VALUES ('env-2',8,'Test','test','test','hash-2',1,1,'${CAPTURED_AT}','${CAPTURED_AT}');
    `;
    const otherProjectSql = otherPlan.entities.map((item) =>
      upsertSql(FLOW_CUTOVER_ENTITY_BY_ID.get(item.id), item.rows)
    ).join("\n");
    const importSql = plan.entities.map((item) => upsertSql(FLOW_CUTOVER_ENTITY_BY_ID.get(item.id), item.rows)).join("\n");
    const execution = spawnSync("sqlite3", [database], { input: [...migrations, seeds, otherProjectSql, importSql].join("\n"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    for (const item of plan.entities) {
      const entity = FLOW_CUTOVER_ENTITY_BY_ID.get(item.id);
      const source = entity.sourceModule;
      const querySql = entity.targetQuery
        .replaceAll(":project_id", "7")
        .replaceAll(":environment_id", "'env-1'")
        .replaceAll(":source_module", `'${source}'`)
        .replaceAll(":event_prefix", `'legacy:${source}:%'`)
        .replaceAll(":user_prefix", `'legacy_${source}_%'`)
        .replaceAll(":audit_action", `'flows.cutover.${source}.imported'`);
      const queryResult = spawnSync("sqlite3", [database, querySql], { encoding: "utf8" });
      assert.equal(queryResult.status, 0, `${entity.id}: ${queryResult.stderr || queryResult.stdout}`);
    }
    const query = spawnSync("sqlite3", [database, "SELECT (SELECT count(*) FROM flow_workflows),(SELECT count(*) FROM flow_analytics_events),(SELECT count(*) FROM flow_legacy_event_claims);"], { encoding: "utf8" });
    assert.equal(query.status, 0, query.stderr || query.stdout);
    assert.equal(query.stdout.trim(), "4|4|4");
    const repeatedEvents = spawnSync("sqlite3", [database, "SELECT count(*) FROM (SELECT event_id FROM flow_analytics_events GROUP BY event_id HAVING count(*) = 2);"], { encoding: "utf8" });
    assert.equal(repeatedEvents.status, 0, repeatedEvents.stderr || repeatedEvents.stdout);
    assert.equal(repeatedEvents.stdout.trim(), "2");
    const isolatedGlobalIds = spawnSync("sqlite3", [database, `
      SELECT
        (SELECT count(*) FROM flow_workflows),
        (SELECT count(DISTINCT id) FROM flow_workflows),
        (SELECT count(*) FROM flow_workflow_versions),
        (SELECT count(DISTINCT id) FROM flow_workflow_versions),
        (SELECT count(*) FROM flow_legacy_versions),
        (SELECT count(DISTINCT id) FROM flow_legacy_versions),
        (SELECT count(*) FROM flow_legacy_placements),
        (SELECT count(DISTINCT id) FROM flow_legacy_placements);
    `], { encoding: "utf8" });
    assert.equal(isolatedGlobalIds.status, 0, isolatedGlobalIds.stderr || isolatedGlobalIds.stdout);
    assert.equal(isolatedGlobalIds.stdout.trim(), "4|4|4|4|4|4|4|4");
    const forbiddenTables = spawnSync("sqlite3", [database, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('flow_organizations','flow_members','flow_invitations','flow_billing_cycles','flow_mtu_users','flow_usage_alerts');"], { encoding: "utf8" });
    assert.equal(forbiddenTables.status, 0, forbiddenTables.stderr || forbiddenTables.stdout);
    assert.equal(forbiddenTables.stdout.trim(), "0");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("every source extraction query executes against the real legacy D1 schemas", async () => {
  const snapshot = sourceSnapshot();
  const directory = await mkdtemp(join(tmpdir(), "flows-cutover-source-schema-test-"));
  try {
    for (const source of ["paywalls", "onboardings"]) {
      const database = join(directory, `${source}.sqlite3`);
      const migrationDirectory = resolve(`workers/${source}/migrations`);
      const migrationNames = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
      const migrations = await Promise.all(migrationNames.map((name) => readFile(resolve(migrationDirectory, name), "utf8")));
      const inserts = Object.entries(snapshot.sources[source].tables).flatMap(([table, rows]) => rows.map((row) => {
        const columns = Object.keys(row);
        return `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map((column) => testSqlLiteral(row[column])).join(",")});`;
      }));
      const seed = spawnSync("sqlite3", [database], { input: [...migrations, ...inserts].join("\n"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      assert.equal(seed.status, 0, `${source}: ${seed.stderr || seed.stdout}`);
      for (const descriptor of FLOW_SOURCE_QUERIES[source]) {
        const query = descriptor.query.replaceAll(":source_project_id", "7");
        const result = spawnSync("sqlite3", [database, query], { encoding: "utf8" });
        assert.equal(result.status, 0, `${source}.${descriptor.table}: ${result.stderr || result.stdout}`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function applySafety(plan) {
  return {
    target: plan.target,
    environment: plan.environment,
    project_ref: plan.project.project_ref,
    project_id: plan.project.project_id,
    plan_id: plan.plan_id,
    window_id: "window-1234",
  };
}

function sourceSnapshot() {
  return {
    schema_version: 1,
    target: "mbza-development",
    environment: "development",
    captured_at: CAPTURED_AT,
    project: { project_id: 7, project_ref: "42-test", instance_id: 42 },
    sources: {
      paywalls: {
        bookmark: "bookmark-paywalls",
        bookmark_verified_stable: true,
        database_name: "superboard-dev-paywalls-db",
        database_id: "paywalls-db-id",
        tables: {
          paywalls: [{ id: "paywall-1", project_id: 7, name: "Premium", identifier: "premium", description: "Premium offer", archived_at: null, updated_at: CAPTURED_AT, created_at: "2026-08-01T10:00:00.000Z" }],
          paywall_versions: [{ id: "paywall-version-1", paywall_id: "paywall-1", project_id: 7, version: 1, status: "published", definition_json: JSON.stringify({ schema_version: 1, components: [{ type: "title", text: "Premium" }], theme: { accent: "#f00" }, metadata: { offering_identifier: "premium" } }), schema_version: 1, changelog: "Initial", created_by: "user-1", published_at: "2026-08-02T10:00:00.000Z", created_at: "2026-08-01T10:00:00.000Z" }],
          placements: [{ id: "paywall-placement-1", project_id: 7, key: "settings", paywall_id: "paywall-1", active_version_id: "paywall-version-1", experience_id: "paywall-experience-1", targeting_json: JSON.stringify({ platforms: ["ios"] }), priority: 100, active: 1, created_at: "2026-08-01T10:00:00.000Z", updated_at: CAPTURED_AT }],
          experiences: [{ id: "paywall-experience-1", project_id: 7, paywall_id: "paywall-1", name: "Offer split", status: "running", traffic_percent: 100, starts_at: null, ends_at: null, created_at: "2026-08-01T10:00:00.000Z", updated_at: CAPTURED_AT }],
          variants: [{ id: "paywall-variant-1", project_id: 7, experience_id: "paywall-experience-1", version_id: "paywall-version-1", key: "control", weight: 100, active: 1, created_at: "2026-08-01T10:00:00.000Z", updated_at: CAPTURED_AT }],
          events: [{ id: "paywall-event-1", project_id: 7, placement: "settings", event_type: "purchase", occurred_at: "2026-08-12T10:00:00.000Z", payload_json: JSON.stringify({ product_id: "premium.monthly" }), paywall_id: "paywall-1", version_id: "paywall-version-1", experience_id: "paywall-experience-1", variant_id: "paywall-variant-1", platform: "ios", customer_id: "customer-1", session_id: "session-1", revenue_micros: 9990000, currency: "USD" }],
        },
      },
      onboardings: {
        bookmark: "bookmark-onboardings",
        bookmark_verified_stable: true,
        database_name: "superboard-dev-onboardings-db",
        database_id: "onboardings-db-id",
        tables: {
          onboardings: [{ id: "onboarding-1", project_id: 7, name: "Welcome", identifier: "welcome", display_name: "Welcome", active_version: 1, active_version_id: "onboarding-version-1", description: "First run", updated_at: CAPTURED_AT, created_at: "2026-08-01T11:00:00.000Z" }],
          onboarding_versions: [{ id: "onboarding-version-1", onboarding_id: "onboarding-1", project_id: 7, version: 1, status: "published", definition_json: JSON.stringify({ screens: [{ id: "intro", blocks: [{ type: "marketing_consent", props: { default: true, required: true } }] }], theme: {} }), published_at: "2026-08-02T11:00:00.000Z", created_at: "2026-08-01T11:00:00.000Z" }],
          placements: [{ id: "onboarding-placement-1", project_id: 7, key: "first-run", name: "First run", onboarding_id: "onboarding-1", active_version_id: "onboarding-version-1", priority: 100, active: 1, created_at: "2026-08-01T11:00:00.000Z", updated_at: CAPTURED_AT }],
          targeting_rules: [{ id: "target-rule-1", project_id: 7, placement_id: "onboarding-placement-1", name: "French", priority: 100, conditions_json: JSON.stringify([{ key: "locale", operator: "equals", value: "fr" }]), active: 1, created_at: "2026-08-01T11:00:00.000Z", updated_at: CAPTURED_AT }],
          experiences: [{ id: "onboarding-experience-1", project_id: 7, placement_id: "onboarding-placement-1", name: "Tour split", status: "running", traffic_percentage: 1234, created_at: "2026-08-01T11:00:00.000Z", updated_at: CAPTURED_AT }],
          experience_variants: [{ id: "onboarding-variant-1", project_id: 7, experience_id: "onboarding-experience-1", name: "control", weight: 10000, version_id: "onboarding-version-1", created_at: "2026-08-01T11:00:00.000Z" }],
          events: [{ id: "paywall-event-1", project_id: 7, placement: "first-run", event_type: "complete", occurred_at: "2026-08-12T11:00:00.000Z", payload_json: JSON.stringify({ completed: true }), platform: "web", onboarding_id: "onboarding-1", version_id: "onboarding-version-1", experience_id: "onboarding-experience-1", variant_id: "onboarding-variant-1", step_id: "intro", customer_id: "customer-2" }],
        },
      },
    },
  };
}

function fakeResources() {
  return {
    d1: { name: "superboard-dev-db", id: "api-db-id" },
    moduleD1: {
      paywalls: { name: "superboard-dev-paywalls-db", id: "paywalls-db-id" },
      onboardings: { name: "superboard-dev-onboardings-db", id: "onboardings-db-id" },
      flows: { name: "db-flows", id: "id-flows" },
    },
    moduleR2: { flows: { name: "flows-archive" } },
  };
}

function fakeWorkers() {
  return Object.fromEntries(["paywalls", "onboardings", "api", "dashboard", "flows"].map((service) => [service, { development: `${service}-dev` }]));
}

function testSqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}
