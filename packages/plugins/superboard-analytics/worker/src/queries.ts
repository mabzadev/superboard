import { parseAnalyticsEventV1 } from "@superboard/contracts/analytics";
import { httpError, optionalIsoTimestamp, positiveLimit } from "./http";

export type AnalyticsQuery = {
  applicationId: string | null;
  from: string;
  to: string;
};

type MetricRow = {
  metric_date: string;
  event_count: number;
};

type HotEventRow = {
  event_id: string;
  event_name: string;
  event_source: string;
  application_id: string;
  app_instance_id_hash: string | null;
  session_id_hash: string | null;
  anonymous_id_hash: string | null;
  user_id_hash: string | null;
  properties_json: string;
  context_json: string;
  occurred_at: string;
  archive_key: string;
};

export function analyticsQueryFromUrl(url: URL): AnalyticsQuery {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 29 * 86_400_000);
  const from =
    optionalIsoTimestamp(url.searchParams.get("from") ?? undefined, "from") ??
    defaultFrom.toISOString();
  const to =
    optionalIsoTimestamp(url.searchParams.get("to") ?? undefined, "to") ??
    now.toISOString();
  if (Date.parse(from) > Date.parse(to)) {
    throw httpError(
      "analytics_range_invalid",
      "from must not be later than to",
      400,
    );
  }
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) {
    throw httpError(
      "analytics_range_too_large",
      "Interactive analytics queries are limited to 366 days",
      400,
    );
  }
  const applicationId = url.searchParams.get("application_id")?.trim() || null;
  return { applicationId, from, to };
}

export async function analyticsOverview(
  db: D1Database,
  projectId: string,
  query: AnalyticsQuery,
) {
  const applicationWhere = query.applicationId ? " AND application_id = ?" : "";
  const bindings = query.applicationId
    ? [projectId, query.from, query.to, query.applicationId]
    : [projectId, query.from, query.to];
  const [
    events,
    sessions,
    installations,
    purchases,
    revenueByCurrency,
    series,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS event_count,
          COUNT(DISTINCT COALESCE(user_id_hash, anonymous_id_hash, app_instance_id_hash)) AS unique_subjects
         FROM analytics_events_hot
         WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ?${applicationWhere}`,
      )
      .bind(...bindings)
      .first<{ event_count: number; unique_subjects: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS session_count,
          COALESCE(AVG(duration_seconds), 0) AS average_duration_seconds
         FROM analytics_sessions
         WHERE project_id = ? AND started_at >= ? AND started_at <= ?${applicationWhere}`,
      )
      .bind(...bindings)
      .first<{ session_count: number; average_duration_seconds: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS installation_count
         FROM analytics_installations
         WHERE project_id = ? AND installed_at >= ? AND installed_at <= ?${applicationWhere}`,
      )
      .bind(...bindings)
      .first<{ installation_count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS purchase_event_count,
          SUM(CASE WHEN event_type IN ('initial_purchase', 'renewal', 'trial_converted')
            THEN 1 ELSE 0 END) AS successful_purchase_count
         FROM analytics_purchase_facts
         WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ?${applicationWhere}`,
      )
      .bind(...bindings)
      .first<{
        purchase_event_count: number;
        successful_purchase_count: number;
      }>(),
    db
      .prepare(
        `SELECT UPPER(currency) AS currency,
          COALESCE(SUM(CASE WHEN event_type IN ('refund', 'chargeback', 'cancellation')
            THEN -COALESCE(amount_micros, 0) ELSE COALESCE(amount_micros, 0) END), 0)
            AS net_revenue_micros
         FROM analytics_purchase_facts
         WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ?
           AND currency IS NOT NULL${applicationWhere}
         GROUP BY UPPER(currency) ORDER BY UPPER(currency)`,
      )
      .bind(...bindings)
      .all<{ currency: string; net_revenue_micros: number }>(),
    overviewSeries(db, projectId, query),
  ]);
  const revenue = revenueByCurrency.results.map((row) => ({
    currency: row.currency,
    net_revenue_micros: Number(row.net_revenue_micros),
  }));
  return {
    range: { from: query.from, to: query.to },
    application_id: query.applicationId,
    events: Number(events?.event_count ?? 0),
    unique_subjects: Number(events?.unique_subjects ?? 0),
    sessions: Number(sessions?.session_count ?? 0),
    average_session_duration_seconds: Math.round(
      Number(sessions?.average_duration_seconds ?? 0),
    ),
    installations: Number(installations?.installation_count ?? 0),
    purchase_events: Number(purchases?.purchase_event_count ?? 0),
    successful_purchases: Number(purchases?.successful_purchase_count ?? 0),
    net_revenue_micros:
      revenue.length === 1 ? revenue[0]!.net_revenue_micros : null,
    net_revenue_currency: revenue.length === 1 ? revenue[0]!.currency : null,
    net_revenue_by_currency: revenue,
    series,
  };
}

