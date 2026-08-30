import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const CUTOVER_SCHEMA_VERSION = 1;
export const CUTOVER_TOOL_VERSION = "1.0.0";
export const MODULES = Object.freeze([
  "app",
  "identity",
  "settings",
  "content",
  "audit",
  "gateway",
  "products",
  "paywalls",
  "dynamic-links",
  "support",
  "flows",
  "analytics",
  "marketing",
  "email",
  "files",
  "onboardings",
  "observability",
  "mcp",
]);

export function parseProjectRef(projectRef) {
  const match = /^(\d+)-(prod|test)$/u.exec(String(projectRef || ""));
  if (!match) throw new Error("--project-ref must use <instance_id>-prod or <instance_id>-test");
  const instanceId = Number(match[1]);
  if (!Number.isSafeInteger(instanceId) || instanceId < 1) throw new Error("Invalid project instance id");
  return {
    project_ref: `${instanceId}-${match[2]}`,
    instance_id: instanceId,
    environment: match[2] === "prod" ? "production" : "test",
    is_production_project: match[2] === "prod",
  };
}

export function confirmationValue(target, projectRef, windowId, operation = "CUTOVER") {
  return `${operation}:${target}:${projectRef}:${windowId}`;
}

export function validateApplySafety({ target, projectRef, window, confirm, allowProduction = false, now = new Date() }) {
  const project = validateWindow({ projectRef, window, now });
  const expected = confirmationValue(target, project.project_ref, window.window_id);
  if (confirm !== expected) throw new Error(`Refusing mutation: pass --confirm ${expected}`);
  validateProductionPrerequisites(project, window, allowProduction);
  if (project.is_production_project &&
      (window.maintenance?.enabled !== true || window.maintenance?.window_id !== window.window_id)) {
    throw new Error("Production apply requires maintenance read-only evidence for this window");
  }
  return { ...project, window_id: window.window_id };
}

export function validateMaintenanceEnableSafety({ projectRef, window, allowProduction = false, now = new Date() }) {
  const project = validateWindow({ projectRef, window, now });
  validateProductionPrerequisites(project, window, allowProduction);
  return { ...project, window_id: window.window_id };
}

function validateWindow({ projectRef, window, now }) {
  const project = parseProjectRef(projectRef);
  if (!window || window.schema_version !== CUTOVER_SCHEMA_VERSION) throw new Error("A schema_version=1 cutover window is required");
  if (window.project_ref !== project.project_ref) throw new Error("Cutover window project_ref does not match --project-ref");
  if (!/^[a-zA-Z0-9._-]{8,128}$/u.test(String(window.window_id || ""))) throw new Error("Cutover window_id is invalid");
  const startsAt = Date.parse(window.starts_at);
  const endsAt = Date.parse(window.ends_at);
  const timestamp = now.getTime();
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt >= endsAt) {
    throw new Error("Cutover window timestamps are invalid");
  }
  if (timestamp < startsAt || timestamp > endsAt) throw new Error("Current time is outside the approved cutover window");
  if (!String(window.reason || "").trim() || !String(window.approved_by || "").trim()) {
    throw new Error("Cutover window requires reason and approved_by");
  }
  return project;
}

