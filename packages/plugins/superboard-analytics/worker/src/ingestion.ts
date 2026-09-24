import {
  ANALYTICS_SCHEMA_VERSION,
  stableAnalyticsJson,
  type AnalyticsEventV1,
  type AnalyticsIngestResultV1,
  type AnalyticsQueueMessageV1,
} from "@superboard/contracts/analytics";
import type { ProjectContext } from "@superboard/contracts/project-context";
import { analyticsPayloadHash, pseudonymizeEvent } from "./crypto";
import { httpError } from "./http";
import { projectStoredEvent } from "./projections";
import type { Env, EventReceipt, OutboxRow } from "./types";

const OUTBOX_RETRY_SECONDS = 60;

export async function ingestAnalyticsEvents(
  env: Env,
  project: ProjectContext,
  events: AnalyticsEventV1[],
): Promise<AnalyticsIngestResultV1[]> {
  const projectId = String(project.projectId);
  if (
    project.role !== "system" &&
    !(await dataCollectionEnabled(env.DB, projectId))
  ) {
    return events.map((event) => ({
      event_id: event.event_id,
      status: "rejected",
      code: "analytics_collection_disabled",
    }));
  }
  const inactiveApplications =
    project.role === "system"
      ? new Set<string>()
      : await disabledApplications(env.DB, projectId, events);
  const results: AnalyticsIngestResultV1[] = [];
  const accepted: string[] = [];
  for (const event of events) {
    if (inactiveApplications.has(event.application_id)) {
      results.push({
        event_id: event.event_id,
        status: "rejected",
        code: "analytics_application_disabled",
      });
      continue;
    }
    const result = await ingestOne(env, project, event);
    results.push(result);
    if (result.status === "accepted") accepted.push(event.event_id);
  }
  await dispatchOutboxEvents(env, projectId, accepted);
  return results;
}

async function disabledApplications(
  db: D1Database,
  projectId: string,
  events: AnalyticsEventV1[],
): Promise<Set<string>> {
  const applicationIds = [
    ...new Set(events.map((event) => event.application_id)),
  ];
  const placeholders = applicationIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT application_id FROM analytics_applications
       WHERE project_id = ? AND active = 0
         AND application_id IN (${placeholders})`,
    )
    .bind(projectId, ...applicationIds)
    .all<{ application_id: string }>();
  return new Set(rows.results.map((row) => row.application_id));
}

async function dataCollectionEnabled(
  db: D1Database,
  projectId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT data_collection_enabled FROM analytics_project_settings WHERE project_id = ?",
    )
    .bind(projectId)
    .first<{ data_collection_enabled: number }>();
  return row == null || Number(row.data_collection_enabled) === 1;
}

async function ingestOne(
  env: Env,
  project: ProjectContext,
  event: AnalyticsEventV1,
): Promise<AnalyticsIngestResultV1> {
  const projectId = String(project.projectId);
  const payloadHash = await analyticsPayloadHash(event);
  const existing = await receipt(env.DB, projectId, event.event_id);
  if (existing) return replayResult(existing, payloadHash);

  const stored = await pseudonymizeEvent(env, projectId, event);
  const outboxId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO analytics_event_receipts
          (project_id, event_id, payload_sha256, event_name, event_source, application_id, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        projectId,
        event.event_id,
        payloadHash,
        event.event_name,
        event.source,
        event.application_id,
        event.occurred_at,
      ),
      env.DB.prepare(
        `INSERT INTO analytics_ingest_outbox
          (id, project_id, project_ref, instance_id, environment, event_id, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        outboxId,
        projectId,
        project.projectRef,
        project.instanceId,
        project.environment,
        event.event_id,
        stableAnalyticsJson(stored),
      ),
    ]);
  } catch (error) {
    const concurrent = await receipt(env.DB, projectId, event.event_id);
    if (concurrent) return replayResult(concurrent, payloadHash);
    throw error;
  }
  return { event_id: event.event_id, status: "accepted" };
}

function replayResult(
  existing: EventReceipt,
  payloadHash: string,
): AnalyticsIngestResultV1 {
  if (existing.payload_sha256 === payloadHash) {
    return { event_id: existing.event_id, status: "duplicate" };
  }
  return {
    event_id: existing.event_id,
    status: "rejected",
    code: "analytics_event_id_conflict",
  };
}

async function receipt(
  db: D1Database,
  projectId: string,
  eventId: string,
): Promise<EventReceipt | null> {
  return db
    .prepare(
      `SELECT project_id, event_id, payload_sha256, status, archive_key
       FROM analytics_event_receipts WHERE project_id = ? AND event_id = ?`,
    )
    .bind(projectId, eventId)
    .first<EventReceipt>();
}

export async function dispatchOutboxEvents(
  env: Env,
  projectId: string,
  eventIds: string[],
): Promise<void> {
  for (const eventId of eventIds) {
    const row = await env.DB.prepare(
      `SELECT id, project_id, project_ref, instance_id, environment,
        event_id, payload_json, status, attempt_count
       FROM analytics_ingest_outbox
       WHERE project_id = ? AND event_id = ? AND status != 'completed'`,
    )
      .bind(projectId, eventId)
      .first<OutboxRow>();
    if (row) await dispatchOutboxRow(env, row);
  }
}