async function overviewSeries(
  db: D1Database,
  projectId: string,
  query: AnalyticsQuery,
) {
  const applicationWhere = query.applicationId ? " AND application_id = ?" : "";
  const bindings = query.applicationId
    ? [
        projectId,
        query.from.slice(0, 10),
        query.to.slice(0, 10),
        query.applicationId,
      ]
    : [projectId, query.from.slice(0, 10), query.to.slice(0, 10)];
  const rows = await db
    .prepare(
      `SELECT metric_date, SUM(event_count) AS event_count
       FROM analytics_daily_metrics
       WHERE project_id = ? AND metric_name = 'event'
         AND metric_date >= ? AND metric_date <= ?${applicationWhere}
       GROUP BY metric_date ORDER BY metric_date ASC`,
    )
    .bind(...bindings)
    .all<MetricRow>();
  return rows.results.map((row) => ({
    date: row.metric_date,
    events: Number(row.event_count),
  }));
}

export async function listAnalyticsEvents(
  db: D1Database,
  projectId: string,
  url: URL,
) {
  const query = analyticsQueryFromUrl(url);
  const limit = positiveLimit(url.searchParams.get("limit") ?? undefined);
  const eventName = url.searchParams.get("event_name")?.trim() || null;
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const conditions = ["project_id = ?", "occurred_at >= ?", "occurred_at <= ?"];
  const bindings: unknown[] = [projectId, query.from, query.to];
  if (query.applicationId) {
    conditions.push("application_id = ?");
    bindings.push(query.applicationId);
  }
  if (eventName) {
    conditions.push("event_name = ?");
    bindings.push(eventName);
  }
  if (cursor) {
    conditions.push("(occurred_at < ? OR (occurred_at = ? AND event_id < ?))");
    bindings.push(cursor.occurredAt, cursor.occurredAt, cursor.eventId);
  }
  bindings.push(limit + 1);
  const rows = await db
    .prepare(
      `SELECT event_id, event_name, event_source, application_id,
        app_instance_id_hash, session_id_hash, anonymous_id_hash, user_id_hash,
        properties_json, context_json, occurred_at, archive_key
       FROM analytics_events_hot WHERE ${conditions.join(" AND ")}
       ORDER BY occurred_at DESC, event_id DESC LIMIT ?`,
    )
    .bind(...bindings)
    .all<HotEventRow>();
  const hasMore = rows.results.length > limit;
  const page = hasMore ? rows.results.slice(0, limit) : rows.results;
  const last = page.at(-1);
  return {
    items: page.map(serializeHotEvent),
    next_cursor:
      hasMore && last ? encodeCursor(last.occurred_at, last.event_id) : null,
  };
}

