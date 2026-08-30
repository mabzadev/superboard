import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson, canonicalValue, sha256 } from "./core-primitives.mjs";
import { FLOW_CUTOVER_ENTITIES, FLOW_CUTOVER_ENTITY_BY_ID } from "./registry.mjs";
import {
  assertNoMetricPollution,
  assertRuntimeCompatibleUserHashes,
  collectLegacyUserIds,
  transformLegacySnapshot,
} from "./transform.mjs";

export const FLOWS_CUTOVER_SCHEMA_VERSION = 2;
export const FLOWS_CUTOVER_TOOL_VERSION = "2.3.0";
export const FLOWS_CUTOVER_TARGET = "mbza-development";
export const FLOWS_CUTOVER_ENVIRONMENT = "development";
export const FLOWS_CUTOVER_SOURCES = Object.freeze(["paywalls", "onboardings"]);

// Runtime projections can be rebuilt from replayed events. Administrative graph
// drafts, immutable versions and releases are deliberately *not* treated as
// disposable: a post-cutover change there blocks automatic rollback.
const DERIVED_REVERSE_ENTITIES = /\.(?:claims|mappings|users|states|assignments|audit)$/u;

export function assertMbzaDevelopment(target, environment) {
  if (target !== FLOWS_CUTOVER_TARGET || environment !== FLOWS_CUTOVER_ENVIRONMENT) {
    throw new Error("Flows cutover is restricted to --target mbza-development --environment development; VocoStar production is intentionally disabled");
  }
  return true;
}

export function parseProjectRef(projectRef) {
  const match = /^(\d+)-(prod|test)$/u.exec(String(projectRef || ""));
  if (!match) throw new Error("--project-ref must use <instance_id>-prod or <instance_id>-test");
  const instanceId = Number(match[1]);
  if (!Number.isSafeInteger(instanceId) || instanceId < 1) throw new Error("Invalid project instance id");
  return {
    project_ref: `${instanceId}-${match[2]}`,
    instance_id: instanceId,
    project_environment: match[2] === "prod" ? "production" : "test",
  };
}

export function confirmationValue(operation, projectRef, windowId, planId = "none") {
  const normalized = String(operation || "").toUpperCase();
  if (!new Set(["CUTOVER", "FREEZE", "THAW", "ROLLBACK", "ROUTE-ON", "ROUTE-OFF"]).has(normalized)) {
    throw new Error(`Unknown Flows cutover confirmation operation ${operation}`);
  }
  return `FLOWS-${normalized}:${FLOWS_CUTOVER_TARGET}:${FLOWS_CUTOVER_ENVIRONMENT}:${parseProjectRef(projectRef).project_ref}:${windowId}:${planId}`;
}

export function routingVerificationEvidence(plan, verification) {
  assertPlanIntegrity(plan);
  if (
    !verification ||
    verification.schema_version !== FLOWS_CUTOVER_SCHEMA_VERSION ||
    verification.mode !== "verify" ||
    verification.target !== FLOWS_CUTOVER_TARGET ||
    verification.environment !== FLOWS_CUTOVER_ENVIRONMENT ||
    verification.plan_id !== plan.plan_id ||
    verification.project?.project_ref !== plan.project.project_ref ||
    String(verification.project?.project_id) !== String(plan.project.project_id) ||
    verification.ready !== true ||
    !Array.isArray(verification.entities) ||
    verification.entities.length !== plan.entities.length ||
    verification.entities.some((entity) => entity?.matches !== true) ||
    !Array.isArray(verification.mismatches) ||
    verification.mismatches.length !== 0
  ) {
    throw new Error("Flows routing requires a successful verification report for this exact protected plan/project");
  }
  return {
    plan_id: plan.plan_id,
    project_ref: plan.project.project_ref,
    project_id: plan.project.project_id,
    verification_checksum_sha256: sha256(canonicalJson(verification)),
  };
}

export function verifyMbzaRoutingGate({
  inventory,
  scopes,
  checkedAt = new Date().toISOString(),
}) {
  const requiredScopes = [
    { projectId: 1, projectRef: "1-prod" },
    { projectId: 2, projectRef: "1-test" },
  ];
  const canonicalInventory = (inventory ?? [])
    .map((item) => ({
      project_id: Number(item.project_id),
      project_ref: String(item.project_ref),
    }))
    .sort((left, right) => left.project_id - right.project_id);
  if (canonicalJson(canonicalInventory) !== canonicalJson(requiredScopes.map(
    ({ projectId, projectRef }) => ({ project_id: projectId, project_ref: projectRef }),
  ))) {
    throw new Error("MBZA project inventory changed; regenerate the explicit two-scope routing gate before API promotion");
  }
  const reports = requiredScopes.map((requiredScope) => {
    const input = (scopes ?? []).find(
      (scope) => scope?.plan?.project?.project_ref === requiredScope.projectRef,
    );
    if (!input) throw new Error(`${requiredScope.projectRef} routing artifacts are required`);
    const { plan, verification, window, state } = input;
    assertPlanIntegrity(plan);
    if (
      Number(plan.project.project_id) !== requiredScope.projectId ||
      window?.project_ref !== requiredScope.projectRef
    ) {
      throw new Error(`${requiredScope.projectRef} routing artifacts do not match the fixed MBZA project scope`);
    }
    const evidence = routingVerificationEvidence(plan, verification);
    const matches =
      state?.enabled === true &&
      Number(state?.project_id) === requiredScope.projectId &&
      state?.window_id === window.window_id &&
      state?.plan_id === plan.plan_id &&
      state?.verification_checksum_sha256 === evidence.verification_checksum_sha256;
    return {
      project_ref: requiredScope.projectRef,
      project_id: requiredScope.projectId,
      enabled: state?.enabled === true,
      window_id: state?.window_id ?? null,
      plan_id: state?.plan_id ?? null,
      verification_checksum_sha256: state?.verification_checksum_sha256 ?? null,
      matches,
    };
  });
  return {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    mode: "routing-gate",
    target: FLOWS_CUTOVER_TARGET,
    environment: FLOWS_CUTOVER_ENVIRONMENT,
    ready: reports.every((scope) => scope.matches),
    project_inventory: canonicalInventory,
    scopes: reports,
    checked_at: strictIso(checkedAt, "checkedAt"),
    remote_mutation_performed: false,
  };
}

