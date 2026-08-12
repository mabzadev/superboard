import {
  PROJECT_CONTEXT_HEADERS,
  signProjectContext,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import {
  stableAnalyticsJson,
  type AnalyticsEventV1,
  type MarketingSignalV1,
} from "@superboard/contracts/analytics";
import { readTextLimited } from "@superboard/contracts/request-body";
import type { Env, OutboxRow } from "./types";

type SignalEnv = Env & { MARKETING_MODULE?: Fetcher };

type MarketingSignalRow = {
  id: string;
  project_id: string;
  project_ref: string;
  instance_id: number;
  environment: "production" | "test";
  event_id: string;
  payload_json: string;
  attempt_count: number;
};

export function marketingSignalStatement(
  db: D1Database,
  outbox: OutboxRow,
  event: AnalyticsEventV1,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO analytics_marketing_signal_outbox
        (id, project_id, project_ref, instance_id, environment, event_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      outbox.project_id,
      outbox.project_ref,
      outbox.instance_id,
      outbox.environment,
      event.event_id,
      stableAnalyticsJson({
        schema_version: 1,
        event_id: event.event_id,
        event_name: event.event_name,
        application_id: event.application_id,
        subject_hash:
          event.user_id ?? event.anonymous_id ?? event.app_instance_id ?? null,
        properties: event.properties,
        occurred_at: event.occurred_at,
      } satisfies MarketingSignalV1),
    );
}

export async function deliverMarketingSignal(
  env: SignalEnv,
  projectId: string,
  eventId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id, project_id, project_ref, instance_id, environment, event_id,
      payload_json, attempt_count
     FROM analytics_marketing_signal_outbox
     WHERE project_id = ? AND event_id = ? AND status != 'delivered'`,
  )
    .bind(projectId, eventId)
    .first<MarketingSignalRow>();
  return row ? deliverRow(env, row) : true;
}

export async function drainMarketingSignals(
  env: SignalEnv,
  maximum = 100,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id, project_id, project_ref, instance_id, environment, event_id,
      payload_json, attempt_count
     FROM analytics_marketing_signal_outbox
     WHERE status = 'pending'
       AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     ORDER BY created_at LIMIT ?`,
  )
    .bind(Math.max(1, Math.min(maximum, 250)))
    .all<MarketingSignalRow>();
  for (const row of rows.results) await deliverRow(env, row);
  return rows.results.length;
}

async function deliverRow(env: SignalEnv, row: MarketingSignalRow) {
  if (!env.MARKETING_MODULE) return false;
  const claimed = await env.DB.prepare(
    `UPDATE analytics_marketing_signal_outbox
     SET status = 'delivering', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND status = 'pending' RETURNING id`,
  )
    .bind(row.id)
    .first();
  if (!claimed) return false;
  try {
    const request = await signedMarketingRequest(env, row);
    const response = await env.MARKETING_MODULE.fetch(request);
    if (!response.ok) {
      const detail = await readTextLimited(response, 1_000);
      throw new Error(
        `Marketing signal failed with HTTP ${response.status}: ${detail}`,
      );
    }
    await env.DB.prepare(
      `UPDATE analytics_marketing_signal_outbox
       SET status = 'delivered', delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
      .bind(row.id)
      .run();
    return true;
  } catch (error) {
    const attempts = row.attempt_count + 1;
    const terminal = attempts >= 12;
    await env.DB.prepare(
      `UPDATE analytics_marketing_signal_outbox
       SET status = ?, attempt_count = ?, available_at = datetime('now', ?),
         last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
      .bind(
        terminal ? "dead_letter" : "pending",
        attempts,
        `+${Math.min(3_600, 15 * 2 ** Math.min(attempts, 8))} seconds`,
        (error instanceof Error ? error.message : String(error)).slice(
          0,
          2_000,
        ),
        row.id,
      )
      .run();
    console.error(
      JSON.stringify({
        event: "analytics_marketing_signal_failed",
        project_id: row.project_id,
        event_id: row.event_id,
        terminal,
      }),
    );
    return false;
  }
}

async function signedMarketingRequest(env: Env, row: MarketingSignalRow) {
  const pathname = "/internal/v1/signals";
  const context: InternalProjectContext = {
    module: "marketing",
    method: "POST",
    pathname,
    projectId: Number(row.project_id),
    projectRef: row.project_ref,
    instanceId: row.instance_id,
    environment: row.environment,
    actorId: 0,
    role: "system",
    requestId: row.event_id,
    issuedAt: Math.floor(Date.now() / 1_000),
  };
  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": row.event_id,
    [PROJECT_CONTEXT_HEADERS.token]: env.INTERNAL_API_TOKEN,
    [PROJECT_CONTEXT_HEADERS.projectId]: String(context.projectId),
    [PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
    [PROJECT_CONTEXT_HEADERS.instanceId]: String(context.instanceId),
    [PROJECT_CONTEXT_HEADERS.environment]: context.environment,
    [PROJECT_CONTEXT_HEADERS.actorId]: String(context.actorId),
    [PROJECT_CONTEXT_HEADERS.role]: context.role,
    [PROJECT_CONTEXT_HEADERS.requestId]: context.requestId,
    [PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
    [PROJECT_CONTEXT_HEADERS.version]: "1",
    [PROJECT_CONTEXT_HEADERS.signature]: await signProjectContext(
      context,
      env.INTERNAL_API_TOKEN,
    ),
  });
  return new Request(`https://marketing.internal${pathname}`, {
    method: "POST",
    headers,
    body: row.payload_json,
  });
}