export async function drainAnalyticsOutbox(
  env: Env,
  maximum = 100,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id, project_id, project_ref, instance_id, environment,
      event_id, payload_json, status, attempt_count
     FROM analytics_ingest_outbox
     WHERE (
       (status = 'pending' AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       OR (status IN ('dispatched', 'processing') AND updated_at <= datetime('now', '-5 minutes'))
     )
     ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(Math.max(1, Math.min(maximum, 250)))
    .all<OutboxRow>();
  for (const row of rows.results) await dispatchOutboxRow(env, row);
  return rows.results.length;
}

async function dispatchOutboxRow(env: Env, row: OutboxRow): Promise<void> {
  const message: AnalyticsQueueMessageV1 = {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    type: "analytics.event.project",
    project_id: row.project_id,
    event_id: row.event_id,
  };
  try {
    await env.ANALYTICS_INGEST_QUEUE.send(message, {
      contentType: "json",
    });
    await env.DB.prepare(
      `UPDATE analytics_ingest_outbox
       SET status = 'dispatched', dispatched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = NULL
       WHERE id = ? AND status != 'completed'`,
    )
      .bind(row.id)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      `UPDATE analytics_ingest_outbox
       SET status = 'pending', attempt_count = attempt_count + 1,
           available_at = datetime('now', ?), last_error = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status != 'completed'`,
    )
      .bind(`+${OUTBOX_RETRY_SECONDS} seconds`, message.slice(0, 2_000), row.id)
      .run();
    console.error(
      JSON.stringify({
        event: "analytics_outbox_dispatch_failed",
        project_id: row.project_id,
        event_id: row.event_id,
        error: message,
      }),
    );
  }
}

export async function handleAnalyticsQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  if (batch.queue === env.DLQ_NAME) {
    await quarantineDeadLetters(batch, env);
    return;
  }
  for (const message of batch.messages) {
    if (!isAnalyticsQueueMessage(message.body)) {
      console.error(
        JSON.stringify({
          event: "analytics_queue_message_rejected",
          message_id: message.id,
        }),
      );
      message.ack();
      continue;
    }
    try {
      await processAnalyticsQueueMessage(env, message.body);
      message.ack();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await env.DB.prepare(
        `UPDATE analytics_ingest_outbox
         SET status = 'processing', attempt_count = attempt_count + 1,
             last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE project_id = ? AND event_id = ? AND status != 'completed'`,
      )
        .bind(
          errorMessage.slice(0, 2_000),
          message.body.project_id,
          message.body.event_id,
        )
        .run();
      console.error(
        JSON.stringify({
          event: "analytics_queue_projection_failed",
          message_id: message.id,
          project_id: message.body.project_id,
          event_id: message.body.event_id,
          attempt: message.attempts,
          error: errorMessage,
        }),
      );
      message.retry({
        delaySeconds: Math.min(900, 15 * 2 ** Math.min(message.attempts, 6)),
      });
    }
  }
}

async function processAnalyticsQueueMessage(
  env: Env,
  message: AnalyticsQueueMessageV1,
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT id, project_id, project_ref, instance_id, environment,
      event_id, payload_json, status, attempt_count
     FROM analytics_ingest_outbox WHERE project_id = ? AND event_id = ?`,
  )
    .bind(message.project_id, message.event_id)
    .first<OutboxRow>();
  if (!row || row.status === "completed") return;
  let stored: unknown;
  try {
    stored = JSON.parse(row.payload_json);
  } catch {
    throw httpError(
      "analytics_outbox_payload_invalid",
      "Stored analytics payload is invalid",
      500,
    );
  }
  await projectStoredEvent(env, row, stored);
}

async function quarantineDeadLetters(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const body = isAnalyticsQueueMessage(message.body) ? message.body : null;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO analytics_dead_letters
            (id, project_id, event_id, source_queue, message_id, payload_json, attempts)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          body?.project_id ?? null,
          body?.event_id ?? null,
          batch.queue,
          message.id,
          stableAnalyticsJson(message.body),
          message.attempts,
        ),
        env.DB.prepare(
          `UPDATE analytics_ingest_outbox
           SET status = 'dead_letter', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE project_id = ? AND event_id = ? AND status != 'completed'`,
        ).bind(body?.project_id ?? "", body?.event_id ?? ""),
        env.DB.prepare(
          `UPDATE analytics_event_receipts
           SET status = 'dead_letter', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE project_id = ? AND event_id = ? AND status != 'projected'`,
        ).bind(body?.project_id ?? "", body?.event_id ?? ""),
      ]);
      message.ack();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "analytics_dead_letter_persistence_failed",
          message_id: message.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      message.retry({ delaySeconds: 60 });
    }
  }
}

export function isAnalyticsQueueMessage(
  value: unknown,
): value is AnalyticsQueueMessageV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    message.schema_version === ANALYTICS_SCHEMA_VERSION &&
    message.type === "analytics.event.project" &&
    typeof message.project_id === "string" &&
    message.project_id.length > 0 &&
    typeof message.event_id === "string" &&
    message.event_id.length > 0
  );
}
