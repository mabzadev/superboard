import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cloudflareEnv } from "../cloudflare-target.mjs";
import { canonicalJson, sha256 } from "./core-primitives.mjs";
import { assertMbzaDevelopment, parseProjectRef } from "./core.mjs";
import { FLOW_SOURCE_QUERIES } from "./registry.mjs";

export class FixtureFlowsCutoverAdapter {
  constructor(fixture = {}) {
    this.fixture = structuredClone(fixture);
    this.fixture.target_rows ||= {};
    this.fixture.maintenance ||= {};
    this.fixture.flows_routing ||= {};
    this.upsertCalls = [];
    this.statusCalls = [];
    this.upsertAttempts = 0;
  }

  async captureSnapshot() {
    if (!this.fixture.snapshot) throw new Error("Fixture has no source snapshot");
    return structuredClone(this.fixture.snapshot);
  }

  async resolveUserHashes(project, rawUserIds) {
    const key = String(
      this.fixture.flow_user_hash_key ?? "fixture-flow-user-hash-key",
    );
    return new Map(rawUserIds.map((rawUserId) => [
      rawUserId,
      createHmac("sha256", key)
        .update(`${project.project_ref}\n${rawUserId}`)
        .digest("hex"),
    ]));
  }

  async readTarget(entity) {
    return structuredClone(this.fixture.target_rows[entity.id] ?? []);
  }

  async upsert(entity, rows, _context, sql) {
    this.upsertAttempts += 1;
    if (this.fixture.fail_on_upsert_attempt === this.upsertAttempts) throw new Error("Fixture interrupted the import");
    this.upsertCalls.push({ entity: entity.id, sql });
    const current = this.fixture.target_rows[entity.id] ?? [];
    const index = new Map(current.map((row) => [rowKey(row, entity.keys), structuredClone(row)]));
    for (const row of rows) {
      const key = rowKey(row, entity.keys);
      if (entity.immutable && index.has(key) && canonicalJson(index.get(key)) !== canonicalJson(row)) continue;
      index.set(key, structuredClone(row));
    }
    this.fixture.target_rows[entity.id] = [...index.values()];
  }

  async recordImportStatus(entry) {
    this.statusCalls.push(structuredClone(entry));
  }

  async maintenanceStatus(projectRef) {
    return structuredClone(this.fixture.maintenance[projectRef] ?? { enabled: false, window_id: null });
  }

  async setMaintenance(projectRef, state) {
    this.fixture.maintenance[projectRef] = structuredClone(state);
    return structuredClone(state);
  }

  async routingStatus(projectRef) {
    const project = (await this.projectInventory()).find(
      (item) => item.project_ref === projectRef,
    );
    return structuredClone(this.fixture.flows_routing[projectRef] ?? {
      project_ref: projectRef,
      project_id: project?.project_id ?? null,
      enabled: false,
      window_id: null,
      plan_id: null,
      verification_checksum_sha256: null,
    });
  }

  async projectInventory() {
    return structuredClone(this.fixture.projects ?? [
      { project_id: 1, project_ref: "1-prod" },
      { project_id: 2, project_ref: "1-test" },
    ]);
  }

  async setFlowsRouting(projectRef, state) {
    const project = (await this.projectInventory()).find(
      (item) => item.project_ref === projectRef,
    );
    const response = {
      project_ref: projectRef,
      project_id: project?.project_id ?? null,
      ...structuredClone(state),
    };
    this.fixture.flows_routing[projectRef] = response;
    return structuredClone(response);
  }
}

export class RemoteFlowsCutoverAdapter {
  constructor({ root, target, targetName, environment, allowWrites = false, gatewayToken, flowUserHashKey, directMaintenance = false, commandRunner = runCommand }) {
    assertMbzaDevelopment(targetName, environment);
    this.root = root;
    this.target = target;
    this.targetName = targetName;
    this.environment = environment;
    this.resources = target.environments?.[environment];
    this.allowWrites = allowWrites;
    this.gatewayToken = gatewayToken;
    this.flowUserHashKey = flowUserHashKey;
    this.directMaintenance = directMaintenance;
    this.commandRunner = commandRunner;
    if (!this.resources) throw new Error("MBZA development resources are missing");
  }