export async function listInstallations(
  db: D1Database,
  projectId: string,
  url: URL,
) {
  const query = analyticsQueryFromUrl(url);
  const limit = positiveLimit(url.searchParams.get("limit") ?? undefined);
  const applicationWhere = query.applicationId ? " AND application_id = ?" : "";
  const bindings: unknown[] = [projectId, query.from, query.to];
  if (query.applicationId) bindings.push(query.applicationId);
  bindings.push(limit);
  const rows = await db
    .prepare(
      `SELECT id, application_id, app_instance_id_hash, source_event_id,
        installed_at, platform, app_version, attribution_id
       FROM analytics_installations
       WHERE project_id = ? AND installed_at >= ? AND installed_at <= ?${applicationWhere}
       ORDER BY installed_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return { items: rows.results };
}

export async function listPurchaseFacts(
  db: D1Database,
  projectId: string,
  url: URL,
) {
  const query = analyticsQueryFromUrl(url);
  const limit = positiveLimit(url.searchParams.get("limit") ?? undefined);
  const applicationWhere = query.applicationId ? " AND application_id = ?" : "";
  const bindings: unknown[] = [projectId, query.from, query.to];
  if (query.applicationId) bindings.push(query.applicationId);
  bindings.push(limit);
  const rows = await db
    .prepare(
      `SELECT id, application_id, source_event_id, billing_transaction_id,
        store, environment, store_transaction_id, event_type, product_id,
        amount_micros, currency, occurred_at
       FROM analytics_purchase_facts
       WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ?${applicationWhere}
       ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return { items: rows.results };
}

export async function queryFunnel(
  db: D1Database,
  projectId: string,
  value: unknown,
) {
  const body = record(value);
  const steps = stringArray(body.steps, "steps", 2, 10);
  const query = queryFromBody(body);
  const placeholders = steps.map(() => "?").join(", ");
  const applicationWhere = query.applicationId ? " AND application_id = ?" : "";
  const bindings: unknown[] = [projectId, query.from, query.to, ...steps];
  if (query.applicationId) bindings.push(query.applicationId);
  const rows = await db
    .prepare(
      `SELECT event_name, occurred_at,
        COALESCE(user_id_hash, anonymous_id_hash, app_instance_id_hash) AS subject_hash
       FROM analytics_events_hot
       WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ?
         AND event_name IN (${placeholders})${applicationWhere}
         AND COALESCE(user_id_hash, anonymous_id_hash, app_instance_id_hash) IS NOT NULL
       ORDER BY subject_hash, occurred_at, event_id LIMIT 100000`,
    )
    .bind(...bindings)
    .all<{ event_name: string; occurred_at: string; subject_hash: string }>();
  const progress = new Map<string, number>();
  for (const row of rows.results) {
    const current = progress.get(row.subject_hash) ?? 0;
    if (current < steps.length && row.event_name === steps[current]) {
      progress.set(row.subject_hash, current + 1);
    }
  }
  const counts = steps.map(
    (_, index) =>
      [...progress.values()].filter((completed) => completed > index).length,
  );
  return {
    range: { from: query.from, to: query.to },
    application_id: query.applicationId,
    steps: steps.map((eventName, index) => ({
      event_name: eventName,
      subjects: counts[index],
      conversion_from_first:
        counts[0] > 0 ? Number((counts[index] / counts[0]).toFixed(4)) : 0,
      conversion_from_previous:
        index === 0
          ? 1
          : counts[index - 1] > 0
            ? Number((counts[index] / counts[index - 1]).toFixed(4))
            : 0,
    })),
  };
}

export async function queryRetention(
  db: D1Database,
  projectId: string,
  url: URL,
) {
  const query = analyticsQueryFromUrl(url);
  const days = Math.min(
    90,
    Math.max(1, Number(url.searchParams.get("days") ?? 30) || 30),
  );
  const applicationWhere = query.applicationId
    ? " AND i.application_id = ?"
    : "";
  const bindings: unknown[] = [projectId, query.from, query.to, days];
  if (query.applicationId) bindings.push(query.applicationId);
  const rows = await db
    .prepare(
      `SELECT substr(i.installed_at, 1, 10) AS cohort_date,
        CAST(julianday(substr(e.occurred_at, 1, 10)) - julianday(substr(i.installed_at, 1, 10)) AS INTEGER) AS day_number,
        COUNT(DISTINCT i.app_instance_id_hash) AS retained_subjects
       FROM analytics_installations i
       JOIN analytics_events_hot e
         ON e.project_id = i.project_id
        AND e.application_id = i.application_id
        AND e.app_instance_id_hash = i.app_instance_id_hash
       WHERE i.project_id = ? AND i.installed_at >= ? AND i.installed_at <= ?
         AND CAST(julianday(substr(e.occurred_at, 1, 10)) - julianday(substr(i.installed_at, 1, 10)) AS INTEGER)
           BETWEEN 0 AND ?${applicationWhere}
       GROUP BY cohort_date, day_number
       ORDER BY cohort_date ASC, day_number ASC`,
    )
    .bind(...bindings)
    .all<{
      cohort_date: string;
      day_number: number;
      retained_subjects: number;
    }>();
  const cohortSizes = await db
    .prepare(
      `SELECT substr(installed_at, 1, 10) AS cohort_date, COUNT(*) AS cohort_size
       FROM analytics_installations
       WHERE project_id = ? AND installed_at >= ? AND installed_at <= ?${
         query.applicationId ? " AND application_id = ?" : ""
       }
       GROUP BY cohort_date ORDER BY cohort_date ASC`,
    )
    .bind(
      projectId,
      query.from,
      query.to,
      ...(query.applicationId ? [query.applicationId] : []),
    )
    .all<{ cohort_date: string; cohort_size: number }>();
  const sizes = new Map(
    cohortSizes.results.map((row) => [
      row.cohort_date,
      Number(row.cohort_size),
    ]),
  );
  return {
    range: { from: query.from, to: query.to },
    application_id: query.applicationId,
    cohorts: cohortSizes.results.map((cohort) => {
      const size = sizes.get(cohort.cohort_date) ?? 0;
      return {
        cohort_date: cohort.cohort_date,
        size,
        days: rows.results
          .filter((row) => row.cohort_date === cohort.cohort_date)
          .map((row) => ({
            day: Number(row.day_number),
            subjects: Number(row.retained_subjects),
            rate:
              size > 0
                ? Number((Number(row.retained_subjects) / size).toFixed(4))
                : 0,
          })),
      };
    }),
  };
}

function serializeHotEvent(row: HotEventRow) {
  return {
    event_id: row.event_id,
    event_name: row.event_name,
    source: row.event_source,
    application_id: row.application_id,
    app_instance_id_hash: row.app_instance_id_hash,
    session_id_hash: row.session_id_hash,
    anonymous_id_hash: row.anonymous_id_hash,
    user_id_hash: row.user_id_hash,
    properties: parseJson(row.properties_json),
    context: parseJson(row.context_json),
    occurred_at: row.occurred_at,
    archived: Boolean(row.archive_key),
  };
}

function parseJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function encodeCursor(occurredAt: string, eventId: string): string {
  return btoa(JSON.stringify([occurredAt, eventId]));
}

function decodeCursor(
  value: string | null,
): { occurredAt: string; eventId: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(atob(value));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      Number.isFinite(Date.parse(parsed[0]))
    ) {
      return {
        occurredAt: new Date(parsed[0]).toISOString(),
        eventId: parsed[1],
      };
    }
  } catch {
    // Invalid cursors are rejected below.
  }
  throw httpError("analytics_cursor_invalid", "cursor is invalid", 400);
}