function validateProductionPrerequisites(project, window, allowProduction) {
  if (project.is_production_project) {
    if (!allowProduction) throw new Error("10-prod-style projects require --allow-production");
    const artifacts = window.backup_receipt?.artifacts;
    const declaredRequired = window.backup_receipt?.required_artifacts;
    const requiredArtifacts = new Set(Array.isArray(declaredRequired) && declaredRequired.length > 0
      ? declaredRequired
      : [
        "site-emdash",
        "legacy-api",
        "legacy-messaging",
        "service-email",
        "service-identity",
        "service-files",
        "module-analytics",
        "module-app",
        "module-products",
        "module-paywalls",
        "module-dynamicLinks",
        "module-support",
        "module-marketing",
        "module-onboardings",
      ]);
    const validArtifacts = Array.isArray(artifacts) && artifacts.every((artifact) =>
      artifact && typeof artifact.name === "string" && Number(artifact.bytes) > 0 && /^[a-f0-9]{64}$/u.test(String(artifact.sha256 || "")));
    const observedArtifacts = new Set(Array.isArray(artifacts) ? artifacts.map((artifact) => artifact?.name) : []);
    if (!window.backup_receipt?.completed_at || !validArtifacts || [...requiredArtifacts].some((name) => !observedArtifacts.has(name))) {
      throw new Error("Production apply requires a completed backup receipt for all source and target databases");
    }
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

export function normalizeRows(rows, entity) {
  return rows.map((row) => {
    const normalized = {};
    for (const column of entity.columns) {
      if (!(column in row)) throw new Error(`${entity.id}: source row is missing ${column}`);
      normalized[column] = normalizeScalar(row[column], entity.jsonColumns?.includes(column));
    }
    return normalized;
  });
}

function normalizeScalar(value, jsonColumn) {
  if (!jsonColumn) return value === undefined ? null : value;
  if (value === null || value === undefined) return null;
  if (value === "") throw new Error("Empty string is not valid JSON");
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return canonicalJson(parsed);
}

export function datasetEvidence(rows, entity) {
  const normalized = normalizeRows(rows, entity);
  const encoded = normalized.map(canonicalJson).sort();
  return {
    count: normalized.length,
    checksum: createHash("sha256").update(encoded.join("\n")).digest("hex"),
  };
}

export function compareDatasets(expectedRows, actualRows, entity) {
  const expected = datasetEvidence(expectedRows, entity);
  const actual = datasetEvidence(actualRows, entity);
  return { expected, actual, matches: expected.count === actual.count && expected.checksum === actual.checksum };
}

export function verifyShadowRead({ entity, sourceRows, targetRows, emitMetric = () => undefined }) {
	const comparison = compareDatasets(sourceRows, targetRows, entity);
	const metric = {
		name: "emdash_store_shadow_read",
		tags: { entity_id: entity.id, result: comparison.matches ? "match" : "mismatch" },
		values: {
			source_count: comparison.expected.count,
			target_count: comparison.actual.count,
		},
	};
	emitMetric(metric);
	if (!comparison.matches) throw new CutoverMismatchError(entity.id, comparison);
	return { rows: targetRows, evidence: comparison, metric };
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot encode a non-finite SQL number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function upsertSql(entity, rows) {
	if (!entity.pluginId || !entity.storeId || !entity.repositoryId) {
		throw new Error(`${entity.id}: EmDash plugin Store repository authority is missing`);
	}
	if (entity.repositoryOnly) {
		return `-- plugin=${entity.pluginId} store=${entity.storeId} repository=${entity.repositoryId}\n-- Projection remains read-only during Store authority import.\n`;
	}
	if (rows.length === 0) return "-- No rows to migrate.\n";
  const columns = entity.columns;
  const mutable = entity.immutable ? [] : columns.filter((column) => !entity.keys.includes(column));
  const conflict = entity.keys.map((column) => `"${column}"`).join(", ");
  const update = mutable.length > 0
    ? `DO UPDATE SET ${mutable.map((column) => `"${column}"=excluded."${column}"`).join(", ")}`
    : "DO NOTHING";
  const prefix = `INSERT INTO "${entity.target.table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES `;
  const suffix = ` ON CONFLICT (${conflict}) ${update};`;
  const valueGroups = normalizeRows(rows, entity).map((row) =>
    `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`);
  const statements = [];
  let chunk = [];
  let bytes = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
  for (const values of valueGroups) {
    const valueBytes = Buffer.byteLength(values) + (chunk.length > 0 ? 2 : 0);
    if (Buffer.byteLength(prefix) + valueBytes + Buffer.byteLength(suffix) > 96 * 1024) {
      throw new Error(`${entity.id}: one row exceeds the safe D1 statement size`);
    }
    if (chunk.length >= 100 || bytes + valueBytes > 96 * 1024) {
      statements.push(`${prefix}${chunk.join(", ")}${suffix}`);
      chunk = [];
      bytes = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
    }
    chunk.push(values);
    bytes += valueBytes;
  }
  if (chunk.length) statements.push(`${prefix}${chunk.join(", ")}${suffix}`);
  // Wrangler D1 file imports are not atomic. Each statement is atomic, and the
  // project-scoped UPSERT plus checkpoint verification makes a partial import resumable.
	return [
		`-- plugin=${entity.pluginId} store=${entity.storeId} repository=${entity.repositoryId}`,
		"PRAGMA foreign_keys = ON;",
		...statements,
		"",
	].join("\n");
}

export async function buildPlan({ adapter, registry, guards = [], projectRef, modules = MODULES, entityIds }) {
  const parsed = parseProjectRef(projectRef);
  const context = await adapter.resolveProject(parsed);
  if (String(context.project_ref) !== parsed.project_ref) throw new Error("Resolved project context does not match requested project_ref");
  const selected = selectEntities(registry, modules, entityIds);
  const blockers = [];
  for (const guard of guards.filter((candidate) => modules.includes(candidate.module))) {
    const rows = await adapter.readGuard(guard, context);
    if (rows.length > 0) {
      blockers.push({ id: guard.id, module: guard.module, message: guard.message, count: rows.length });
    }
  }
  const entities = [];
  for (const entity of selected) {
    const extractedRows = await adapter.readSource(entity, context);
    const sourceRows = normalizeRows(entity.transform ? entity.transform(extractedRows, context) : extractedRows, entity);
    assertProjectIsolation(sourceRows, entity, context.project_id);
    const targetRows = normalizeRows(await adapter.readTarget(entity, context), entity);
    assertProjectIsolation(targetRows, entity, context.project_id);
    const repositoryRows = normalizeRows(await adapter.readRepository(entity, context), entity);
    assertProjectIsolation(repositoryRows, entity, context.project_id);
    const projection = compareDatasets(sourceRows, targetRows, entity);
    const repository = compareDatasets(sourceRows, repositoryRows, entity);
    const matches = projection.matches && repository.matches;
    const action = !repository.matches && !projection.matches
      ? "repository_and_projection_upsert"
      : !repository.matches
        ? "repository_upsert"
        : !projection.matches
          ? "projection_upsert"
          : "none";
    entities.push({
      id: entity.id,
      module: entity.module,
      plugin_id: entity.pluginId,
      store_id: entity.storeId,
      repository_id: entity.repositoryId,
      source_database: entity.source.database,
      source_table: entity.source.table,
      target_table: entity.target.table,
      expected: projection.expected,
      actual: projection.actual,
      matches,
      projection,
      repository,
      action,
      rows: sourceRows,
    });
  }
  return {
    schema_version: CUTOVER_SCHEMA_VERSION,
    tool_version: CUTOVER_TOOL_VERSION,
    run_id: randomUUID(),
    mode: "plan",
    generated_at: new Date().toISOString(),
    project: context,
    modules,
    entity_ids: selected.map((entity) => entity.id),
    ready: blockers.length === 0 && entities.every((item) => item.matches),
    blockers,
    entities,
  };
}

export async function applyPlan({ adapter, registry, plan, safety, checkpoint = emptyCheckpoint(plan, safety.window_id), onCheckpoint }) {
  if (plan.blockers?.length) throw new Error(`Cutover plan is blocked: ${plan.blockers.map((item) => item.id).join(", ")}`);
  if (checkpoint.schema_version !== CUTOVER_SCHEMA_VERSION ||
      checkpoint.project_ref !== plan.project.project_ref ||
      String(checkpoint.project_id) !== String(plan.project.project_id) ||
      checkpoint.window_id !== safety.window_id ||
      !checkpoint.entities || typeof checkpoint.entities !== "object") {
    throw new Error("Checkpoint does not belong to this project and cutover window");
  }
  const selected = new Map(selectEntities(registry, plan.modules).map((entity) => [entity.id, entity]));
  const results = [];
  for (const item of plan.entities) {
    const entity = selected.get(item.id);
    if (!entity) throw new Error(`Unknown migration entity ${item.id}`);
    const prior = checkpoint.entities[item.id];
    let resumed = false;
    let actualRows;
    let repositoryRows;
    if (prior?.source_checksum === item.expected.checksum && prior?.status === "verified") {
      actualRows = await adapter.readTarget(entity, plan.project);
      repositoryRows = await adapter.readRepository(entity, plan.project);
      if (
        compareDatasets(item.rows, actualRows, entity).matches &&
        compareDatasets(item.rows, repositoryRows, entity).matches
      ) {
        resumed = true;
      }
    }
    if (!resumed) {
      repositoryRows ??= await adapter.readRepository(entity, plan.project);
      if (!compareDatasets(item.rows, repositoryRows, entity).matches) {
        await adapter.upsertRepository(entity, item.rows, plan.project);
        repositoryRows = await adapter.readRepository(entity, plan.project);
      }
      actualRows ??= await adapter.readTarget(entity, plan.project);
      if (!compareDatasets(item.rows, actualRows, entity).matches) {
        await adapter.upsert(entity, item.rows, plan.project, upsertSql(entity, item.rows));
        actualRows = await adapter.readTarget(entity, plan.project);
      }
    }
    actualRows ??= await adapter.readTarget(entity, plan.project);
    repositoryRows ??= await adapter.readRepository(entity, plan.project);
    const projection = compareDatasets(item.rows, actualRows, entity);
    const repository = compareDatasets(item.rows, repositoryRows, entity);
    if (!repository.matches) {
      throw new CutoverMismatchError(`${entity.id}:repository`, repository);
    }
    if (!projection.matches) {
      throw new CutoverMismatchError(`${entity.id}:projection`, projection);
    }
    checkpoint.entities[item.id] = {
      status: "verified",
      source_count: item.expected.count,
      source_checksum: item.expected.checksum,
      target_checksum: projection.actual.checksum,
      repository_checksum: repository.actual.checksum,
      verified_at: new Date().toISOString(),
    };
    checkpoint.updated_at = new Date().toISOString();
    if (onCheckpoint) await onCheckpoint(checkpoint);
    results.push({
      id: item.id,
      module: item.module,
      plugin_id: entity.pluginId,
      store_id: entity.storeId,
      repository_id: entity.repositoryId,
      resumed,
      expected: projection.expected,
      actual: projection.actual,
      matches: true,
      projection,
      repository,
    });
  }
  return {
    ...plan,
    mode: "apply",
    ready: true,
    applied_at: new Date().toISOString(),
    window_id: safety.window_id,
    entities: results,
    checkpoint,
  };
}

export class CutoverMismatchError extends Error {
  constructor(entityId, comparison) {
    super(`${entityId}: target count/checksum mismatch; cutover aborted`);
    this.name = "CutoverMismatchError";
    this.entityId = entityId;
    this.comparison = comparison;
  }
}

export function createVerificationReport(plan) {
  const mismatches = plan.entities.filter((entity) => !entity.matches).map((entity) => ({
    id: entity.id,
    module: entity.module,
    projection: entity.projection,
    repository: entity.repository,
  }));
  return { ...stripRows(plan), mode: "verify", ready: mismatches.length === 0 && (plan.blockers?.length || 0) === 0, mismatches };
}

export function buildReverseDelta({ baseline, currentRowsByEntity, registry }) {
  const byId = new Map(registry.map((entity) => [entity.id, entity]));
  const entities = [];
  let replayable = true;
  for (const item of baseline.entities) {
    const entity = byId.get(item.id);
    if (!entity) throw new Error(`Unknown baseline entity ${item.id}`);
    const baselineRows = new Map(item.rows.map((row) => [entityKey(row, entity.keys), row]));
    const currentRows = normalizeRows(currentRowsByEntity[item.id] || [], entity);
    const changed = currentRows.filter((row) => canonicalJson(baselineRows.get(entityKey(row, entity.keys))) !== canonicalJson(row));
    const deleted = [...baselineRows.entries()].filter(([key]) => !currentRows.some((row) => entityKey(row, entity.keys) === key)).map(([, row]) => row);
    const canReplay = typeof entity.reverse === "function" && deleted.length === 0;
    if ((changed.length > 0 || deleted.length > 0) && !canReplay) replayable = false;
    entities.push({ id: item.id, module: item.module, changed, deleted, replayable: canReplay || (changed.length === 0 && deleted.length === 0) });
  }
  return {
    schema_version: CUTOVER_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    project: baseline.project,
    replayable,
    entities,
  };
}

export function reverseDeltaSql(delta, registry) {
  if (!delta.replayable) throw new Error("Reverse delta contains deletions or non-reversible entities; manual reconciliation is required");
  const byId = new Map(registry.map((entity) => [entity.id, entity]));
  const grouped = new Map();
  for (const item of delta.entities) {
    const entity = byId.get(item.id);
    if (!entity || item.changed.length === 0) continue;
    const legacy = item.changed.map((row) => entity.reverse(row));
    const key = entity.source.database;
    const statements = grouped.get(key) || [];
    statements.push(upsertSql({ ...entity, columns: entity.reverseColumns, keys: entity.reverseKeys, target: { table: entity.source.table } }, legacy));
    grouped.set(key, statements);
  }
  return Object.fromEntries([...grouped].map(([database, statements]) => [database, statements.join("\n")]));
}

export function createBackupPlan({ target, environment, projectRef, resources, workers, outputDirectory }) {
  const databases = [
    ["site-emdash", resources.siteD1],
    ["legacy-api", resources.d1],
    ...(resources.messagingD1?.name ? [["legacy-messaging", resources.messagingD1]] : []),
    ...(resources.emailD1?.name ? [["service-email", resources.emailD1]] : []),
    ...(resources.identityD1?.name ? [["service-identity", resources.identityD1]] : []),
    ...(resources.filesD1?.name ? [["service-files", resources.filesD1]] : []),
    ...Object.entries(resources.moduleD1).map(([key, value]) => [`module-${key}`, value]),
  ].filter(([, database]) => database?.name);
  return {
    schema_version: CUTOVER_SCHEMA_VERSION,
    target,
    environment,
    project_ref: parseProjectRef(projectRef).project_ref,
    generated_at: new Date().toISOString(),
    output_directory: outputDirectory,
    database_exports: databases.map(([name, database]) => ({
      name,
      database_name: database.name,
      database_id: database.id,
      command: ["npx", "wrangler", "d1", "export", database.id || database.name, "--remote", "--output", `${outputDirectory}/${name}.sql`],
    })),
    worker_versions: Object.entries(workers)
      .filter(([name, names]) => ["api", "dashboard", "billing", "messaging", ...MODULES, "marketing", "onboardings"].includes(name) && names?.[environment])
      .map(([name, names]) => ({
      service: name,
      worker_name: names[environment],
      command: ["npx", "wrangler", "versions", "list", "--name", names[environment]],
      })),
  };
}

export function createRollbackPlan({ backupPlan, backupReceipt = null, versions = {}, reverseDelta = null }) {
  const missingVersions = backupPlan.worker_versions
    .filter((worker) => !versions[worker.service])
    .map((worker) => worker.service);
  const receiptByName = new Map((backupReceipt?.artifacts || [])
    .filter((artifact) => artifact && Number(artifact.bytes) > 0 && /^[a-f0-9]{64}$/u.test(String(artifact.sha256 || "")))
    .map((artifact) => [artifact.name, artifact]));
  const missingBackups = backupPlan.database_exports
    .filter((backup) => !receiptByName.has(backup.name))
    .map((backup) => backup.name);
  const blockers = [
    ...(reverseDelta ? (reverseDelta.replayable ? [] : ["reverse_delta_not_replayable"]) : ["reverse_delta_missing"]),
    ...missingVersions.map((service) => `worker_version_missing:${service}`),
    ...missingBackups.map((name) => `backup_receipt_missing:${name}`),
  ];
  return {
    schema_version: CUTOVER_SCHEMA_VERSION,
    target: backupPlan.target,
    project_ref: backupPlan.project_ref,
    generated_at: new Date().toISOString(),
    blocked: blockers.length > 0,
    blockers,
    steps: [
      "Enable project-scoped maintenance read-only and verify window_id.",
      "Export and verify the post-cutover reverse delta before changing bindings.",
      "Rollback Dashboard, gateway, then private module Workers to recorded versions.",
      "Replay the verified reverse delta into untouched legacy databases.",
      "Run legacy smoke tests and only then disable maintenance.",
    ],
    worker_rollbacks: backupPlan.worker_versions.map((worker) => ({
      service: worker.service,
      version_id: versions[worker.service] || null,
      command: versions[worker.service]
        ? ["npx", "wrangler", "rollback", versions[worker.service], "--name", worker.worker_name]
        : null,
    })),
    database_backups: backupPlan.database_exports.map(({ name, database_id }) => ({
      name,
      database_id,
      artifact: receiptByName.get(name) || null,
    })),
  };
}

export function stripRows(report) {
  return {
    ...report,
    entities: report.entities.map(({ rows: _rows, ...entity }) => entity),
  };
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function emptyCheckpoint(plan, windowId) {
  return {
    schema_version: CUTOVER_SCHEMA_VERSION,
    project_ref: plan.project.project_ref,
    project_id: plan.project.project_id,
    window_id: windowId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    entities: {},
  };
}

function selectEntities(registry, modules, entityIds) {
  const selected = new Set(modules);
  for (const module of selected) if (!MODULES.includes(module)) throw new Error(`Unknown module ${module}`);
  const requestedEntities = entityIds === undefined ? null : new Set(entityIds);
  if (requestedEntities?.size === 0) throw new Error("At least one cutover entity is required");
  if (requestedEntities) {
    const known = new Map(registry.map((entity) => [entity.id, entity]));
    for (const id of requestedEntities) {
      const entity = known.get(id);
      if (!entity) throw new Error(`Unknown cutover entity ${id}`);
      if (!selected.has(entity.module)) {
        throw new Error(`${id} is outside the selected modules`);
      }
    }
  }
  return registry.filter((entity) => selected.has(entity.module) && (!requestedEntities || requestedEntities.has(entity.id)));
}

function assertProjectIsolation(rows, entity, projectId) {
  if (!entity.projectColumn) return;
  for (const row of rows) {
    if (String(row[entity.projectColumn]) !== String(projectId)) {
      throw new Error(`${entity.id}: row escaped project scope (${row[entity.projectColumn]} != ${projectId})`);
    }
  }
}

function entityKey(row, keys) {
  return keys.map((key) => canonicalJson(row[key])).join("|");
}