  async resolveProject(projectRef) {
    const parsed = parseProjectRef(projectRef);
    const rows = await this.query(this.resources.d1, `SELECT id AS project_id, instance_id, identifier, is_test FROM projects WHERE instance_id = ${parsed.instance_id} AND is_test = ${parsed.project_environment === "test" ? 1 : 0} ORDER BY id`);
    if (rows.length !== 1) throw new Error(`Expected exactly one API project for ${parsed.project_ref}; found ${rows.length}`);
    return {
      project_id: Number(rows[0].project_id),
      project_ref: parsed.project_ref,
      instance_id: Number(rows[0].instance_id),
      environment: parsed.project_environment,
      identifier: rows[0].identifier,
    };
  }

  async projectInventory() {
    const rows = await this.query(
      this.resources.d1,
      `SELECT id AS project_id,
              CAST(instance_id AS TEXT) || CASE WHEN is_test = 1 THEN '-test' ELSE '-prod' END AS project_ref
       FROM projects ORDER BY id`,
    );
    return rows.map((row) => ({
      project_id: Number(row.project_id),
      project_ref: String(row.project_ref),
    }));
  }

  async resolveFlowEnvironment(project, { environmentId } = {}) {
    const flows = this.requireProvisionedDatabase("flows");
    const environmentWhere = environmentId
      ? ` AND e.id = ${sqlLiteral(environmentId)}`
      : ` AND e.key = ${sqlLiteral(project.environment)}`;
    const environments = await this.query(flows, `SELECT e.id,e.key,e.name FROM flow_environments e JOIN flow_projects p ON p.project_id = e.project_id WHERE e.project_id = ${Number(project.project_id)} AND p.project_ref = ${sqlLiteral(project.project_ref)}${environmentWhere} ORDER BY e.created_at,e.id`);
    if (environments.length === 0 && !environmentId) {
      return {
        environment_id: defaultFlowEnvironmentId(
          project.project_id,
          project.environment,
        ),
      };
    }
    if (environments.length !== 1) {
      const selector = environmentId ? `id ${environmentId}` : `key ${project.environment}`;
      throw new Error(`Expected exactly one project-scoped Flows environment with ${selector}; found ${environments.length}. Pass --flows-environment-id only when an explicit environment id is required.`);
    }
    return { environment_id: String(environments[0].id) };
  }

  async ensureProjectScope(project, environmentId) {
    if (!this.allowWrites) {
      throw new Error("Remote writes are disabled; project scope bootstrap requires guarded apply authority");
    }
    const expectedEnvironmentId = defaultFlowEnvironmentId(
      project.project_id,
      project.environment,
    );
    if (environmentId !== expectedEnvironmentId) {
      const existing = await this.resolveFlowEnvironment(project, {
        environmentId,
      });
      if (existing.environment_id !== environmentId) {
        throw new Error("Selected Flows environment does not exist in this project");
      }
      return { created: false, environment_id: environmentId };
    }
    const now = new Date().toISOString();
    const environment = project.environment === "test" ? "test" : "production";
    const environmentName = environment === "test" ? "Test" : "Production";
    const discardedSdkKeyHash = createHash("sha256")
      .update(randomBytes(48))
      .digest("hex");
    const sql = `INSERT OR IGNORE INTO flow_projects
      (project_id,project_ref,sdk_identifier,created_by,created_at,updated_at)
      VALUES (${Number(project.project_id)},${sqlLiteral(project.project_ref)},${sqlLiteral(project.project_ref)},'flows-cutover',${sqlLiteral(now)},${sqlLiteral(now)});
INSERT OR IGNORE INTO flow_environments
      (id,project_id,name,key,kind,sdk_key_hash,active,allow_draft,created_at,updated_at)
      VALUES (${sqlLiteral(expectedEnvironmentId)},${Number(project.project_id)},${sqlLiteral(environmentName)},${sqlLiteral(environment)},${sqlLiteral(environment)},${sqlLiteral(discardedSdkKeyHash)},1,${environment === "test" ? 1 : 0},${sqlLiteral(now)},${sqlLiteral(now)});`;
    await this.executeFile(
      this.requireProvisionedDatabase("flows"),
      `scope-${project.project_ref}.sql`,
      sql,
    );
    const rows = await this.query(
      this.requireProvisionedDatabase("flows"),
      `SELECT p.project_id,p.project_ref,e.id AS environment_id,e.key
       FROM flow_projects p JOIN flow_environments e ON e.project_id = p.project_id
       WHERE p.project_id = ${Number(project.project_id)}
         AND p.project_ref = ${sqlLiteral(project.project_ref)}
         AND e.id = ${sqlLiteral(expectedEnvironmentId)}
         AND e.key = ${sqlLiteral(environment)}`,
    );
    if (rows.length !== 1) {
      throw new Error("Flows project/environment scope bootstrap did not converge");
    }
    return { created: true, environment_id: expectedEnvironmentId };
  }

