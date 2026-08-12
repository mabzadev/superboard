import {
  ANALYTICS_SCHEMA_VERSION,
  stableAnalyticsJson,
  type AnalyticsQueueMessageV1,
} from "@superboard/contracts/analytics";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { identityHashCandidates } from "./crypto";
import type { AnalyticsContext } from "./http";
import { httpError, positiveLimit, readJson } from "./http";
import { commitAnalyticsMutation } from "./mutations";
import type {
  AnalyticsOperationPayload,
  AnalyticsOperationType,
  Env,
} from "./types";

type OperationRow = {
  id: string;
  project_id: string;
  operation_type: AnalyticsOperationType;
  status: "queued" | "running" | "completed" | "failed";
  input_json: string;
  result_json: string | null;
  error_message: string | null;
  requested_by: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function createAnalyticsOperation(c: AnalyticsContext) {
  const project = c.get("project");
  const body = operationBody(await readJson(c.req.raw));
  authorizeOperation(project.role, body.type);
  const projectId = String(project.projectId);
  const input = await normalizedOperationInput(
    c.env,
    projectId,
    body.type,
    body.input,
  );
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const data = {
    id,
    operation_type: body.type,
    status: "queued",
    input,
    requested_by: String(project.actorId),
    created_at: now,
  };
  const committed = await commitAnalyticsMutation(c.env.DB, {
    project,
    idempotencyKey: c.req.header("idempotency-key"),
    method: c.req.method,
    path: c.req.path,
    action: "analytics.operation.created",
    entityType: "operation_job",
    entityId: id,
    requestBody: body.raw,
    data,
    status: 202,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO analytics_operation_jobs
          (id, project_id, operation_type, input_json, requested_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        projectId,
        body.type,
        stableAnalyticsJson(input),
        String(project.actorId),
        now,
        now,
      ),
    ],
  });
  if (!committed.replayed) {
    await startOperation(c.env, { jobId: id, projectId });
  }
  return committed;
}

export async function getAnalyticsOperation(c: AnalyticsContext, id: string) {
  const row = await c.env.DB.prepare(
    `SELECT id, project_id, operation_type, status, input_json, result_json,
      error_message, requested_by, started_at, completed_at, created_at, updated_at
     FROM analytics_operation_jobs WHERE project_id = ? AND id = ?`,
  )
    .bind(String(c.get("project").projectId), id)
    .first<OperationRow>();
  if (!row) {
    throw httpError(
      "analytics_operation_not_found",
      "Operation not found",
      404,
    );
  }
  return serializeOperation(row);
}