export function createCutoverWindow({ projectRef, startsAt, endsAt, reason, approvedBy, windowId = randomUUID() }) {
  const project = parseProjectRef(projectRef);
  const start = strictIso(startsAt, "startsAt");
  const end = strictIso(endsAt, "endsAt");
  if (Date.parse(start) >= Date.parse(end)) throw new Error("Cutover window startsAt must be before endsAt");
  if (!String(reason || "").trim() || !String(approvedBy || "").trim()) {
    throw new Error("Cutover window requires reason and approvedBy");
  }
  if (!/^[A-Za-z0-9._-]{8,128}$/u.test(String(windowId))) throw new Error("Cutover window id is invalid");
  return {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    target: FLOWS_CUTOVER_TARGET,
    environment: FLOWS_CUTOVER_ENVIRONMENT,
    window_id: String(windowId),
    project_ref: project.project_ref,
    starts_at: start,
    ends_at: end,
    reason: String(reason).trim(),
    approved_by: String(approvedBy).trim(),
    automatic_deletion: false,
  };
}

export function normalizeRows(rows, entity) {
  if (!Array.isArray(rows)) throw new Error(`${entity.id}: rows must be an array`);
  const normalized = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${entity.id}: every row must be an object`);
    if (Object.hasOwn(row, "organization_id")) throw new Error(`${entity.id}: organization_id is forbidden in project-scoped Flows cutover rows`);
    const output = {};
    for (const column of entity.columns) {
      if (!(column in row)) throw new Error(`${entity.id}: row is missing ${column}`);
      let value = row[column] === undefined ? null : row[column];
      if (entity.jsonColumns.includes(column) && value !== null) {
        if (value === "") throw new Error(`${entity.id}.${column}: empty JSON is invalid`);
        value = canonicalJson(typeof value === "string" ? JSON.parse(value) : value);
      }
      if (entity.numericColumns.includes(column) && value !== null) {
        const numeric = Number(value);
        if (!Number.isSafeInteger(numeric)) throw new Error(`${entity.id}.${column}: expected a safe integer`);
        value = numeric;
      }
      output[column] = value;
    }
    return output;
  });
  return normalized.sort((left, right) => entityKey(left, entity.keys).localeCompare(entityKey(right, entity.keys)));
}

export function datasetEvidence(rows, entity) {
  const normalized = normalizeRows(rows, entity);
  return {
    count: normalized.length,
    checksum_sha256: sha256(normalized.map(canonicalJson).join("\n")),
  };
}

export function compareDatasets(expectedRows, actualRows, entity) {
  const expectedRowsNormalized = normalizeRows(expectedRows, entity);
  const actualRowsNormalized = normalizeRows(actualRows, entity);
  const expected = datasetEvidence(expectedRowsNormalized, entity);
  const actual = datasetEvidence(actualRowsNormalized, entity);
  const expectedKeys = new Set(expectedRowsNormalized.map((row) => entityKey(row, entity.keys)));
  const verifiedRows = entity.allowTargetSuperset
    ? actualRowsNormalized.filter((row) => expectedKeys.has(entityKey(row, entity.keys)))
    : actualRowsNormalized;
  const verified = datasetEvidence(verifiedRows, entity);
  return {
    expected,
    actual,
    verified,
    extra_count: entity.allowTargetSuperset ? Math.max(0, actual.count - verified.count) : 0,
    matches: expected.count === verified.count && expected.checksum_sha256 === verified.checksum_sha256,
  };
}

export async function buildFlowsCutoverPlan({
  snapshot,
  adapter,
  environmentId,
  actorId = "flows-cutover",
  entityIds,
}) {
  const selected = selectEntities(entityIds);
  const rawUserIds = collectLegacyUserIds(snapshot);
  if (rawUserIds.length && typeof adapter?.resolveUserHashes !== "function") {
    throw new Error(
      "Flows cutover requires the Worker-backed user hash resolver; refusing to create runtime-incompatible legacy_* identities",
    );
  }
  const resolvedUserHashes = rawUserIds.length
    ? await adapter.resolveUserHashes(snapshot.project, rawUserIds)
    : new Map();
  const transformed = transformLegacySnapshot(snapshot, {
    environmentId,
    actorId,
    entityIds: selected.map((entity) => entity.id),
    userIdHashes: resolvedUserHashes,
  });
  assertNoPhysicalKeyCollisions(transformed.rowsByEntity, selected);
  assertNoMetricPollution(transformed.rowsByEntity);
  assertRuntimeCompatibleUserHashes(transformed.rowsByEntity);
  const project = {
    ...transformed.project,
    environment_id: transformed.environment_id,
  };
  const entities = [];
  for (const entity of selected) {
    const rows = normalizeRows(transformed.rowsByEntity[entity.id] ?? [], entity);
    assertProjectEnvironmentIsolation(rows, entity, project);
    const actualRows = adapter ? normalizeRows(await adapter.readTarget(entity, project), entity) : [];
    assertProjectEnvironmentIsolation(actualRows, entity, project);
    const comparison = compareDatasets(rows, actualRows, entity);
    entities.push({
      id: entity.id,
      source_module: entity.sourceModule,
      target_table: entity.table,
      immutable: entity.immutable,
      allow_target_superset: entity.allowTargetSuperset,
      reversible: Boolean(entity.reverse),
      rows,
      ...comparison,
      action: comparison.matches ? "none" : "upsert",
    });
  }
  const snapshotChecksum = sha256(canonicalJson(snapshot));
  const base = {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    tool_version: FLOWS_CUTOVER_TOOL_VERSION,
    mode: "plan",
    target: FLOWS_CUTOVER_TARGET,
    environment: FLOWS_CUTOVER_ENVIRONMENT,
    project,
    environment_id: transformed.environment_id,
    actor_id: transformed.actor_id,
    captured_at: transformed.captured_at,
    source_bookmarks: transformed.source_bookmarks,
    source_databases: Object.fromEntries(FLOWS_CUTOVER_SOURCES.map((source) => [source, snapshot.sources[source].database_name])),
    source_database_ids: transformed.source_database_ids,
    source_snapshot_checksum_sha256: snapshotChecksum,
    blockers: [],
    converged: entities.every((entity) => entity.matches),
    ready_to_apply: true,
    automatic_deletion: false,
    entities,
  };
  return { ...base, plan_id: planDigest(base) };
}

export function assertPlanIntegrity(plan) {
  if (!plan || plan.schema_version !== FLOWS_CUTOVER_SCHEMA_VERSION || plan.tool_version !== FLOWS_CUTOVER_TOOL_VERSION) {
    throw new Error("Unsupported Flows cutover plan schema/tool version");
  }
  assertMbzaDevelopment(plan.target, plan.environment);
  parseProjectRef(plan.project?.project_ref);
  if (Object.hasOwn(plan, "organization_id") || Object.hasOwn(plan.project ?? {}, "organization_id")) {
    throw new Error("Protected Flows plans must be scoped only by project and environment");
  }
  if (!validScopeId(plan.environment_id) || plan.project?.environment_id !== plan.environment_id) {
    throw new Error("Protected Flows plan environment scope is invalid");
  }
  const expectedPlanId = planDigest(plan);
  if (plan.plan_id !== expectedPlanId) throw new Error("Flows cutover plan integrity check failed; regenerate the protected plan");
  const entities = selectEntities(plan.entities.map((entity) => entity.id));
  for (const entity of entities) {
    const item = plan.entities.find((candidate) => candidate.id === entity.id);
    if (item.source_module !== entity.sourceModule || item.target_table !== entity.table ||
        item.immutable !== entity.immutable || item.reversible !== Boolean(entity.reverse) ||
        item.allow_target_superset !== entity.allowTargetSuperset) {
      throw new Error(`${entity.id}: protected plan registry metadata mismatch`);
    }
    const evidence = datasetEvidence(item.rows, entity);
    assertProjectEnvironmentIsolation(normalizeRows(item.rows, entity), entity, plan.project);
    if (canonicalJson(evidence) !== canonicalJson(item.expected)) {
      throw new Error(`${entity.id}: protected plan rows do not match their canonical checksum`);
    }
  }
  assertNoPhysicalKeyCollisions(Object.fromEntries(plan.entities.map((item) => [item.id, item.rows])), entities);
  assertNoMetricPollution(Object.fromEntries(plan.entities.map((item) => [item.id, item.rows])));
  assertRuntimeCompatibleUserHashes(Object.fromEntries(plan.entities.map((item) => [item.id, item.rows])));
  return true;
}

export async function verifyFlowsCutoverPlan({ plan, adapter }) {
  assertPlanIntegrity(plan);
  const results = [];
  for (const item of plan.entities) {
    const entity = requiredEntity(item.id);
    const actualRows = normalizeRows(await adapter.readTarget(entity, plan.project), entity);
    assertProjectEnvironmentIsolation(actualRows, entity, plan.project);
    results.push({ id: item.id, source_module: item.source_module, ...compareDatasets(item.rows, actualRows, entity) });
  }
  const mismatches = results.filter((result) => !result.matches);
  return {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    mode: "verify",
    target: plan.target,
    environment: plan.environment,
    plan_id: plan.plan_id,
    project: plan.project,
    verified_at: new Date().toISOString(),
    ready: mismatches.length === 0,
    entities: results,
    mismatches: mismatches.map(({ id, expected, actual }) => ({ id, expected, actual })),
    automatic_deletion: false,
  };
}

export async function applyFlowsCutoverPlan({ plan, adapter, safety, checkpoint, onCheckpoint }) {
  assertPlanIntegrity(plan);
  validateBoundSafety(plan, safety);
  await adapter.ensureProjectScope?.(plan.project, plan.environment_id);
  const state = checkpoint ? structuredClone(checkpoint) : createCheckpoint(plan, safety.window_id);
  validateCheckpoint(state, plan, safety.window_id);
  const results = [];
  for (const item of plan.entities) {
    const entity = requiredEntity(item.id);
    const prior = state.entities[item.id];
    let resumed = false;
    const before = normalizeRows(await adapter.readTarget(entity, plan.project), entity);
    if (prior?.status === "verified" && prior.expected_checksum_sha256 === item.expected.checksum_sha256 && compareDatasets(item.rows, before, entity).matches) {
      resumed = true;
    } else if (!compareDatasets(item.rows, before, entity).matches) {
      await adapter.upsert(entity, item.rows, plan.project, upsertSql(entity, item.rows));
    }
    const after = normalizeRows(await adapter.readTarget(entity, plan.project), entity);
    const comparison = compareDatasets(item.rows, after, entity);
    if (!comparison.matches) {
      state.entities[item.id] = checkpointEntry("failed", item.expected, comparison.actual);
      state.updated_at = new Date().toISOString();
      if (onCheckpoint) await onCheckpoint(state);
      await adapter.recordImportStatus?.({ plan, entity, status: "failed", checkpoint: state });
      throw new CutoverMismatchError(item.id, comparison);
    }
    state.entities[item.id] = checkpointEntry("verified", item.expected, comparison.actual);
    state.updated_at = new Date().toISOString();
    await adapter.recordImportStatus?.({ plan, entity, status: "verified", checkpoint: state });
    if (onCheckpoint) await onCheckpoint(state);
    results.push({ id: item.id, source_module: item.source_module, resumed, ...comparison });
  }
  return {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    mode: "apply",
    target: plan.target,
    environment: plan.environment,
    project: plan.project,
    plan_id: plan.plan_id,
    window_id: safety.window_id,
    applied_at: new Date().toISOString(),
    ready: true,
    entities: results,
    checkpoint: state,
    automatic_deletion: false,
  };
}

export class CutoverMismatchError extends Error {
  constructor(entityId, comparison) {
    super(`${entityId}: target count/checksum mismatch; Flows cutover stopped safely`);
    this.name = "CutoverMismatchError";
    this.entityId = entityId;
    this.comparison = comparison;
  }
}

export function createCheckpoint(plan, windowId) {
  assertPlanIntegrity(plan);
  return {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    target: plan.target,
    environment: plan.environment,
    project_ref: plan.project.project_ref,
    project_id: plan.project.project_id,
    environment_id: plan.environment_id,
    plan_id: plan.plan_id,
    source_snapshot_checksum_sha256: plan.source_snapshot_checksum_sha256,
    window_id: String(windowId),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    entities: {},
    automatic_deletion: false,
  };
}

export function validateApplySafety({ plan, window, backupPlan, backupReceipt, freezeReceipt, confirm, now = new Date() }) {
  assertPlanIntegrity(plan);
  validateWindow(window, plan.project.project_ref, now);
  validateBackupReceiptForBackupPlan(backupReceipt, backupPlan);
  validateBackupReceipt(backupReceipt, { projectRef: plan.project.project_ref, windowId: window.window_id });
  validateBackupReceiptForPlan(backupReceipt, plan);
  // The freeze necessarily precedes the final delta snapshot and therefore may
  // reference a pre-freeze plan. Project id + window bind the freeze; the exact
  // final plan is bound separately by the CUTOVER confirmation and checkpoint.
  validateFreezeReceipt(freezeReceipt, { projectRef: plan.project.project_ref, projectId: plan.project.project_id, windowId: window.window_id });
  const expected = confirmationValue("CUTOVER", plan.project.project_ref, window.window_id, plan.plan_id);
  if (confirm !== expected) throw new Error(`Refusing Flows mutation: pass --confirm ${expected}`);
  return {
    target: FLOWS_CUTOVER_TARGET,
    environment: FLOWS_CUTOVER_ENVIRONMENT,
    project_ref: plan.project.project_ref,
    project_id: plan.project.project_id,
    plan_id: plan.plan_id,
    window_id: window.window_id,
    backup_receipt_id: backupReceipt.receipt_id,
    freeze_receipt_id: freezeReceipt.receipt_id,
  };
}

export function validateBackupReceiptForPlan(backupReceipt, plan) {
  for (const source of FLOWS_CUTOVER_SOURCES) {
    const artifact = backupReceipt.artifacts.find((candidate) => candidate.logical_name === source);
    if (artifact.database_name !== plan.source_databases[source] || artifact.database_id !== plan.source_database_ids[source]) {
      throw new Error(`Backup receipt ${source} D1 identity does not match the protected import plan`);
    }
  }
  return true;
}

export function validateCutoverWindow({ window, projectRef, now = new Date() }) {
  validateWindow(window, parseProjectRef(projectRef).project_ref, now);
  return true;
}

export function createBackupPlan({ target, environment, projectRef, resources, workers, outputDirectory, generatedAt = new Date().toISOString() }) {
  assertMbzaDevelopment(target, environment);
  parseProjectRef(projectRef);
  const archive = resources?.moduleR2?.flows?.name;
  const databases = [
    { logical_name: "api", ...(resources?.d1 ?? {}) },
    ...FLOWS_CUTOVER_SOURCES.concat("flows").map((logicalName) => ({
      logical_name: logicalName,
      ...(resources?.moduleD1?.[logicalName] ?? {}),
    })),
  ];
  const blockers = [];
  if (!archive) blockers.push("flows_archive_r2_missing");
  for (const database of databases) {
    if (!database.name) blockers.push(`database_name_missing:${database.logical_name}`);
    if (!database.id) blockers.push(`database_id_unprovisioned:${database.logical_name}`);
  }
  const stamp = generatedAt.replaceAll(":", "-");
  const plan = {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    mode: "backup-plan",
    target,
    environment,
    project_ref: projectRef,
    generated_at: generatedAt,
    output_directory: outputDirectory,
    archive_bucket: archive || null,
    ready: blockers.length === 0,
    blockers,
    exact_bootstrap_instruction: blockers.includes("database_id_unprovisioned:flows")
      ? "node scripts/cloudflare-bootstrap.mjs --target mbza-development --environment development --remote"
      : null,
    databases: databases.map((database) => {
      const identifier = database.id || database.name || "UNPROVISIONED";
      const localPath = `${outputDirectory}/${database.name || "unknown"}.sql`;
      const objectKey = `flows-cutover/${projectRef}/${stamp}/${database.name || "unknown"}.sql`;
      return {
        logical_name: database.logical_name,
        database_name: database.name || null,
        database_id: database.id || null,
        local_path: localPath,
        r2_bucket: archive || null,
        r2_key: objectKey,
        time_travel_command: ["npx", "wrangler", "d1", "time-travel", "info", identifier, "--json"],
        export_command: ["npx", "wrangler", "d1", "export", identifier, "--remote", "--output", localPath],
        upload_command: ["npx", "wrangler", "r2", "object", "put", `${archive || "UNPROVISIONED"}/${objectKey}`, "--remote", "--file", localPath],
      };
    }),
    worker_versions: ["paywalls", "onboardings", "api", "dashboard", "flows"].map((service) => ({
      service,
      worker_name: workers?.[service]?.[environment] ?? null,
      command: workers?.[service]?.[environment]
        ? ["npx", "wrangler", "versions", "list", "--name", workers[service][environment]]
        : null,
    })),
    automatic_deletion: false,
  };
  return { ...plan, backup_plan_id: backupPlanDigest(plan) };
}

export function validateBackupReceipt(receipt, { projectRef, windowId } = {}) {
  if (!receipt || receipt.schema_version !== FLOWS_CUTOVER_SCHEMA_VERSION || receipt.target !== FLOWS_CUTOVER_TARGET || receipt.environment !== FLOWS_CUTOVER_ENVIRONMENT) {
    throw new Error("A valid MBZA Flows backup receipt is required");
  }
  if (projectRef && receipt.project_ref !== projectRef) throw new Error("Backup receipt project_ref mismatch");
  if (windowId && receipt.window_id !== windowId) throw new Error("Backup receipt window_id mismatch");
  if (!/^[a-f0-9]{64}$/u.test(String(receipt.backup_plan_id || ""))) throw new Error("Backup receipt is not bound to a canonical backup plan");
  const artifacts = Array.isArray(receipt.artifacts) ? receipt.artifacts : [];
  for (const source of ["api", ...FLOWS_CUTOVER_SOURCES, "flows"]) {
    const artifact = artifacts.find((candidate) => candidate.logical_name === source);
    if (!artifact || !artifact.database_name || !artifact.database_id || !String(artifact.time_travel_bookmark || "").trim() ||
        !Number.isSafeInteger(Number(artifact.bytes)) || Number(artifact.bytes) < 1 ||
        !/^[a-f0-9]{64}$/u.test(String(artifact.sha256 || "")) || !artifact.r2_bucket || !artifact.r2_key ||
        !String(artifact.r2_etag || "").trim() || !validIso(artifact.r2_verified_at)) {
      throw new Error(`Backup receipt is missing verified Time Travel/R2 evidence for ${source}`);
    }
  }
  if (!validIso(receipt.completed_at) || receipt.automatic_deletion !== false) throw new Error("Backup receipt completion/no-deletion evidence is invalid");
  return true;
}

export function validateBackupReceiptForBackupPlan(receipt, backupPlan) {
  if (!backupPlan || backupPlan.schema_version !== FLOWS_CUTOVER_SCHEMA_VERSION || backupPlan.mode !== "backup-plan") {
    throw new Error("A canonical Flows backup plan is required");
  }
  assertMbzaDevelopment(backupPlan.target, backupPlan.environment);
  parseProjectRef(backupPlan.project_ref);
  const expectedPlanId = backupPlanDigest(backupPlan);
  if (backupPlan.backup_plan_id !== expectedPlanId || receipt.backup_plan_id !== expectedPlanId) {
    throw new Error("Backup receipt does not belong to this canonical backup plan");
  }
  if (backupPlan.ready !== true || (backupPlan.blockers ?? []).length !== 0 || backupPlan.automatic_deletion !== false) {
    throw new Error("Backup plan is incomplete or allows an unsafe cleanup policy");
  }
  validateBackupReceipt(receipt, { projectRef: backupPlan.project_ref });
  for (const logicalName of ["api", ...FLOWS_CUTOVER_SOURCES, "flows"]) {
    const database = backupPlan.databases?.find((candidate) => candidate.logical_name === logicalName);
    const artifact = receipt.artifacts?.find((candidate) => candidate.logical_name === logicalName);
    if (!database || !artifact || artifact.database_name !== database.database_name || artifact.database_id !== database.database_id ||
        artifact.r2_bucket !== database.r2_bucket || artifact.r2_key !== database.r2_key) {
      throw new Error(`Backup receipt ${logicalName} artifact does not match its canonical backup plan`);
    }
  }
  return true;
}

export function validateFreezeReceipt(receipt, { projectRef, projectId, windowId, planId } = {}) {
  if (!receipt || receipt.schema_version !== FLOWS_CUTOVER_SCHEMA_VERSION || receipt.target !== FLOWS_CUTOVER_TARGET || receipt.environment !== FLOWS_CUTOVER_ENVIRONMENT || receipt.enabled !== true) {
    throw new Error("An active MBZA Flows freeze receipt is required");
  }
  if (projectRef && receipt.project_ref !== projectRef) throw new Error("Freeze receipt project_ref mismatch");
  if (projectId && String(receipt.project_id) !== String(projectId)) throw new Error("Freeze receipt project_id mismatch");
  if (windowId && receipt.window_id !== windowId) throw new Error("Freeze receipt window_id mismatch");
  if (planId && receipt.plan_id !== planId) throw new Error("Freeze receipt plan_id mismatch");
  if (!receipt.receipt_id || !validIso(receipt.confirmed_at)) throw new Error("Freeze receipt evidence is incomplete");
  return true;
}

export function buildReverseDelta({ baselinePlan, currentRowsByEntity }) {
  assertPlanIntegrity(baselinePlan);
  const reverseIds = reverseIdIndex(baselinePlan);
  const entities = [];
  const blockers = [];
  const destinations = {};
  for (const baseline of baselinePlan.entities) {
    const entity = requiredEntity(baseline.id);
    const before = new Map(normalizeRows(baseline.rows, entity).map((row) => [entityKey(row, entity.keys), row]));
    const current = normalizeRows(currentRowsByEntity[entity.id] ?? [], entity);
    const currentKeys = new Set(current.map((row) => entityKey(row, entity.keys)));
    const changed = current.filter((row) => canonicalJson(before.get(entityKey(row, entity.keys))) !== canonicalJson(row));
    const deleted = [...before.entries()].filter(([key]) => !currentKeys.has(key)).map(([, row]) => row);
    const derived = !entity.reverse && DERIVED_REVERSE_ENTITIES.test(entity.id);
    if (deleted.length) blockers.push(`${entity.id}:deletions_require_manual_reconciliation`);
    if (changed.length && !entity.reverse && !derived) blockers.push(`${entity.id}:non_reversible_change`);
    if (changed.length && entity.reverse) {
      const destination = reverseDestination(entity, reverseIds);
      const key = `${entity.sourceModule}.${destination.table}`;
      const entry = destinations[key] ?? {
        source_module: entity.sourceModule,
        database_name: baselinePlan.source_databases[entity.sourceModule],
        table: destination.table,
        columns: destination.columns,
        keys: destination.keys,
        rows: [],
      };
      entry.rows.push(...changed.map((row) => destination.convert(row)));
      destinations[key] = entry;
    }
    entities.push({
      id: entity.id,
      source_module: entity.sourceModule,
      changed_count: changed.length,
      deleted_count: deleted.length,
      changed,
      deleted,
      reversible: Boolean(entity.reverse),
      ignored_derived: derived && changed.length > 0,
    });
  }
  for (const destination of Object.values(destinations)) {
    destination.rows = dedupeRows(destination.rows, destination.keys);
    destination.evidence = rawDatasetEvidence(destination.rows, destination.columns);
  }
  return {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    mode: "reverse-delta",
    target: baselinePlan.target,
    environment: baselinePlan.environment,
    project: baselinePlan.project,
    baseline_plan_id: baselinePlan.plan_id,
    generated_at: new Date().toISOString(),
    replayable: blockers.length === 0,
    blockers,
    entities,
    destinations: Object.values(destinations),
    automatic_deletion: false,
  };
}

export function reverseDeltaSql(delta) {
  if (!delta?.replayable) throw new Error("Reverse delta is not replayable; manual reconciliation is required");
  const result = {};
  for (const destination of delta.destinations ?? []) {
    const sql = rawUpsertSql(destination.table, destination.columns, destination.keys, destination.rows);
    result[destination.source_module] ||= { database_name: destination.database_name, statements: [] };
    result[destination.source_module].statements.push(sql);
  }
  return Object.fromEntries(Object.entries(result).map(([source, value]) => [source, {
    database_name: value.database_name,
    sql: ["PRAGMA foreign_keys = ON;", ...value.statements, ""].join("\n"),
  }]));
}

export function createRollbackPlan({ plan, backupPlan, backupReceipt, freezeReceipt, reverseDelta, versions, confirm }) {
  assertPlanIntegrity(plan);
  validateBackupReceiptForBackupPlan(backupReceipt, backupPlan);
  validateBackupReceiptForPlan(backupReceipt, plan);
  if (backupPlan.project_ref !== plan.project.project_ref) throw new Error("Rollback backup plan project does not match the protected import plan");
  validateBackupReceipt(backupReceipt, { projectRef: plan.project.project_ref, windowId: freezeReceipt?.window_id });
  validateFreezeReceipt(freezeReceipt, { projectRef: plan.project.project_ref, projectId: plan.project.project_id, windowId: freezeReceipt?.window_id });
  if (reverseDelta?.baseline_plan_id !== plan.plan_id || reverseDelta?.target !== plan.target || reverseDelta?.environment !== plan.environment ||
      reverseDelta?.project?.project_ref !== plan.project.project_ref || String(reverseDelta?.project?.project_id) !== String(plan.project.project_id)) {
    throw new Error("Reverse delta does not belong to this exact protected import plan/project");
  }
  const expected = confirmationValue("ROLLBACK", plan.project.project_ref, freezeReceipt.window_id, plan.plan_id);
  const blockers = [];
  if (confirm !== expected) blockers.push(`confirmation_required:${expected}`);
  if (!reverseDelta?.replayable) blockers.push("reverse_delta_not_replayable");
  const requiredWorkers = ["dashboard", "api", "paywalls", "onboardings"];
  for (const service of requiredWorkers) if (!String(versions?.[service] || "").trim()) blockers.push(`worker_version_missing:${service}`);
  const sql = reverseDelta?.replayable ? reverseDeltaSql(reverseDelta) : {};
  const workerByService = new Map((backupPlan.worker_versions ?? []).map((entry) => [entry.service, entry]));
  return {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    mode: "rollback",
    target: FLOWS_CUTOVER_TARGET,
    environment: FLOWS_CUTOVER_ENVIRONMENT,
    project_ref: plan.project.project_ref,
    project_id: plan.project.project_id,
    plan_id: plan.plan_id,
    window_id: freezeReceipt.window_id,
    blocked: blockers.length > 0,
    blockers,
    steps: [
      { order: 1, action: "keep-freeze-enabled", command: null },
      { order: 2, action: "disable-flows-routing-before-replay", command: null },
      ...Object.entries(sql).map(([source, value], index) => ({ order: index + 3, action: `replay-${source}-delta`, database_name: value.database_name, sql: value.sql, command_template: ["npx", "wrangler", "d1", "execute", value.database_name, "--remote", "--file", `<protected-${source}-reverse-delta.sql>`] })),
      ...requiredWorkers.map((service, index) => ({
        order: Object.keys(sql).length + index + 3,
        action: `rollback-worker-${service}`,
        command: versions?.[service] && workerByService.get(service)?.worker_name
          ? ["npx", "wrangler", "rollback", versions[service], "--name", workerByService.get(service).worker_name]
          : null,
      })),
      { order: Object.keys(sql).length + requiredWorkers.length + 3, action: "verify-legacy-before-explicit-thaw", command: null },
    ],
    manual_emergency_only: (backupPlan.databases ?? []).map((database) => ({
      logical_name: database.logical_name,
      warning: "Time Travel restore is intentionally never executed by this tool; use only after separate approval and Cloudflare verification.",
      command_template: ["npx", "wrangler", "d1", "time-travel", "restore", database.database_id, "--bookmark", `<bookmark-from-receipt>`],
    })),
    thaw_included: false,
    deletion_commands: [],
    automatic_deletion: false,
  };
}

export function upsertSql(entity, rows) {
  return ["PRAGMA foreign_keys = ON;", rawUpsertSql(entity.table, entity.columns, entity.keys, normalizeRows(rows, entity), entity.immutable), ""].join("\n");
}

export function stripProtectedRows(report) {
  if (!report?.entities) return report;
  return { ...report, entities: report.entities.map(({ rows: _rows, changed: _changed, deleted: _deleted, ...entry }) => entry) };
}

export async function readProtectedJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeProtectedJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(canonicalValue(value), null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function planDigest(plan) {
  return sha256(canonicalJson({
    schema_version: plan.schema_version,
    tool_version: plan.tool_version,
    target: plan.target,
    environment: plan.environment,
    project: plan.project,
    environment_id: plan.environment_id,
    actor_id: plan.actor_id,
    captured_at: plan.captured_at,
    source_bookmarks: plan.source_bookmarks,
    source_databases: plan.source_databases,
    source_database_ids: plan.source_database_ids,
    source_snapshot_checksum_sha256: plan.source_snapshot_checksum_sha256,
    blockers: plan.blockers,
    automatic_deletion: plan.automatic_deletion,
    entities: (plan.entities ?? []).map((entity) => ({
      id: entity.id,
      source_module: entity.source_module,
      target_table: entity.target_table,
      immutable: entity.immutable,
      allow_target_superset: entity.allow_target_superset,
      reversible: entity.reversible,
      expected: entity.expected,
      rows: entity.rows,
    })),
  }));
}

function backupPlanDigest(plan) {
  const { backup_plan_id: _backupPlanId, ...content } = plan;
  return sha256(canonicalJson(content));
}

function selectEntities(entityIds) {
  if (entityIds === undefined) return [...FLOW_CUTOVER_ENTITIES];
  if (!Array.isArray(entityIds) || entityIds.length === 0) throw new Error("At least one Flows cutover entity is required");
  const seen = new Set();
  return entityIds.map((id) => {
    if (seen.has(id)) throw new Error(`Duplicate Flows cutover entity ${id}`);
    seen.add(id);
    return requiredEntity(id);
  });
}

function requiredEntity(id) {
  const entity = FLOW_CUTOVER_ENTITY_BY_ID.get(id);
  if (!entity) throw new Error(`Unknown Flows cutover entity ${id}`);
  return entity;
}

function assertNoPhysicalKeyCollisions(rowsByEntity, entities) {
  const observed = new Map();
  for (const entity of entities) {
    const table = observed.get(entity.table) ?? new Map();
    for (const row of normalizeRows(rowsByEntity[entity.id] ?? [], entity)) {
      const key = entityKey(row, entity.keys);
      const prior = table.get(key);
      if (prior) throw new Error(`Physical key collision in ${entity.table} between ${prior} and ${entity.id}`);
      table.set(key, entity.id);
    }
    observed.set(entity.table, table);
  }
}

function assertProjectEnvironmentIsolation(rows, entity, project) {
  for (const row of rows) {
    if (entity.columns.includes("project_id") && String(row.project_id) !== String(project.project_id)) {
      throw new Error(`${entity.id}: row escaped project scope`);
    }
    if (entity.columns.includes("project_ref") && row.project_ref !== project.project_ref) {
      throw new Error(`${entity.id}: row escaped project_ref scope`);
    }
    if (entity.columns.includes("environment_id") && row.environment_id !== project.environment_id) {
      throw new Error(`${entity.id}: row escaped environment scope`);
    }
  }
}

function validateBoundSafety(plan, safety) {
  if (!safety || safety.target !== plan.target || safety.environment !== plan.environment || safety.project_ref !== plan.project.project_ref ||
      String(safety.project_id) !== String(plan.project.project_id) || safety.plan_id !== plan.plan_id || !safety.window_id) {
    throw new Error("Apply safety evidence is not bound to this exact Flows plan/project/window");
  }
}

function validateCheckpoint(checkpoint, plan, windowId) {
  if (checkpoint.schema_version !== FLOWS_CUTOVER_SCHEMA_VERSION || checkpoint.target !== plan.target || checkpoint.environment !== plan.environment ||
      checkpoint.project_ref !== plan.project.project_ref || String(checkpoint.project_id) !== String(plan.project.project_id) ||
      Object.hasOwn(checkpoint, "organization_id") || checkpoint.environment_id !== plan.environment_id || checkpoint.plan_id !== plan.plan_id ||
      checkpoint.source_snapshot_checksum_sha256 !== plan.source_snapshot_checksum_sha256 || checkpoint.window_id !== windowId ||
      !checkpoint.entities || typeof checkpoint.entities !== "object") {
    throw new Error("Checkpoint does not belong to this exact Flows plan/project/window");
  }
}

function validScopeId(value) {
  return /^[A-Za-z0-9._:-]{1,192}$/u.test(String(value ?? ""));
}

function checkpointEntry(status, expected, actual) {
  return {
    status,
    expected_count: expected.count,
    expected_checksum_sha256: expected.checksum_sha256,
    actual_count: actual.count,
    actual_checksum_sha256: actual.checksum_sha256,
    verified_at: new Date().toISOString(),
  };
}

function validateWindow(window, projectRef, now) {
  if (!window || window.schema_version !== FLOWS_CUTOVER_SCHEMA_VERSION || window.target !== FLOWS_CUTOVER_TARGET || window.environment !== FLOWS_CUTOVER_ENVIRONMENT || window.project_ref !== projectRef) {
    throw new Error("Cutover window does not match MBZA development/project");
  }
  const start = Date.parse(window.starts_at);
  const end = Date.parse(window.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || now.getTime() < start || now.getTime() > end) throw new Error("Current time is outside the approved cutover window");
  if (!window.reason || !window.approved_by || !window.window_id) throw new Error("Cutover window approval is incomplete");
}

function reverseDestination(entity, reverseIds) {
  const source = entity.sourceModule;
  const raw = (flowType, value, label) =>
    rawLegacyId(reverseIds, source, flowType, value, label);
  const destinations = {
    paywalls: {
      workflow: destination("paywalls", ["id", "project_id", "name", "identifier", "description", "archived_at", "updated_at", "created_at"], ["id"], (row) => ({ ...pick(row, ["project_id", "name", "identifier", "description", "archived_at", "updated_at", "created_at"]), id: raw("workflow", row.id, "paywall") })),
      version: destination("paywall_versions", ["id", "paywall_id", "project_id", "version", "status", "definition_json", "schema_version", "changelog", "created_by", "published_at", "created_at"], ["id"], (row) => ({ id: raw("legacy_version", row.id, "paywall version"), paywall_id: raw("workflow", row.workflow_id, "paywall version workflow"), project_id: row.project_id, version: row.version, status: row.status, definition_json: row.definition_json, schema_version: 1, changelog: row.changelog, created_by: null, published_at: row.published_at, created_at: row.created_at })),
      placement: destination("placements", ["id", "project_id", "key", "active_version_id", "active", "paywall_id", "experience_id", "targeting_json", "priority", "created_at", "updated_at"], ["id"], (row) => ({ id: raw("legacy_placement", row.id, "paywall placement"), project_id: row.project_id, key: row.key, active_version_id: rawNullable(reverseIds, source, "legacy_version", row.active_legacy_version_id, "paywall placement version"), active: row.active, paywall_id: raw("workflow", row.workflow_id, "paywall placement workflow"), experience_id: rawNullable(reverseIds, source, "legacy_experiment", row.experience_id, "paywall placement experiment"), targeting_json: row.targeting_json, priority: row.priority, created_at: row.created_at, updated_at: row.updated_at })),
      experiment: destination("experiences", ["id", "project_id", "paywall_id", "name", "status", "traffic_percent", "starts_at", "ends_at", "created_at", "updated_at"], ["id"], (row) => ({ id: raw("legacy_experiment", row.id, "paywall experiment"), project_id: row.project_id, paywall_id: raw("workflow", row.workflow_id, "paywall experiment workflow"), name: row.name, status: row.status, traffic_percent: row.traffic_percent, starts_at: row.starts_at, ends_at: row.ends_at, created_at: row.created_at, updated_at: row.updated_at })),
      variant: destination("variants", ["id", "project_id", "experience_id", "version_id", "key", "weight", "active", "created_at", "updated_at"], ["id"], (row) => ({ id: raw("legacy_variant", row.id, "paywall variant"), project_id: row.project_id, experience_id: raw("legacy_experiment", row.experiment_id, "paywall variant experiment"), version_id: raw("legacy_version", row.legacy_version_id, "paywall variant version"), key: row.key, weight: row.weight, active: row.active, created_at: row.created_at, updated_at: row.updated_at })),
      event: destination("events", ["id", "project_id", "placement", "event_type", "occurred_at", "payload_json", "paywall_id", "version_id", "experience_id", "variant_id", "platform", "customer_id", "session_id", "revenue_micros", "currency"], ["project_id", "id"], (row) => reverseEvent(row, source)),
    },
    onboardings: {
      workflow: destination("onboardings", ["id", "project_id", "name", "identifier", "display_name", "active_version", "active_version_id", "description", "updated_at", "created_at"], ["id"], (row) => ({ id: raw("workflow", row.id, "onboarding"), project_id: row.project_id, name: row.name, identifier: row.identifier, display_name: row.name, active_version: null, active_version_id: null, description: row.description, updated_at: row.updated_at, created_at: row.created_at })),
      version: destination("onboarding_versions", ["id", "onboarding_id", "project_id", "version", "status", "definition_json", "published_at", "created_at"], ["id"], (row) => ({ id: raw("legacy_version", row.id, "onboarding version"), onboarding_id: raw("workflow", row.workflow_id, "onboarding version workflow"), project_id: row.project_id, version: row.version, status: row.status, definition_json: row.definition_json, published_at: row.published_at, created_at: row.created_at })),
      placement: destination("placements", ["id", "project_id", "key", "active_version_id", "active", "name", "onboarding_id", "priority", "created_at", "updated_at"], ["id"], (row) => ({ id: raw("legacy_placement", row.id, "onboarding placement"), project_id: row.project_id, key: row.key, active_version_id: rawNullable(reverseIds, source, "legacy_version", row.active_legacy_version_id, "onboarding placement version"), active: row.active, name: row.key, onboarding_id: raw("workflow", row.workflow_id, "onboarding placement workflow"), priority: row.priority, created_at: row.created_at, updated_at: row.updated_at })),
      experiment: destination("experiences", ["id", "project_id", "placement_id", "name", "status", "traffic_percentage", "created_at", "updated_at"], ["id"], (row) => ({ id: raw("legacy_experiment", row.id, "onboarding experiment"), project_id: row.project_id, placement_id: raw("legacy_placement", row.placement_id, "onboarding experiment placement"), name: row.name, status: row.status === "archived" ? "completed" : row.status, traffic_percentage: Math.max(1, Number(row.traffic_basis_points ?? row.traffic_percent * 100)), created_at: row.created_at, updated_at: row.updated_at })),
      variant: destination("experience_variants", ["id", "project_id", "experience_id", "name", "weight", "version_id", "created_at"], ["id"], (row) => ({ id: raw("legacy_variant", row.id, "onboarding variant"), project_id: row.project_id, experience_id: raw("legacy_experiment", row.experiment_id, "onboarding variant experiment"), name: row.key, weight: row.weight, version_id: raw("legacy_version", row.legacy_version_id, "onboarding variant version"), created_at: row.created_at })),
      targeting_rule: destination("targeting_rules", ["id", "project_id", "placement_id", "name", "priority", "conditions_json", "active", "created_at", "updated_at"], ["id"], (row) => ({ id: raw("legacy_targeting_rule", row.id, "onboarding targeting rule"), project_id: row.project_id, placement_id: raw("legacy_placement", row.placement_id, "onboarding targeting placement"), name: `Rule ${raw("legacy_targeting_rule", row.id, "onboarding targeting rule")}`, priority: row.priority, conditions_json: row.conditions_json, active: row.active, created_at: row.created_at, updated_at: row.updated_at })),
      event: destination("events", ["id", "project_id", "placement", "event_type", "occurred_at", "payload_json", "platform", "onboarding_id", "version_id", "experience_id", "variant_id", "step_id", "customer_id"], ["project_id", "id"], (row) => reverseEvent(row, source)),
    },
  };
  const selected = destinations[source]?.[entity.reverse];
  if (!selected) throw new Error(`${entity.id}: unsupported reverse adapter ${entity.reverse}`);
  return selected;
}

function reverseIdIndex(plan) {
  const index = new Map();
  for (const item of plan.entities) {
    if (!item.id.endsWith(".mappings")) continue;
    for (const row of item.rows) {
      const key = reverseIdKey(row.source_module, row.flow_type, row.flow_id);
      const sourceId = String(row.source_id);
      const previous = index.get(key);
      if (previous !== undefined && previous !== sourceId) {
        throw new Error(
          `${item.id}: flow id ${String(row.flow_id)} has conflicting legacy ids`,
        );
      }
      index.set(key, sourceId);
    }
  }
  return index;
}

function rawLegacyId(index, source, flowType, value, label) {
  const raw = index.get(reverseIdKey(source, flowType, value));
  if (raw === undefined) {
    throw new Error(`${label}: no protected legacy mapping exists for ${String(value)}`);
  }
  return raw;
}

function rawNullable(index, source, flowType, value, label) {
  if (value === null || value === undefined || value === "") return null;
  return rawLegacyId(index, source, flowType, value, label);
}

function reverseIdKey(source, flowType, flowId) {
  return `${String(source)}\u001f${String(flowType)}\u001f${String(flowId)}`;
}

function destination(table, columns, keys, convert) { return { table, columns, keys, convert }; }

function reverseEvent(row, source) {
  const properties = typeof row.properties_json === "string" ? JSON.parse(row.properties_json) : row.properties_json;
  const legacy = properties.legacy && typeof properties.legacy === "object" ? properties.legacy : properties;
  const common = {
    id: String(row.source_event_id ?? properties.legacy_event_id ?? row.event_id),
    project_id: row.project_id,
    placement: properties.legacy_placement ?? legacy.placement ?? "flows",
    event_type: row.legacy_event_type ?? "transition",
    occurred_at: row.occurred_at,
    payload_json: canonicalJson(properties.payload ?? {}),
    platform: properties.legacy_platform ?? legacy.platform ?? null,
    customer_id: row.user_id_hash,
    version_id: properties.legacy_version_id ?? legacy.version_id ?? null,
    experience_id: properties.legacy_experience_id ?? legacy.experience_id ?? null,
    variant_id: properties.legacy_variant_id ?? legacy.variant_id ?? null,
  };
  if (source === "paywalls") return { ...common, paywall_id: properties.legacy_workflow_id ?? legacy.workflow_id ?? null, session_id: null, revenue_micros: Number(properties.legacy_revenue_micros ?? legacy.revenue_micros ?? 0), currency: properties.legacy_currency ?? legacy.currency ?? null };
  return { ...common, onboarding_id: properties.legacy_workflow_id ?? legacy.workflow_id ?? null, step_id: properties.legacy_step_id ?? legacy.step_id ?? null, platform: common.platform ?? "web" };
}

function rawUpsertSql(table, columns, keys, rows, immutable = false) {
  if (!rows.length) return `-- No rows for ${table}.`;
  const mutable = immutable ? [] : columns.filter((column) => !keys.includes(column));
  const update = mutable.length ? `DO UPDATE SET ${mutable.map((column) => `"${column}"=excluded."${column}"`).join(", ")}` : "DO NOTHING";
  const prefix = `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES `;
  const suffix = ` ON CONFLICT (${keys.map((column) => `"${column}"`).join(", ")}) ${update};`;
  const groups = rows.map((row) => `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`);
  const statements = [];
  let chunk = [];
  let size = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
  for (const group of groups) {
    const extra = Buffer.byteLength(group) + (chunk.length ? 2 : 0);
    if (Buffer.byteLength(prefix) + extra + Buffer.byteLength(suffix) > 96 * 1024) throw new Error(`${table}: one row exceeds the safe D1 statement size`);
    if (chunk.length >= 100 || size + extra > 96 * 1024) {
      statements.push(`${prefix}${chunk.join(", ")}${suffix}`);
      chunk = [];
      size = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
    }
    chunk.push(group);
    size += extra;
  }
  if (chunk.length) statements.push(`${prefix}${chunk.join(", ")}${suffix}`);
  return statements.join("\n");
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot encode a non-finite SQL number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function entityKey(row, keys) { return keys.map((key) => canonicalJson(row[key])).join("|"); }

function dedupeRows(rows, keys) {
  const result = new Map();
  for (const row of rows) result.set(entityKey(row, keys), row);
  return [...result.values()].sort((left, right) => entityKey(left, keys).localeCompare(entityKey(right, keys)));
}

function rawDatasetEvidence(rows, columns) {
  const values = rows.map((row) => canonicalJson(pick(row, columns))).sort();
  return { count: rows.length, checksum_sha256: sha256(values.join("\n")) };
}

function pick(row, columns) { return Object.fromEntries(columns.map((column) => [column, row[column] ?? null])); }

function strictIso(value, label) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be an ISO-8601 timestamp`);
  return date.toISOString();
}

function validIso(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