  async validateSnapshotIdentity(snapshot) {
    const live = await this.resolveProject(snapshot?.project?.project_ref);
    if (String(live.project_id) !== String(snapshot?.project?.project_id) || live.instance_id !== Number(snapshot?.project?.instance_id)) {
      throw new Error("Snapshot project identity does not match the live MBZA API registry");
    }
    for (const source of ["paywalls", "onboardings"]) {
      const expected = this.requireProvisionedDatabase(source);
      const actual = snapshot?.sources?.[source];
      if (actual?.database_name !== expected.name || actual?.database_id !== expected.id) {
        throw new Error(`Snapshot ${source} database identity does not match the MBZA target manifest`);
      }
    }
    return true;
  }

  async validatePlanIdentity(plan, { allowMissingDefaultScope = false } = {}) {
    const live = await this.resolveProject(plan?.project?.project_ref);
    if (String(live.project_id) !== String(plan?.project?.project_id) || live.instance_id !== Number(plan?.project?.instance_id)) {
      throw new Error("Protected plan project identity does not match the live MBZA API registry");
    }
    for (const source of ["paywalls", "onboardings"]) {
      if (plan.source_databases?.[source] !== this.requireProvisionedDatabase(source).name) {
        throw new Error(`Protected plan ${source} database identity does not match the MBZA target manifest`);
      }
      if (plan.source_database_ids?.[source] !== this.requireProvisionedDatabase(source).id) {
        throw new Error(`Protected plan ${source} D1 id does not match the MBZA target manifest`);
      }
    }
    const expectedDefaultEnvironmentId = defaultFlowEnvironmentId(
      live.project_id,
      live.environment,
    );
    if (
      allowMissingDefaultScope &&
      plan.environment_id === expectedDefaultEnvironmentId
    ) {
      const flows = this.requireProvisionedDatabase("flows");
      const rows = await this.query(
        flows,
        `SELECT p.project_id,p.project_ref,e.id AS environment_id,e.key
         FROM flow_projects p
         LEFT JOIN flow_environments e
           ON e.project_id = p.project_id
          AND e.id = ${sqlLiteral(expectedDefaultEnvironmentId)}
         WHERE p.project_id = ${Number(live.project_id)}
            OR p.project_ref = ${sqlLiteral(live.project_ref)}
            OR e.id = ${sqlLiteral(expectedDefaultEnvironmentId)}
         ORDER BY p.project_id`,
      );
      if (rows.length === 0) return true;
      if (
        rows.length !== 1 ||
        Number(rows[0].project_id) !== Number(live.project_id) ||
        String(rows[0].project_ref) !== live.project_ref ||
        (rows[0].environment_id != null &&
          (String(rows[0].environment_id) !== expectedDefaultEnvironmentId ||
            String(rows[0].key) !== live.environment))
      ) {
        throw new Error(
          "Protected plan Flows project/default environment conflicts with the live MBZA scope",
        );
      }
      return true;
    }
    const scope = await this.resolveFlowEnvironment(live, { environmentId: plan.environment_id });
    if (scope.environment_id !== plan.environment_id) {
      throw new Error("Protected plan Flows environment no longer matches MBZA");
    }
    return true;
  }