export async function listAnalyticsOperations(c: AnalyticsContext) {
  const limit = positiveLimit(c.req.query("limit"), 50);
  const rows = await c.env.DB.prepare(
    `SELECT id, project_id, operation_type, status, input_json, result_json,
      error_message, requested_by, started_at, completed_at, created_at, updated_at
     FROM analytics_operation_jobs WHERE project_id = ?
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(String(c.get("project").projectId), limit)
    .all<OperationRow>();
  return { items: rows.results.map(serializeOperation) };
}

export async function resumeQueuedOperations(
  env: Env,
  maximum = 10,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id, project_id FROM analytics_operation_jobs
     WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(maximum)
    .all<{ id: string; project_id: string }>();
  for (const row of rows.results) {
    await startOperation(env, { jobId: row.id, projectId: row.project_id });
  }
  return rows.results.length;
}

async function startOperation(
  env: Env,
  payload: AnalyticsOperationPayload,
): Promise<void> {
  try {
    await env.ANALYTICS_OPERATIONS_WORKFLOW.create({
      id: payload.jobId,
      params: payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists|instance.*exists/i.test(message)) return;
    console.error(
      JSON.stringify({
        event: "analytics_operation_start_failed",
        job_id: payload.jobId,
        error: message,
      }),
    );
  }
}

export class AnalyticsOperationsWorkflow extends WorkflowEntrypoint<
  Env,
  AnalyticsOperationPayload
> {
  async run(
    event: WorkflowEvent<AnalyticsOperationPayload>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const payload = event.payload;
    await step.do("mark-running", async () => {
      await this.env.DB.prepare(
        `UPDATE analytics_operation_jobs
         SET status = 'running', started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
             error_message = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND project_id = ? AND status IN ('queued', 'running')`,
      )
        .bind(payload.jobId, payload.projectId)
        .run();
    });
    try {
      const resultJson = await step.do(
        "execute-operation",
        {
          retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
          timeout: "15 minutes",
        },
        async () =>
          stableAnalyticsJson(await executeOperation(this.env, payload)),
      );
      const result = parseRecord(resultJson);
      await step.do("mark-completed", async () => {
        await this.env.DB.prepare(
          `UPDATE analytics_operation_jobs
           SET status = 'completed', result_json = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND project_id = ?`,
        )
          .bind(stableAnalyticsJson(result), payload.jobId, payload.projectId)
          .run();
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.env.DB.prepare(
        `UPDATE analytics_operation_jobs
         SET status = 'failed', error_message = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND project_id = ?`,
      )
        .bind(message.slice(0, 2_000), payload.jobId, payload.projectId)
        .run();
      throw error;
    }
  }
}

async function executeOperation(
  env: Env,
  payload: AnalyticsOperationPayload,
): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(
    `SELECT id, project_id, operation_type, status, input_json, result_json,
      error_message, requested_by, started_at, completed_at, created_at, updated_at
     FROM analytics_operation_jobs WHERE id = ? AND project_id = ?`,
  )
    .bind(payload.jobId, payload.projectId)
    .first<OperationRow>();
  if (!row) throw new Error("Analytics operation job is missing");
  const input = parseRecord(row.input_json);
  switch (row.operation_type) {
    case "export":
      return exportAnalytics(env, payload, input);
    case "replay":
      return replayDeadLetters(env, payload, input);
    case "rebuild_rollups":
      return rebuildRollups(env.DB, payload.projectId);
    case "erase_subject":
      return eraseSubject(env, payload.projectId, input);
  }
}

async function exportAnalytics(
  env: Env,
  payload: AnalyticsOperationPayload,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const from =
    typeof input.from === "string" ? input.from : "1970-01-01T00:00:00.000Z";
  const to = typeof input.to === "string" ? input.to : new Date().toISOString();
  const rows = await env.DB.prepare(
    `SELECT event_id, event_name, event_source, application_id,
      app_instance_id_hash, session_id_hash, anonymous_id_hash, user_id_hash,
      properties_json, context_json, occurred_at, archive_key
     FROM analytics_events_hot
     WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ?
     ORDER BY occurred_at ASC, event_id ASC LIMIT 25000`,
  )
    .bind(payload.projectId, from, to)
    .all<Record<string, unknown>>();
  const key = `v1/exports/project=${encodeURIComponent(payload.projectId)}/job=${encodeURIComponent(payload.jobId)}.ndjson`;
  const lines = rows.results.map((row) => stableAnalyticsJson(row)).join("\n");
  await env.EVENT_ARCHIVE.put(key, lines ? `${lines}\n` : "", {
    httpMetadata: { contentType: "application/x-ndjson; charset=UTF-8" },
    customMetadata: {
      project_id: payload.projectId,
      operation_id: payload.jobId,
      row_count: String(rows.results.length),
    },
  });
  return {
    object_key: key,
    row_count: rows.results.length,
    truncated: rows.results.length === 25_000,
  };
}

async function replayDeadLetters(
  env: Env,
  payload: AnalyticsOperationPayload,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestedId =
    typeof input.dead_letter_id === "string" ? input.dead_letter_id : null;
  const rows = await env.DB.prepare(
    `SELECT id, project_id, event_id FROM analytics_dead_letters
     WHERE project_id = ? AND status = 'quarantined'${requestedId ? " AND id = ?" : ""}
     ORDER BY received_at ASC LIMIT 100`,
  )
    .bind(payload.projectId, ...(requestedId ? [requestedId] : []))
    .all<{ id: string; project_id: string; event_id: string | null }>();
  let replayed = 0;
  for (const row of rows.results) {
    if (!row.event_id) continue;
    const queueMessage: AnalyticsQueueMessageV1 = {
      schema_version: ANALYTICS_SCHEMA_VERSION,
      type: "analytics.event.project",
      project_id: row.project_id,
      event_id: row.event_id,
    };
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE analytics_dead_letters SET status = 'replayed',
          resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).bind(row.id),
      env.DB.prepare(
        `UPDATE analytics_ingest_outbox SET status = 'pending', available_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE project_id = ? AND event_id = ?`,
      ).bind(row.project_id, row.event_id),
      env.DB.prepare(
        `UPDATE analytics_event_receipts SET status = 'queued',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE project_id = ? AND event_id = ?`,
      ).bind(row.project_id, row.event_id),
    ]);
    await env.ANALYTICS_INGEST_QUEUE.send(queueMessage, {
      contentType: "json",
    });
    replayed += 1;
  }
  return { replayed };
}

async function rebuildRollups(
  db: D1Database,
  projectId: string,
): Promise<Record<string, unknown>> {
  const result = await db.batch([
    db
      .prepare("DELETE FROM analytics_daily_metrics WHERE project_id = ?")
      .bind(projectId),
    db
      .prepare(
        `INSERT INTO analytics_daily_metrics
        (project_id, application_id, metric_date, metric_name, dimension_key, event_count)
       SELECT project_id, application_id, substr(occurred_at, 1, 10), 'event', event_name, COUNT(*)
       FROM analytics_events_hot WHERE project_id = ?
       GROUP BY project_id, application_id, substr(occurred_at, 1, 10), event_name`,
      )
      .bind(projectId),
  ]);
  return { rebuilt_rows: Number(result[1].meta.changes ?? 0) };
}

async function eraseSubject(
  env: Env,
  projectId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const hashes = Array.isArray(input.subject_hashes)
    ? input.subject_hashes.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (hashes.length === 0) throw new Error("Subject hashes are missing");
  const placeholders = hashes.map(() => "?").join(", ");
  const indexed = await env.DB.prepare(
    `SELECT DISTINCT event_id, archive_key FROM analytics_subject_event_index
     WHERE project_id = ? AND subject_hash IN (${placeholders}) LIMIT 50000`,
  )
    .bind(projectId, ...hashes)
    .all<{ event_id: string; archive_key: string }>();
  for (let index = 0; index < indexed.results.length; index += 1_000) {
    await env.EVENT_ARCHIVE.delete(
      indexed.results.slice(index, index + 1_000).map((row) => row.archive_key),
    );
  }
  const eventIds = [...new Set(indexed.results.map((row) => row.event_id))];
  for (let index = 0; index < eventIds.length; index += 90) {
    const chunk = eventIds.slice(index, index + 90);
    const eventPlaceholders = chunk.map(() => "?").join(", ");
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM analytics_events_hot WHERE project_id = ? AND event_id IN (${eventPlaceholders})`,
      ).bind(projectId, ...chunk),
      env.DB.prepare(
        `DELETE FROM analytics_ingest_outbox WHERE project_id = ? AND event_id IN (${eventPlaceholders})`,
      ).bind(projectId, ...chunk),
      env.DB.prepare(
        `DELETE FROM analytics_marketing_signal_outbox
         WHERE project_id = ? AND event_id IN (${eventPlaceholders})`,
      ).bind(projectId, ...chunk),
      env.DB.prepare(
        `DELETE FROM analytics_projection_receipts
         WHERE project_id = ? AND event_id IN (${eventPlaceholders})`,
      ).bind(projectId, ...chunk),
      // Keep a content-free tombstone so a delayed or malicious replay cannot
      // recreate data that was already erased.
      env.DB.prepare(
        `UPDATE analytics_event_receipts SET status = 'erased', archive_key = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE project_id = ? AND event_id IN (${eventPlaceholders})`,
      ).bind(projectId, ...chunk),
    ]);
  }
  const result = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM analytics_installations
       WHERE project_id = ? AND app_instance_id_hash IN (${placeholders})`,
    ).bind(projectId, ...hashes),
    env.DB.prepare(
      `DELETE FROM analytics_sessions
       WHERE project_id = ? AND (app_instance_id_hash IN (${placeholders})
         OR profile_id IN (
           SELECT profile_id FROM analytics_identity_aliases
           WHERE project_id = ? AND alias_hash IN (${placeholders})
         ))`,
    ).bind(projectId, ...hashes, projectId, ...hashes),
    env.DB.prepare(
      `DELETE FROM analytics_identity_aliases
       WHERE project_id = ? AND alias_hash IN (${placeholders})`,
    ).bind(projectId, ...hashes),
    env.DB.prepare(
      `DELETE FROM analytics_profiles WHERE project_id = ? AND id NOT IN
        (SELECT DISTINCT profile_id FROM analytics_identity_aliases WHERE project_id = ?)`,
    ).bind(projectId, projectId),
    env.DB.prepare(
      `DELETE FROM analytics_subject_event_index
       WHERE project_id = ? AND subject_hash IN (${placeholders})`,
    ).bind(projectId, ...hashes),
  ]);
  return {
    erased_events: eventIds.length,
    erased_archives: indexed.results.length,
    erased_installations: Number(result[0].meta.changes ?? 0),
    erased_sessions: Number(result[1].meta.changes ?? 0),
    erased_aliases: Number(result[2].meta.changes ?? 0),
    erased_profiles: Number(result[3].meta.changes ?? 0),
  };
}

export async function eraseAnalyticsSubject(
  env: Env,
  projectId: string,
  kind: "user" | "anonymous" | "app_instance",
  subjectId: string,
): Promise<Record<string, unknown>> {
  const subjectHashes = await identityHashCandidates(
    env,
    projectId,
    kind,
    subjectId,
  );
  return eraseSubject(env, projectId, { subject_hashes: subjectHashes });
}

async function normalizedOperationInput(
  env: Env,
  projectId: string,
  type: AnalyticsOperationType,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (type !== "erase_subject") return input;
  const subjectId = text(input.subject_id, "subject_id", 1_024);
  const kind = String(input.kind ?? "user");
  if (
    !(["user", "anonymous", "app_instance"] as const).includes(kind as "user")
  ) {
    throw httpError(
      "analytics_erasure_kind_invalid",
      "kind must be user, anonymous, or app_instance",
      400,
    );
  }
  const hashes = await identityHashCandidates(
    env,
    projectId,
    kind as "user" | "anonymous" | "app_instance",
    subjectId,
  );
  return { kind, subject_hashes: hashes };
}

function operationBody(value: unknown): {
  raw: Record<string, unknown>;
  type: AnalyticsOperationType;
  input: Record<string, unknown>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(
      "analytics_operation_invalid",
      "Operation body must be an object",
      400,
    );
  }
  const raw = value as Record<string, unknown>;
  const type = String(raw.operation_type ?? "") as AnalyticsOperationType;
  if (
    !["export", "replay", "rebuild_rollups", "erase_subject"].includes(type)
  ) {
    throw httpError(
      "analytics_operation_type_invalid",
      "Operation type is invalid",
      400,
    );
  }
  const input = raw.input;
  if (
    input !== undefined &&
    (!input || typeof input !== "object" || Array.isArray(input))
  ) {
    throw httpError(
      "analytics_operation_input_invalid",
      "Operation input must be an object",
      400,
    );
  }
  return { raw, type, input: (input ?? {}) as Record<string, unknown> };
}

function authorizeOperation(role: string, type: AnalyticsOperationType): void {
  if (
    (type === "rebuild_rollups" || type === "erase_subject") &&
    !["owner", "admin"].includes(role)
  ) {
    throw httpError(
      "analytics_operation_forbidden",
      "This operation requires an owner or admin role",
      403,
    );
  }
}

function serializeOperation(row: OperationRow) {
  return {
    id: row.id,
    operation_type: row.operation_type,
    status: row.status,
    input: parseRecord(row.input_json),
    result: row.result_json ? parseRecord(row.result_json) : null,
    error_message: row.error_message,
    requested_by: row.requested_by,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function text(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  ) {
    throw httpError(
      "analytics_operation_input_invalid",
      `${field} must contain between 1 and ${maximum} characters`,
      400,
    );
  }
  return value.trim();
}
