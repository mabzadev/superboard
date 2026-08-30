import { spawnSync } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson, parseProjectRef } from "./core.mjs";
import { cloudflareEnv } from "../cloudflare-target.mjs";

export class FixtureAdapter {
  constructor(fixture) {
    this.fixture = structuredClone(fixture);
    this.upsertCalls = [];
    this.repositoryUpsertCalls = [];
  }

  async resolveProject(parsed) {
    const context = this.fixture.project;
    if (!context || context.project_ref !== parsed.project_ref) throw new Error("Fixture project does not match request");
    return structuredClone(context);
  }

  async readSource(entity) {
    return structuredClone(this.fixture.source_rows?.[entity.id] || []);
  }

  async readTarget(entity) {
    return structuredClone(this.fixture.target_rows?.[entity.id] || []);
  }

  async readGuard(guard) {
    return structuredClone(this.fixture.guard_rows?.[guard.id] || []);
  }

  async upsert(entity, rows, _context, sql) {
    this.upsertCalls.push({ entity: entity.id, sql });
    const current = this.fixture.target_rows?.[entity.id] || [];
    const index = new Map(current.map((row) => [rowKey(row, entity.keys), row]));
    for (const row of rows) index.set(rowKey(row, entity.keys), structuredClone(row));
    this.fixture.target_rows ||= {};
    this.fixture.target_rows[entity.id] = [...index.values()];
  }

  async upsertRepository(entity, rows, context) {
    this.fixture.repository_rows ||= {};
    if (canonicalJson(this.fixture.repository_rows[entity.id] || []) === canonicalJson(rows)) {
      return { instance_id: String(context.instance_id), count: rows.length, idempotent: true };
    }
    this.repositoryUpsertCalls.push({ entity: entity.id, repository: entity.repositoryId });
    this.fixture.repository_rows[entity.id] = structuredClone(rows);
    return { instance_id: String(context.instance_id), count: rows.length, idempotent: false };
  }

  async maintenanceStatus(projectRef) {
    return structuredClone(this.fixture.maintenance?.[projectRef] || { enabled: false, window_id: null });
  }

  async setMaintenance(projectRef, state) {
    this.fixture.maintenance ||= {};
    this.fixture.maintenance[projectRef] = structuredClone(state);
    return structuredClone(state);
  }
}

export class RemoteD1Adapter {
  constructor({ root, target, targetName, environment, allowWrites = false, gatewayToken, repositoryEncryptionKey, commandRunner = runCommand }) {
    this.root = root;
    this.target = target;
    this.targetName = targetName;
    this.environment = environment;
    this.resources = target.environments[environment];
    this.allowWrites = allowWrites;
    this.gatewayToken = gatewayToken;
    this.repositoryEncryptionKey = repositoryEncryptionKey;
    this.commandRunner = commandRunner;
    if (!this.resources) throw new Error(`${targetName} does not define environment ${environment}`);
  }

  async resolveProject(parsed) {
    const rows = await this.query(this.resources.d1, `SELECT id project_id,instance_id,identifier,is_test FROM projects WHERE instance_id=${parsed.instance_id} AND is_test=${parsed.environment === "test" ? 1 : 0} ORDER BY id`);
    if (rows.length !== 1) throw new Error(`Expected exactly one project for ${parsed.project_ref}, found ${rows.length}`);
    const row = rows[0];
    return {
      project_ref: parsed.project_ref,
      project_id: Number(row.project_id),
      instance_id: Number(row.instance_id),
      environment: parsed.environment,
      identifier: row.identifier,
    };
  }

  async readSource(entity, context) {
    return this.query(this.sourceDatabase(entity.source.database), renderQuery(entity.source.query, context));
  }

  async readTarget(entity, context) {
    return this.query(this.moduleDatabase(entity.module), renderQuery(entity.target.query, context));
  }

  async readGuard(guard, context) {
    return this.query(this.sourceDatabase(guard.source.database), renderQuery(guard.source.query, context));
  }