  async validateBackupReceiptIdentity(receipt) {
    for (const source of ["api", "paywalls", "onboardings", "flows"]) {
      const expected = source === "api"
        ? this.requireProvisionedApiDatabase()
        : this.requireProvisionedDatabase(source);
      const artifact = receipt?.artifacts?.find((candidate) => candidate.logical_name === source);
      if (artifact?.database_name !== expected.name || artifact?.database_id !== expected.id) {
        throw new Error(`Backup receipt ${source} D1 identity does not match the live MBZA target manifest`);
      }
      if (artifact.r2_bucket !== this.resources.moduleR2?.flows?.name) {
        throw new Error(`Backup receipt ${source} archive bucket does not match the live MBZA target manifest`);
      }
    }
    return true;
  }

  async resolveUserHashes(project, rawUserIds) {
    if (this.flowUserHashKey) {
      const key = this.flowUserHashKey;
      return new Map([...new Set(rawUserIds.map((value) => String(value)))].map(
        (rawUserId) => [
          rawUserId,
          createHmac("sha256", key)
            .update(`${project.project_ref}\n${rawUserId}`)
            .digest("hex"),
        ],
      ));
    }
    if (!this.gatewayToken) {
      throw new Error(
        "OPENGROW_CUTOVER_TOKEN or --flow-user-hash-bundle is required to resolve runtime-compatible Flows user hashes",
      );
    }
    const unique = [...new Set(rawUserIds.map((value) => String(value)))].sort();
    const resolved = new Map();
    for (let offset = 0; offset < unique.length; offset += 500) {
      const batch = unique.slice(offset, offset + 500);
      const idempotencyKey = `flows-cutover-user-hashes-${sha256(canonicalJson({
        project_ref: project.project_ref,
        user_ids: batch,
      }))}`;
      const payload = await this.cutoverRequest(
        "POST",
        `user-hashes/${project.project_ref}`,
        { user_ids: batch },
        { "idempotency-key": idempotencyKey },
      );
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (items.length !== batch.length) {
        throw new Error("Flows user hash resolver returned an incomplete batch");
      }
      for (const [index, item] of items.entries()) {
        if (
          item?.user_id !== batch[index] ||
          !/^[a-f0-9]{64}$/u.test(String(item?.user_id_hash ?? ""))
        ) {
          throw new Error("Flows user hash resolver returned an invalid or reordered item");
        }
        resolved.set(item.user_id, item.user_id_hash);
      }
    }
    return resolved;
  }

  async captureSnapshot({ projectRef }) {
    const project = await this.resolveProject(projectRef);
    const capturedAt = new Date().toISOString();
    const sources = {};
    for (const source of ["paywalls", "onboardings"]) {
      const database = this.requireProvisionedDatabase(source);
      const bookmarkBefore = await this.timeTravelBookmark(database);
      const tables = {};
      for (const descriptor of FLOW_SOURCE_QUERIES[source]) {
        const query = renderSourceQuery(descriptor.query, project.project_id);
        if (!descriptor.pageSize) {
          tables[descriptor.table] = await this.query(database, query);
          continue;
        }
        const rows = [];
        for (let offset = 0; ; offset += descriptor.pageSize) {
          const page = await this.query(database, `${query} LIMIT ${descriptor.pageSize} OFFSET ${offset}`);
          rows.push(...page);
          if (page.length < descriptor.pageSize) break;
          if (offset >= 10_000_000) throw new Error(`${source}.${descriptor.table} exceeds the guarded snapshot pagination limit`);
        }
        tables[descriptor.table] = rows;
      }
      const bookmark = await this.timeTravelBookmark(database);
      if (bookmark !== bookmarkBefore) {
        throw new Error(`${source} changed while its snapshot was being captured; keep the project freeze enabled and retry so checksums bind to one stable Time Travel bookmark`);
      }
      sources[source] = {
        bookmark,
        bookmark_verified_stable: true,
        database_name: database.name,
        database_id: database.id,
        tables,
      };
    }
    return {
      schema_version: 1,
      target: this.targetName,
      environment: this.environment,
      captured_at: capturedAt,
      project,
      sources,
      snapshot_checksum_sha256: sha256(canonicalJson({ project, captured_at: capturedAt, sources })),
    };
  }

