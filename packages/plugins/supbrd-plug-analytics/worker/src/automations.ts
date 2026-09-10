import {
  EMAIL_SERVICE_SEND_PATH,
  type EmailServiceMessage,
} from "@superboard/contracts/email";
import { stableAnalyticsJson } from "@superboard/contracts/analytics";
import { isSafePublicHttpsUrl } from "@superboard/contracts/url-security";
import {
  decryptAnalyticsConfiguration,
  signAnalyticsWebhook,
} from "./configuration-crypto";
import type { Env } from "./types";

const MAX_AUTOMATIONS_PER_TICK = 100;
const WEBHOOK_TIMEOUT_MS = 10_000;

type AlertRow = {
  id: string;
  project_id: string;
  name: string;
  alert_type: string;
  definition_json: string;
  channels_json: string;
  cooldown_minutes: number;
  last_triggered_at: string | null;
};

type AlertEvaluation = {
  triggered: boolean;
  summary: string;
  value: Record<string, unknown>;
};

type HookDeliveryRow = {
  id: string;
  project_id: string;
  hook_id: string;
  event_id: string;
  event_type: string;
  payload_json: string;
  attempt_count: number;
  endpoint_url: string;
  encrypted_secret: string | null;
};

export async function evaluateAnalyticsAlerts(env: Env): Promise<void> {
  const alerts = await env.DB.prepare(
    `SELECT id, project_id, name, alert_type, definition_json, channels_json,
            cooldown_minutes, last_triggered_at
     FROM analytics_alerts WHERE enabled = 1
     ORDER BY COALESCE(last_evaluated_at, created_at), id
     LIMIT ?`,
  )
    .bind(MAX_AUTOMATIONS_PER_TICK)
    .all<AlertRow>();
  for (const alert of alerts.results) {
    try {
      await evaluateAlert(env, alert);
    } catch (error) {
      console.error(
        stableAnalyticsJson({
          event: "analytics_alert_evaluation_failed",
          project_id: alert.project_id,
          alert_id: alert.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

export async function drainAnalyticsHooks(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT delivery.id, delivery.project_id, delivery.hook_id,
            delivery.event_id, delivery.event_type, delivery.payload_json,
            delivery.attempt_count, hook.endpoint_url, hook.encrypted_secret
     FROM analytics_hook_deliveries delivery
     JOIN analytics_hooks hook
       ON hook.id = delivery.hook_id AND hook.project_id = delivery.project_id
     WHERE hook.enabled = 1
       AND (
         (delivery.status IN ('pending', 'failed')
          AND (delivery.next_attempt_at IS NULL OR delivery.next_attempt_at <= ?))
         OR (delivery.status = 'delivering'
             AND delivery.updated_at <= datetime('now', '-5 minutes'))
       )
     ORDER BY delivery.created_at, delivery.id LIMIT ?`,
  )
    .bind(new Date().toISOString(), MAX_AUTOMATIONS_PER_TICK)
    .all<HookDeliveryRow>();
  for (const row of rows.results) await deliverHook(env, row);
}

async function evaluateAlert(env: Env, alert: AlertRow): Promise<void> {
  const now = new Date();
  const definition = jsonObject(alert.definition_json);
  const evaluation = await evaluateDefinition(env.DB, alert, definition, now);
  await env.DB.prepare(
    "UPDATE analytics_alerts SET last_evaluated_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(now.toISOString(), now.toISOString(), alert.id)
    .run();
  if (!evaluation.triggered || coolingDown(alert, now)) return;

  const windowMinutes = integer(definition.window_minutes, 60, 1, 10_080);
  const windowStart = new Date(
    Math.floor(now.getTime() / (windowMinutes * 60_000)) *
      windowMinutes *
      60_000,
  ).toISOString();
  const dedupeKey = `${alert.alert_type}:${windowStart}`;
  const incidentId = crypto.randomUUID();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO analytics_alert_incidents
      (id, project_id, alert_id, dedupe_key, summary, value_json, triggered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  )
    .bind(
      incidentId,
      alert.project_id,
      alert.id,
      dedupeKey,
      evaluation.summary,
      stableAnalyticsJson(evaluation.value),
      now.toISOString(),
    )
    .first<{ id: string }>();
  if (!inserted) return;

  const eventPayload = {
    id: incidentId,
    type: "alert.triggered",
    project_id: alert.project_id,
    alert: { id: alert.id, name: alert.name, type: alert.alert_type },
    summary: evaluation.summary,
    value: evaluation.value,
    triggered_at: now.toISOString(),
  };
  await enqueueHooks(env.DB, alert.project_id, incidentId, eventPayload);
  const notifications = await notifyAlert(
    env,
    alert,
    incidentId,
    evaluation.summary,
    evaluation.value,
  );
  const successful = notifications.filter(
    (item) => item.status === "sent",
  ).length;
  const notificationStatus =
    notifications.length === 0 || successful === notifications.length
      ? "sent"
      : successful > 0
        ? "partial"
        : "failed";
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE analytics_alert_incidents
       SET notification_status = ?, notifications_json = ?
       WHERE project_id = ? AND id = ?`,
    ).bind(
      notificationStatus,
      stableAnalyticsJson(notifications),
      alert.project_id,
      incidentId,
    ),
    env.DB.prepare(
      "UPDATE analytics_alerts SET last_triggered_at = ?, updated_at = ? WHERE id = ?",
    ).bind(now.toISOString(), now.toISOString(), alert.id),
  ]);
}

async function evaluateDefinition(
  db: D1Database,
  alert: AlertRow,
  definition: Record<string, unknown>,
  now: Date,
): Promise<AlertEvaluation> {
  const windowMinutes = integer(definition.window_minutes, 60, 1, 10_080);
  const from = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  if (alert.alert_type === "crash_spike") {
    const count = await scalar(
      db,
      `SELECT COUNT(*) AS value FROM analytics_crash_occurrences
       WHERE project_id = ? AND occurred_at >= ?`,
      alert.project_id,
      from,
    );
    const threshold = number(definition.threshold, 10, 0);
    return comparison(
      count,
      String(definition.operator ?? "gte"),
      threshold,
      `${count} crashs détectés sur ${windowMinutes} minutes`,
      { count, threshold, window_minutes: windowMinutes },
    );
  }
  if (alert.alert_type === "no_data") {
    const count = await scalar(
      db,
      `SELECT COUNT(*) AS value FROM analytics_events_hot
       WHERE project_id = ? AND occurred_at >= ?`,
      alert.project_id,
      from,
    );
    return {
      triggered: count === 0,
      summary: `Aucun événement Analytics reçu depuis ${windowMinutes} minutes`,
      value: { count, window_minutes: windowMinutes },
    };
  }
  if (
    alert.alert_type === "purchase_drop" ||
    alert.alert_type === "installation_drop"
  ) {
    const table =
      alert.alert_type === "purchase_drop"
        ? "analytics_purchase_facts"
        : "analytics_installations";
    const timestamp =
      alert.alert_type === "purchase_drop" ? "occurred_at" : "installed_at";
    const previousFrom = new Date(
      now.getTime() - windowMinutes * 2 * 60_000,
    ).toISOString();
    const previousTo = from;
    const [current, previous] = await Promise.all([
      scalar(
        db,
        `SELECT COUNT(*) AS value FROM ${table} WHERE project_id = ? AND ${timestamp} >= ?`,
        alert.project_id,
        from,
      ),
      scalar(
        db,
        `SELECT COUNT(*) AS value FROM ${table}
         WHERE project_id = ? AND ${timestamp} >= ? AND ${timestamp} < ?`,
        alert.project_id,
        previousFrom,
        previousTo,
      ),
    ]);
    const dropPercentage =
      previous === 0 ? 0 : Math.round(((previous - current) / previous) * 100);
    const threshold = number(definition.drop_percentage, 50, 0);
    const metric =
      alert.alert_type === "purchase_drop" ? "paiements" : "installations";
    return {
      triggered: previous > 0 && dropPercentage >= threshold,
      summary: `Baisse de ${dropPercentage}% des ${metric} vérifiés`,
      value: { current, previous, drop_percentage: dropPercentage, threshold },
    };
  }

  const eventName = string(definition.event_name, "");
  if (!eventName) {
    return {
      triggered: false,
      summary: "Aucun événement configuré",
      value: {},
    };
  }
  const count = await scalar(
    db,
    `SELECT COUNT(*) AS value FROM analytics_events_hot
     WHERE project_id = ? AND event_name = ? AND occurred_at >= ?`,
    alert.project_id,
    eventName,
    from,
  );
  const threshold = number(definition.threshold, 1, 0);
  return comparison(
    count,
    String(definition.operator ?? "gte"),
    threshold,
    `${count} événements « ${eventName} » sur ${windowMinutes} minutes`,
    { event_name: eventName, count, threshold, window_minutes: windowMinutes },
  );
}

async function notifyAlert(
  env: Env,
  alert: AlertRow,
  incidentId: string,
  summary: string,
  value: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const channels = jsonArray(alert.channels_json);
  const results: Array<Record<string, unknown>> = [];
  for (const channel of channels) {
    if (!channel || typeof channel !== "object" || Array.isArray(channel))
      continue;
    const candidate = channel as Record<string, unknown>;
    const type = String(candidate.type ?? "");
    if (type !== "email") continue;
    const recipient = string(candidate.to, "");
    if (!recipient) continue;
    try {
      await sendAlertEmail(env, {
        kind: "transactional",
        projectId: Number(alert.project_id),
        idempotencyKey: `analytics.alert:${incidentId}:${recipient}`,
        to: recipient,
        subject: `[SuperBoard Analytics] ${alert.name}`,
        text: `${summary}\n\n${stableAnalyticsJson(value)}`,
        templateKey: "analytics.alert.triggered",
        metadata: { alert_id: alert.id, incident_id: incidentId },
      });
      results.push({ type, status: "sent" });
    } catch (error) {
      results.push({
        type,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      });
    }
  }
  return results;
}

async function sendAlertEmail(env: Env, message: EmailServiceMessage) {
  if (!env.EMAIL_SERVICE || !env.EMAIL_INTERNAL_TOKEN?.trim()) {
    throw new Error("Email service is unavailable");
  }
  const response = await env.EMAIL_SERVICE.fetch(
    `https://email.internal${EMAIL_SERVICE_SEND_PATH}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": env.EMAIL_INTERNAL_TOKEN,
      },
      body: stableAnalyticsJson(message),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new Error(`Email service returned ${response.status}`);
}

async function enqueueHooks(
  db: D1Database,
  projectId: string,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const hooks = await db
    .prepare(
      `SELECT id, event_types_json FROM analytics_hooks
       WHERE project_id = ? AND enabled = 1`,
    )
    .bind(projectId)
    .all<{ id: string; event_types_json: string }>();
  const now = new Date().toISOString();
  const statements = hooks.results
    .filter((hook) =>
      jsonArray(hook.event_types_json).includes("alert.triggered"),
    )
    .map((hook) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO analytics_hook_deliveries
            (id, project_id, hook_id, event_id, event_type, payload_json,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, 'alert.triggered', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          projectId,
          hook.id,
          eventId,
          stableAnalyticsJson(payload),
          now,
          now,
        ),
    );
  if (statements.length) await db.batch(statements);
}

async function deliverHook(env: Env, row: HookDeliveryRow): Promise<void> {
  const now = new Date().toISOString();
  const lease = await env.DB.prepare(
    `UPDATE analytics_hook_deliveries
     SET status = 'delivering', attempt_count = attempt_count + 1, updated_at = ?
     WHERE id = ? AND (
       status IN ('pending', 'failed')
       OR (status = 'delivering' AND updated_at <= datetime('now', '-5 minutes'))
     )
     RETURNING id`,
  )
    .bind(now, row.id)
    .first<{ id: string }>();
  if (!lease) return;
  try {
    if (!isSafePublicHttpsUrl(row.endpoint_url)) {
      throw new Error("Webhook endpoint is no longer a public HTTPS URL");
    }
    const headers = new Headers({
      "content-type": "application/json",
      "user-agent": "SuperBoard-Analytics-Hooks/1.0",
      "x-superboard-event": row.event_type,
      "x-superboard-delivery": row.id,
    });
    if (row.encrypted_secret) {
      const configured = await decryptAnalyticsConfiguration<{
        secret: string;
      }>(env.ANALYTICS_CONFIG_ENCRYPTION_KEY, row.encrypted_secret);
      headers.set(
        "x-superboard-signature",
        await signAnalyticsWebhook(configured.secret, row.payload_json),
      );
    }
    const response = await fetch(row.endpoint_url, {
      method: "POST",
      headers,
      body: row.payload_json,
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
    const completedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE analytics_hook_deliveries
         SET status = 'delivered', delivered_at = ?, next_attempt_at = NULL,
             last_error = NULL, updated_at = ? WHERE id = ?`,
      ).bind(completedAt, completedAt, row.id),
      env.DB.prepare(
        `UPDATE analytics_hooks
         SET last_delivery_at = ?, last_delivery_status = 'delivered', updated_at = ?
         WHERE project_id = ? AND id = ?`,
      ).bind(completedAt, completedAt, row.project_id, row.hook_id),
    ]);
  } catch (error) {
    const attempts = row.attempt_count + 1;
    const nextAttempt = new Date(
      Date.now() + Math.min(3_600, 2 ** Math.min(attempts, 10)) * 1_000,
    ).toISOString();
    const reason = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 2_000);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE analytics_hook_deliveries
         SET status = 'failed', next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(nextAttempt, reason, new Date().toISOString(), row.id),
      env.DB.prepare(
        `UPDATE analytics_hooks SET last_delivery_at = ?,
             last_delivery_status = 'failed', updated_at = ?
         WHERE project_id = ? AND id = ?`,
      ).bind(now, now, row.project_id, row.hook_id),
    ]);
  }
}

async function scalar(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...bindings)
    .first<{ value: number }>();
  return Number(row?.value ?? 0);
}

function comparison(
  actual: number,
  operator: string,
  expected: number,
  summary: string,
  value: Record<string, unknown>,
): AlertEvaluation {
  const triggered =
    operator === "gt"
      ? actual > expected
      : operator === "lte"
        ? actual <= expected
        : operator === "lt"
          ? actual < expected
          : operator === "eq"
            ? actual === expected
            : actual >= expected;
  return { triggered, summary, value };
}

function coolingDown(alert: AlertRow, now: Date): boolean {
  if (!alert.last_triggered_at) return false;
  const last = Date.parse(alert.last_triggered_at);
  return (
    Number.isFinite(last) &&
    last + Number(alert.cooldown_minutes) * 60_000 > now.getTime()
  );
}

function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function jsonArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function number(value: unknown, fallback: number, minimum: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function string(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length ? value : fallback;
}