function queryFromBody(body: Record<string, unknown>): AnalyticsQuery {
  const now = new Date();
  const from = body.from
    ? parseAnalyticsEventV1({
        event_id: "range-validation",
        event_name: "range.validation",
        occurred_at: body.from,
        application_id: "range-validation",
        properties: {},
      }).occurred_at
    : new Date(now.getTime() - 29 * 86_400_000).toISOString();
  const to = body.to
    ? parseAnalyticsEventV1({
        event_id: "range-validation",
        event_name: "range.validation",
        occurred_at: body.to,
        application_id: "range-validation",
        properties: {},
      }).occurred_at
    : now.toISOString();
  if (Date.parse(from) > Date.parse(to)) {
    throw httpError(
      "analytics_range_invalid",
      "from must not be later than to",
      400,
    );
  }
  return {
    from,
    to,
    applicationId:
      typeof body.application_id === "string" && body.application_id.trim()
        ? body.application_id.trim()
        : null,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(
      "analytics_query_invalid",
      "Query body must be an object",
      400,
    );
  }
  return value as Record<string, unknown>;
}

function stringArray(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw httpError(
      "analytics_query_invalid",
      `${field} must contain between ${minimum} and ${maximum} values`,
      400,
    );
  }
  const result = value.map((item) =>
    typeof item === "string" ? item.trim() : "",
  );
  if (result.some((item) => !item || item.length > 128)) {
    throw httpError(
      "analytics_query_invalid",
      `${field} contains an invalid event name`,
      400,
    );
  }
  return result;
}