  async readTarget(entity, context) {
    const database = this.requireProvisionedDatabase("flows");
    const query = renderTargetQuery(entity.targetQuery, context, entity);
    const rows = [];
    for (let offset = 0; ; offset += entity.pageSize) {
      const page = await this.query(database, `${query} LIMIT ${entity.pageSize} OFFSET ${offset}`);
      rows.push(...page);
      if (page.length < entity.pageSize) return rows;
      if (offset >= 10_000_000) throw new Error(`${entity.id} exceeds the guarded target pagination limit`);
    }
  }

  async upsert(entity, _rows, _context, sql) {
    if (!this.allowWrites) throw new Error("Remote writes are disabled; use the guarded --apply command with exact confirmation");
    await this.executeFile(this.requireProvisionedDatabase("flows"), `${entity.id.replaceAll(".", "-")}.sql`, sql);
  }

  async recordImportStatus({ plan, entity, status, checkpoint }) {
    if (!this.allowWrites) throw new Error("Remote writes are disabled");
    const source = entity.sourceModule;
    const sourceEntities = plan.entities.filter((item) => item.source_module === source);
    const verified = sourceEntities.filter((item) => checkpoint.entities[item.id]?.status === "verified");
    const counts = Object.fromEntries(verified.map((item) => [item.id, item.expected.count]));
    const checksums = Object.fromEntries(verified.map((item) => [item.id, item.expected.checksum_sha256]));
    const id = `${plan.plan_id}:${source}`;
    const effectiveStatus = status === "failed" ? "failed" : verified.length === sourceEntities.length ? "verified" : "running";
    const sql = `INSERT INTO flow_import_checkpoints (id,project_id,source_module,source_database,source_bookmark,status,cursor_json,counts_json,checksums_json,backup_receipt_json,created_at,updated_at) VALUES (${sqlLiteral(id)},${Number(plan.project.project_id)},${sqlLiteral(source)},${sqlLiteral(plan.source_databases[source])},${sqlLiteral(plan.source_bookmarks[source])},${sqlLiteral(effectiveStatus)},${sqlLiteral(canonicalJson({ last_entity: entity.id, plan_id: plan.plan_id }))},${sqlLiteral(canonicalJson(counts))},${sqlLiteral(canonicalJson(checksums))},NULL,${sqlLiteral(plan.captured_at)},${sqlLiteral(new Date().toISOString())}) ON CONFLICT (project_id,source_module,source_bookmark) DO UPDATE SET status=excluded.status,cursor_json=excluded.cursor_json,counts_json=excluded.counts_json,checksums_json=excluded.checksums_json,updated_at=excluded.updated_at;`;
    await this.executeFile(this.requireProvisionedDatabase("flows"), `checkpoint-${source}.sql`, sql);
  }

  async maintenanceStatus(projectRef) {
    if (this.directMaintenance) {
      const project = await this.resolveProject(projectRef);
      const rows = await this.query(
        this.resources.d1,
        `SELECT enabled,window_id,reason,updated_by,updated_at
         FROM module_cutover_maintenance
         WHERE project_id = ${Number(project.project_id)} LIMIT 1`,
      );
      const row = rows[0];
      return {
        project_ref: project.project_ref,
        project_id: project.project_id,
        enabled: Number(row?.enabled ?? 0) === 1,
        window_id: row?.window_id ?? null,
        reason: row?.reason ?? null,
        updated_by: row?.updated_by ?? null,
        updated_at: row?.updated_at ?? null,
      };
    }
    return this.maintenanceRequest("GET", projectRef);
  }