  async upsert(entity, _rows, _context, sql) {
    if (!this.allowWrites) throw new Error("Remote writes are disabled; use the guarded apply command");
    const directory = await mkdtemp(join(tmpdir(), "opengrow-cutover-"));
    const path = join(directory, `${entity.id.replaceAll(".", "-")}.sql`);
    try {
      await writeFile(path, sql, { mode: 0o600 });
      this.capture([
        "wrangler", "d1", "execute", databaseId(this.moduleDatabase(entity.module)),
        "--remote", "--file", path,
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async upsertRepository(entity, rows, context) {
    if (!this.allowWrites) throw new Error("Remote repository writes are disabled");
    if (!this.repositoryEncryptionKey) {
      throw new Error("SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY is required for repository authority");
    }
    const authority = await this.query(
      this.resources.siteD1,
      `SELECT active.artifact_checksum
       FROM superboard_active_plugin_manifests AS active
       JOIN superboard_plugin_manifest_artifacts AS artifact
         ON artifact.artifact_checksum=active.artifact_checksum
       JOIN json_each(artifact.manifest_json,'$.stores') AS store
       WHERE active.plugin_id=${sqlString(entity.pluginId)}
         AND json_extract(store.value,'$.store_id')=${sqlString(entity.storeId)}
         AND json_extract(store.value,'$.authority')=${sqlString(entity.pluginId)}`,
    );
    if (authority.length !== 1 || !authority[0].artifact_checksum) {
      throw new Error(`${entity.id}: active plugin manifest does not authorize ${entity.storeId}`);
    }
    const sql = repositoryUpsertSql(
      entity,
      rows,
      context,
      this.repositoryEncryptionKey,
      String(authority[0].artifact_checksum),
    );
    const directory = await mkdtemp(join(tmpdir(), "superboard-repository-cutover-"));
    const path = join(directory, `${entity.id.replaceAll(".", "-")}-repository.sql`);
    try {
      await writeFile(path, sql, { mode: 0o600 });
      this.capture([
        "wrangler", "d1", "execute", databaseId(this.resources.siteD1),
        "--remote", "--file", path,
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async maintenanceStatus(projectRef) {
    return this.maintenanceRequest("GET", projectRef);
  }

  async setMaintenance(projectRef, state) {
    if (!this.allowWrites) throw new Error("Remote writes are disabled");
    return this.maintenanceRequest("PUT", projectRef, state);
  }

  async maintenanceRequest(method, projectRef, body) {
    parseProjectRef(projectRef);
    if (!this.gatewayToken) throw new Error("OPENGROW_CUTOVER_TOKEN is required for maintenance operations");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`https://${this.target.domains.api}/api/v1/admin/module-cutover/maintenance/${projectRef}`, {
        method,
        headers: {
          authorization: `Bearer ${this.gatewayToken}`,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = (await response.text()).slice(0, 64 * 1024);
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(`Maintenance API ${response.status}: ${payload?.error?.code || "request_failed"}`);
      return payload.data || payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async query(database, sql) {
    const output = this.capture(["wrangler", "d1", "execute", databaseId(database), "--remote", "--command", sql, "--json"]);
    return parseD1Rows(output);
  }

  capture(args) {
    return this.commandRunner("npx", args, {
      cwd: this.root,
      env: this.commandRunner === runCommand ? cloudflareEnv(this.target) : process.env,
    });
  }

  sourceDatabase(source) {
    if (source === "api" || source === "billing") return this.resources.d1;
    if (source === "messaging") return this.resources.messagingD1;
    throw new Error(`Unknown source database ${source}`);
  }

  moduleDatabase(module) {
    const key = module === "dynamic-links" ? "dynamicLinks" : module;
    const database = this.resources.moduleD1?.[key];
    if (!database) throw new Error(`Missing module D1 binding for ${module}`);
    return database;
  }
}

function repositoryUpsertSql(entity, rows, context, encodedKey, manifestArtifactChecksum) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY must be base64 AES-256 key material");
  const statements = rows.map((row) => {
    const plaintext = canonicalJson(row);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const envelope = canonicalJson({
      algorithm: "AES-GCM",
      iv: iv.toString("base64"),
      ciphertext: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64"),
    });
    const payloadChecksum = `sha256:${createHash("sha256").update(envelope).digest("hex")}`;
    const entityId = entity.keys.map((column) => String(row[column])).join(":");
    const operationId = `cutover:${context.project_ref}:${entity.id}:${createHash("sha256").update(`${entityId}:${plaintext}`).digest("hex")}`;
    return `INSERT INTO superboard_plugin_store_records
      (plugin_id,store_id,instance_id,entity_type,entity_id,revision,payload_json,
       payload_checksum,manifest_artifact_checksum,last_operation_id,updated_at)
      VALUES (${sqlString(entity.pluginId)},${sqlString(entity.storeId)},${sqlString(String(context.instance_id))},
       ${sqlString(entity.id)},${sqlString(entityId)},1,${sqlString(envelope)},${sqlString(payloadChecksum)},
       ${sqlString(manifestArtifactChecksum)},
       ${sqlString(operationId)},${sqlString(new Date().toISOString())})
      ON CONFLICT(plugin_id,store_id,instance_id,entity_type,entity_id) DO UPDATE SET
       revision=superboard_plugin_store_records.revision+1,
       payload_json=excluded.payload_json,payload_checksum=excluded.payload_checksum,
       manifest_artifact_checksum=excluded.manifest_artifact_checksum,
       last_operation_id=excluded.last_operation_id,updated_at=excluded.updated_at
      WHERE superboard_plugin_store_records.last_operation_id<>excluded.last_operation_id;`;
  });
  return ["PRAGMA foreign_keys = ON;", ...statements, ""].join("\n");
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function loadFixture(path) {
  return new FixtureAdapter(JSON.parse(await readFile(resolve(path), "utf8")));
}

export function parseD1Rows(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Unable to parse Wrangler D1 JSON output");
  const batches = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(batches)) throw new Error("Wrangler D1 output must be an array");
  const failed = batches.find((batch) => batch?.success === false);
  if (failed) throw new Error(`D1 query failed: ${failed.error || "unknown error"}`);
  return batches.flatMap((batch) => Array.isArray(batch?.results) ? batch.results : []);
}

function renderQuery(query, context) {
  const projectId = Number(context.project_id);
  const instanceId = Number(context.instance_id);
  if (!Number.isSafeInteger(projectId) || !Number.isSafeInteger(instanceId)) throw new Error("Resolved project ids must be safe integers");
  return query
    .replaceAll(":project_id", String(projectId))
    .replaceAll(":instance_id", String(instanceId))
    .replaceAll(":is_test", context.environment === "test" ? "1" : "0");
}

function databaseId(database) {
  const id = String(database?.id || database?.name || "");
  if (!/^[a-zA-Z0-9_-]+$/u.test(id)) throw new Error("Invalid D1 database identifier");
  return id;
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: "utf8", shell: false, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
}

function rowKey(row, keys) {
  return keys.map((key) => canonicalJson(row[key])).join("|");
}
