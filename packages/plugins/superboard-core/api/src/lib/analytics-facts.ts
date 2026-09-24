import {
  PROJECT_CONTEXT_HEADERS,
  signProjectContext,
  type InternalProjectContext,
  type ProjectEnvironment,
} from "@superboard/contracts/project-context";
import {
  stableAnalyticsJson,
  type AnalyticsEventV1,
} from "@superboard/contracts/analytics";
import { readTextLimited } from "@superboard/contracts/request-body";

type AnalyticsProducerEnv = {
  DB: D1Database;
  ANALYTICS_MODULE?: Fetcher;
  MODULE_INTERNAL_TOKEN?: string;
  INTERNAL_API_TOKEN?: string;
};

type AnalyticsFactOutboxRow = {
  id: string;
  project_id: string;
  fact_key: string;
  event_id: string;
  payload_json: string;
  status: "pending" | "delivering" | "delivered" | "dead_letter";
  attempt_count: number;
};

export function enqueueAnalyticsFactStatement(
  db: D1Database,
  params: {
    projectId: string | number;
    factKey: string;
    event: AnalyticsEventV1;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO analytics_fact_outbox
        (id, project_id, fact_key, event_id, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      String(params.projectId),
      params.factKey,
      params.event.event_id,
      stableAnalyticsJson(params.event),
    );
}

export async function canonicalAnalyticsEventId(
  namespace: string,
  factKey: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${namespace}:${factKey}`),
    ),
  );
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${namespace}-${hex}`;
}

export async function deliverAnalyticsFact(
  env: AnalyticsProducerEnv,
  projectId: string | number,
  factKey: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id, project_id, fact_key, event_id, payload_json, status, attempt_count
     FROM analytics_fact_outbox
     WHERE project_id = ? AND fact_key = ? AND status != 'delivered'`,
  )
    .bind(String(projectId), factKey)
    .first<AnalyticsFactOutboxRow>();
  if (!row) return true;
  return deliverRow(env, row);
}

export async function drainAnalyticsFactOutbox(
  env: AnalyticsProducerEnv,
  maximum = 100,
): Promise<{ inspected: number; delivered: number; failed: number }> {
  const rows = await env.DB.prepare(
    `SELECT id, project_id, fact_key, event_id, payload_json, status, attempt_count
     FROM analytics_fact_outbox
     WHERE (status = 'pending' AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        OR (status = 'delivering' AND updated_at <= datetime('now', '-5 minutes'))
     ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(Math.max(1, Math.min(maximum, 250)))
    .all<AnalyticsFactOutboxRow>();
  let delivered = 0;
  let failed = 0;
  for (const row of rows.results) {
    if (await deliverRow(env, row)) delivered += 1;
    else failed += 1;
  }
  return { inspected: rows.results.length, delivered, failed };
}

async function deliverRow(
  env: AnalyticsProducerEnv,
  row: AnalyticsFactOutboxRow,
): Promise<boolean> {
  if (!env.ANALYTICS_MODULE) {
    await reschedule(env.DB, row, "Analytics service binding is unavailable");
    return false;
  }
  const token =
    env.MODULE_INTERNAL_TOKEN?.trim() || env.INTERNAL_API_TOKEN?.trim() || "";
  if (!token) {
    await reschedule(env.DB, row, "Analytics service credentials are unavailable");
    return false;
  }
  const claimed = await env.DB.prepare(
    `UPDATE analytics_fact_outbox
     SET status = 'delivering', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND status IN ('pending', 'delivering')`,
  )
    .bind(row.id)
    .run();
  if (Number(claimed.meta.changes ?? 0) === 0) return row.status === "delivered";
  try {
    const project = await env.DB.prepare(
      `SELECT id, instance_id, is_test FROM projects WHERE id = ? LIMIT 1`,
    )
      .bind(row.project_id)
      .first<{ id: number; instance_id: number; is_test: number }>();
    if (!project) {
      await markDeadLetter(env.DB, row, "Analytics project no longer exists");
      return false;
    }
    const environment: ProjectEnvironment = Number(project.is_test) === 1
      ? "test"
      : "production";
    const context: InternalProjectContext = {
      module: "analytics",
      method: "POST",
      pathname: "/internal/v1/events",
      projectId: Number(project.id),
      projectRef: `${project.instance_id}-${environment === "test" ? "test" : "prod"}`,
      instanceId: Number(project.instance_id),
      environment,
      actorId: 0,
      role: "system",
      requestId: crypto.randomUUID(),
      issuedAt: Math.floor(Date.now() / 1_000),
    };
    const signature = await signProjectContext(context, token);
    const headers = analyticsHeaders(context, token, signature);
    const response = await env.ANALYTICS_MODULE.fetch(
      "https://analytics.internal/internal/v1/events",
      {
        method: "POST",
        headers,
        body: row.payload_json,
        signal: AbortSignal.timeout(30_000),
      },
    );
    const responseText = await readTextLimited(response, 64_000);
    if (response.ok && !hasRejectedFact(responseText)) {
      await env.DB.prepare(
        `UPDATE analytics_fact_outbox
         SET status = 'delivered', delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
        .bind(row.id)
        .run();
      return true;
    }
    const summary = `Analytics rejected fact with HTTP ${response.status}: ${responseText}`;
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      await markDeadLetter(env.DB, row, summary);
      return false;
    }
    await reschedule(env.DB, row, summary);
    return false;
  } catch (error) {
    await reschedule(
      env.DB,
      row,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

function analyticsHeaders(
  context: InternalProjectContext,
  token: string,
  signature: string,
): Headers {
  return new Headers({
    "content-type": "application/json",
    [PROJECT_CONTEXT_HEADERS.token]: token,
    [PROJECT_CONTEXT_HEADERS.projectId]: String(context.projectId),
    [PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
    [PROJECT_CONTEXT_HEADERS.instanceId]: String(context.instanceId),
    [PROJECT_CONTEXT_HEADERS.environment]: context.environment,
    [PROJECT_CONTEXT_HEADERS.actorId]: String(context.actorId),
    [PROJECT_CONTEXT_HEADERS.role]: context.role,
    [PROJECT_CONTEXT_HEADERS.requestId]: context.requestId,
    [PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
    [PROJECT_CONTEXT_HEADERS.version]: "1",
    [PROJECT_CONTEXT_HEADERS.signature]: signature,
  });
}

function hasRejectedFact(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as { data?: { rejected?: unknown } };
    return Number(parsed.data?.rejected ?? 0) > 0;
  } catch {
    return false;
  }
}

async function reschedule(
  db: D1Database,
  row: AnalyticsFactOutboxRow,
  error: string,
): Promise<void> {
  const delay = Math.min(3_600, 15 * 2 ** Math.min(row.attempt_count, 8));
  await db.prepare(
    `UPDATE analytics_fact_outbox
     SET status = 'pending', attempt_count = attempt_count + 1,
         available_at = datetime('now', ?), last_error = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  )
    .bind(`+${delay} seconds`, error.slice(0, 2_000), row.id)
    .run();
}

async function markDeadLetter(
  db: D1Database,
  row: AnalyticsFactOutboxRow,
  error: string,
): Promise<void> {
  await db.prepare(
    `UPDATE analytics_fact_outbox
     SET status = 'dead_letter', attempt_count = attempt_count + 1,
         last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  )
    .bind(error.slice(0, 2_000), row.id)
    .run();
}