  async setMaintenance(projectRef, state) {
    if (!this.allowWrites) throw new Error("Remote writes are disabled");
    if (this.directMaintenance) {
      if (
        typeof state?.enabled !== "boolean" ||
        (state.enabled && (!String(state.window_id ?? "").trim() || !String(state.reason ?? "").trim()))
      ) {
        throw new Error("Direct maintenance requires a valid enabled state, window_id and reason");
      }
      const project = await this.resolveProject(projectRef);
      const actor = "flows-cutover-cli";
      const now = new Date().toISOString();
      const windowId = String(state.window_id ?? "").trim() || null;
      const reason = String(state.reason ?? "").trim() || null;
      const auditId = `flows-maintenance-${sha256(canonicalJson({
        project_id: project.project_id,
        enabled: state.enabled,
        window_id: windowId,
        reason,
      })).slice(0, 48)}`;
      const sql = `INSERT INTO module_cutover_maintenance
        (project_id,enabled,window_id,reason,updated_by,updated_at)
        VALUES (${Number(project.project_id)},${state.enabled ? 1 : 0},${sqlLiteral(windowId)},${sqlLiteral(reason)},${sqlLiteral(actor)},${sqlLiteral(now)})
        ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,window_id=excluded.window_id,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
INSERT OR IGNORE INTO module_cutover_audit (id,project_id,action,actor,details_json)
        VALUES (${sqlLiteral(auditId)},${Number(project.project_id)},${sqlLiteral(state.enabled ? "maintenance.enabled" : "maintenance.disabled")},${sqlLiteral(actor)},${sqlLiteral(canonicalJson({ window_id: windowId, reason }))});`;
      await this.executeFile(
        this.resources.d1,
        `flows-maintenance-${project.project_ref}-${state.enabled ? "enable" : "disable"}.sql`,
        sql,
      );
      const confirmed = await this.maintenanceStatus(projectRef);
      if (
        confirmed.enabled !== state.enabled ||
        confirmed.window_id !== windowId
      ) {
        throw new Error("D1 did not confirm the exact maintenance state");
      }
      return confirmed;
    }
    return this.maintenanceRequest("PUT", projectRef, state);
  }

  async routingStatus(projectRef) {
    const project = await this.resolveProject(projectRef);
    const rows = await this.query(
      this.resources.d1,
      `SELECT enabled,window_id,plan_id,verification_checksum_sha256,updated_by,updated_at
       FROM flows_legacy_cutover_state
       WHERE project_id = ${Number(project.project_id)} LIMIT 1`,
    );
    const row = rows[0];
    return {
      project_ref: project.project_ref,
      project_id: project.project_id,
      enabled: Number(row?.enabled ?? 0) === 1,
      window_id: row?.window_id ?? null,
      plan_id: row?.plan_id ?? null,
      verification_checksum_sha256: row?.verification_checksum_sha256 ?? null,
      updated_by: row?.updated_by ?? null,
      updated_at: row?.updated_at ?? null,
    };
  }

  async setFlowsRouting(projectRef, state, idempotencyKey) {
    if (!this.allowWrites) throw new Error("Remote writes are disabled");
    if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(String(idempotencyKey || ""))) {
      throw new Error("A stable Flows routing idempotency key is required");
    }
    const project = await this.resolveProject(projectRef);
    if (
      typeof state?.enabled !== "boolean" ||
      !/^[A-Za-z0-9._-]{8,128}$/u.test(String(state?.window_id ?? "")) ||
      !/^[a-f0-9]{64}$/u.test(String(state?.plan_id ?? "")) ||
      !/^[a-f0-9]{64}$/u.test(String(state?.verification_checksum_sha256 ?? ""))
    ) {
      throw new Error("Flows routing state/evidence is invalid");
    }
    const response = {
      project_ref: project.project_ref,
      project_id: project.project_id,
      ...state,
    };
    const payloadChecksum = sha256(canonicalJson(response));
    const existing = await this.query(
      this.resources.d1,
      `SELECT payload_checksum_sha256,response_json
       FROM flows_legacy_cutover_commands
       WHERE project_id = ${Number(project.project_id)}
         AND idempotency_key = ${sqlLiteral(idempotencyKey)} LIMIT 1`,
    );
    if (existing.length) {
      if (existing[0].payload_checksum_sha256 !== payloadChecksum) {
        throw new Error("Flows routing idempotency key was already used with different evidence");
      }
      const replay = JSON.parse(String(existing[0].response_json));
      if (sha256(canonicalJson(replay)) !== payloadChecksum) {
        throw new Error("Flows routing receipt payload is corrupt");
      }
      const confirmed = await this.routingStatus(projectRef);
      if (!routingStateMatches(confirmed, state)) {
        throw new Error(
          "Flows routing receipt exists but the active D1 state does not match; manual reconciliation is required",
        );
      }
      return replay;
    }
    const actor = "flows-cutover-cli";
    const now = new Date().toISOString();
    const auditId = `flows-routing-${sha256(canonicalJson({
      idempotency_key: idempotencyKey,
      project_id: project.project_id,
    })).slice(0, 48)}`;
    // A remote D1 file can stop between statements. Apply the replay-safe state
    // and deterministic audit first, then seal the command receipt last. A
    // retry can safely finish the sequence without duplicating the audit.
    const sql = `INSERT INTO flows_legacy_cutover_state
      (project_id,enabled,window_id,plan_id,verification_checksum_sha256,updated_by,updated_at)
      VALUES (${Number(project.project_id)},${state.enabled ? 1 : 0},${sqlLiteral(state.window_id)},${sqlLiteral(state.plan_id)},${sqlLiteral(state.verification_checksum_sha256)},${sqlLiteral(actor)},${sqlLiteral(now)})
      ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,window_id=excluded.window_id,plan_id=excluded.plan_id,verification_checksum_sha256=excluded.verification_checksum_sha256,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
INSERT OR IGNORE INTO module_cutover_audit (id,project_id,action,actor,details_json)
      VALUES (${sqlLiteral(auditId)},${Number(project.project_id)},${sqlLiteral(state.enabled ? "flows.routing.enabled" : "flows.routing.disabled")},${sqlLiteral(actor)},${sqlLiteral(canonicalJson({ ...state, idempotency_key: idempotencyKey }))});
INSERT INTO flows_legacy_cutover_commands
      (project_id,idempotency_key,payload_checksum_sha256,response_json,created_at)
      VALUES (${Number(project.project_id)},${sqlLiteral(idempotencyKey)},${sqlLiteral(payloadChecksum)},${sqlLiteral(canonicalJson(response))},${sqlLiteral(now)});`;
    await this.executeFile(
      this.resources.d1,
      `flows-routing-${project.project_ref}-${state.enabled ? "enable" : "disable"}.sql`,
      sql,
    );
    const confirmed = await this.routingStatus(projectRef);
    if (!routingStateMatches(confirmed, state)) {
      throw new Error("D1 did not confirm the exact Flows routing state");
    }
    return response;
  }

  async maintenanceRequest(method, projectRef, body) {
    parseProjectRef(projectRef);
    return this.cutoverRequest(method, `maintenance/${projectRef}`, body);
  }

  async cutoverRequest(method, path, body, extraHeaders = {}) {
    if (!this.gatewayToken) throw new Error("OPENGROW_CUTOVER_TOKEN is required for cutover operations");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`https://${this.target.domains.api}/api/v1/admin/module-cutover/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.gatewayToken}`,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = (await response.text()).slice(0, 64 * 1024);
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(`Cutover API ${response.status}: ${payload?.error?.code || "request_failed"}`);
      return payload.data ?? payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async timeTravelBookmark(database, timestamp) {
    const output = this.capture(["wrangler", "d1", "time-travel", "info", database.id, ...(timestamp ? ["--timestamp", timestamp] : []), "--json"]);
    const parsed = parseJsonOutput(output);
    const bookmark = findStringProperty(parsed, new Set(["bookmark", "current_bookmark"]));
    if (!bookmark) throw new Error(`Wrangler returned no Time Travel bookmark for ${database.name}`);
    return bookmark;
  }

  async query(database, sql) {
    const output = this.capture(["wrangler", "d1", "execute", databaseId(database), "--remote", "--command", sql, "--json"]);
    return parseD1Rows(output);
  }

  async executeFile(database, filename, sql) {
    if (!this.allowWrites) throw new Error("Remote writes are disabled; guarded --apply authority is required");
    const directory = await mkdtemp(join(tmpdir(), "superboard-flows-cutover-"));
    const path = join(directory, filename);
    try {
      await writeFile(path, sql, { mode: 0o600, flag: "wx" });
      this.capture(["wrangler", "d1", "execute", databaseId(database), "--remote", "--file", path, "--json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  capture(args) {
    return this.commandRunner("npx", args, { cwd: this.root, env: cloudflareEnv(this.target) });
  }

  requireProvisionedDatabase(source) {
    const database = this.resources.moduleD1?.[source];
    if (!database?.name || !database?.id) {
      const suffix = source === "flows"
        ? "; provision it first with: node scripts/cloudflare-bootstrap.mjs --target mbza-development --environment development --remote (then execute only the exact confirmation printed by that command)"
        : "";
      throw new Error(`MBZA ${source} D1 is not fully provisioned${suffix}`);
    }
    return database;
  }

  requireProvisionedApiDatabase() {
    const database = this.resources.d1;
    if (!database?.name || !database?.id) {
      throw new Error("MBZA API D1 is not fully provisioned");
    }
    return database;
  }
}

function routingStateMatches(actual, expected) {
  return actual.enabled === expected.enabled &&
    actual.window_id === expected.window_id &&
    actual.plan_id === expected.plan_id &&
    actual.verification_checksum_sha256 === expected.verification_checksum_sha256;
}

export async function loadFixtureAdapter(path) {
  return new FixtureFlowsCutoverAdapter(JSON.parse(await readFile(resolve(path), "utf8")));
}

export function parseD1Rows(output) {
  const parsed = parseJsonOutput(output);
  const batches = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.result) ? parsed.result : [parsed];
  const failed = batches.find((batch) => batch?.success === false);
  if (failed) throw new Error(`D1 query failed: ${failed.error || "unknown error"}`);
  return batches.flatMap((batch) => Array.isArray(batch?.results) ? batch.results : Array.isArray(batch?.result?.results) ? batch.result.results : []);
}

function parseJsonOutput(output) {
  const value = String(output || "").trim();
  try { return JSON.parse(value); } catch { /* Wrangler may print a banner before JSON. */ }
  const starts = [value.indexOf("["), value.indexOf("{")].filter((index) => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    for (let end = value.length; end > start; end -= 1) {
      if (!["}", "]"].includes(value[end - 1])) continue;
      try { return JSON.parse(value.slice(start, end)); } catch { /* keep looking */ }
    }
  }
  throw new Error("Unable to parse Wrangler JSON output");
}

function renderSourceQuery(query, projectId) {
  const value = Number(projectId);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Source project id is invalid");
  return query.replaceAll(":source_project_id", String(value));
}

function defaultFlowEnvironmentId(projectId, environment) {
  const value = Number(projectId);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Flows project id is invalid");
  }
  const key = environment === "test" ? "test" : "production";
  return `flow-project-${value}-environment-${key}`;
}

function renderTargetQuery(query, context, entity) {
  const projectId = Number(context.project_id);
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error("Target project id is invalid");
  const source = entity.sourceModule;
  return query
    .replaceAll(":project_id", String(projectId))
    .replaceAll(":environment_id", sqlLiteral(context.environment_id))
    .replaceAll(":source_module", sqlLiteral(source))
    .replaceAll(":event_prefix", sqlLiteral(`legacy:${source}:%`))
    .replaceAll(":user_prefix", sqlLiteral(`legacy_${source}_%`))
    .replaceAll(":audit_action", sqlLiteral(`flows.cutover.${source}.imported`));
}

function databaseId(database) {
  const id = String(database?.id || "");
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error("A provisioned D1 database id is required");
  return id;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function findStringProperty(value, names) {
  if (!value || typeof value !== "object") return null;
  for (const [key, candidate] of Object.entries(value)) {
    if (names.has(key) && typeof candidate === "string" && candidate.trim()) return candidate.trim();
    const nested = findStringProperty(candidate, names);
    if (nested) return nested;
  }
  return null;
}

function rowKey(row, keys) { return keys.map((key) => canonicalJson(row[key])).join("|"); }

function runCommand(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: "utf8", shell: false, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || `${command} failed`).trim());
  return result.stdout;
}
