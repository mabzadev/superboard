import { stableAnalyticsJson } from "@superboard/contracts/analytics";
import { isSafePublicHttpsUrl } from "@superboard/contracts/url-security";
import type { AnalyticsContext } from "./http";
import { httpError, positiveLimit, readJson } from "./http";
import { commitAnalyticsMutation } from "./mutations";
import { sha256Hex } from "./crypto";
import { encryptAnalyticsConfiguration } from "./configuration-crypto";

type MutationResult = Awaited<ReturnType<typeof commitAnalyticsMutation>>;

export async function listApplications(c: AnalyticsContext) {
  const rows = await c.env.DB.prepare(
    `SELECT application_id, name, platform, timezone, active, first_seen_at,
            last_seen_at, settings_json, created_at, updated_at
     FROM analytics_applications WHERE project_id = ?
     ORDER BY active DESC, last_seen_at DESC, application_id`,
  )
    .bind(projectId(c))
    .all<Record<string, unknown>>();
  return {
    items: rows.results.map((row) => ({
      ...row,
      active: Number(row.active) === 1,
      settings: parseJson(row.settings_json, {}),
      settings_json: undefined,
    })),
  };
}

export async function updateApplication(
  c: AnalyticsContext,
  applicationId: string,
): Promise<MutationResult> {
  const current = await c.env.DB.prepare(
    `SELECT application_id, name, platform, timezone, active, settings_json
     FROM analytics_applications WHERE project_id = ? AND application_id = ?`,
  )
    .bind(projectId(c), applicationId)
    .first<Record<string, unknown>>();
  if (!current) {
    throw httpError(
      "analytics_application_not_found",
      "Application not found",
      404,
    );
  }
  const body = objectBody(await readJson(c.req.raw));
  const name = optionalText(body.name, 120) ?? String(current.name);
  const timezone = optionalText(body.timezone, 64) ?? String(current.timezone);
  const active =
    body.active === undefined
      ? Number(current.active) === 1
      : body.active === true;
  const settings =
    body.settings === undefined
      ? parseJson(current.settings_json, {})
      : jsonObject(body.settings, "settings");
  const now = new Date().toISOString();
  const data = {
    application_id: applicationId,
    name,
    timezone,
    active,
    settings,
    updated_at: now,
  };
  return mutation(c, {
    action: "analytics.application.updated",
    entityType: "application",
    entityId: applicationId,
    body,
    data,
    statements: [
      c.env.DB.prepare(
        `UPDATE analytics_applications
         SET name = ?, timezone = ?, active = ?, settings_json = ?, updated_at = ?
         WHERE project_id = ? AND application_id = ?`,
      ).bind(
        name,
        timezone,
        active ? 1 : 0,
        stableAnalyticsJson(settings),
        now,
        projectId(c),
        applicationId,
      ),
    ],
  });
}

export async function listDashboards(c: AnalyticsContext) {
  const rows = await c.env.DB.prepare(
    `SELECT dashboard.id, dashboard.name, dashboard.description,
            dashboard.visibility, dashboard.layout_json, dashboard.created_by,
            dashboard.created_at, dashboard.updated_at,
            COUNT(widget.id) AS widget_count
     FROM analytics_dashboards dashboard
     LEFT JOIN analytics_dashboard_widgets widget
       ON widget.dashboard_id = dashboard.id AND widget.project_id = dashboard.project_id
     WHERE dashboard.project_id = ?
     GROUP BY dashboard.id ORDER BY dashboard.updated_at DESC, dashboard.id DESC`,
  )
    .bind(projectId(c))
    .all<Record<string, unknown>>();
  return { items: rows.results.map(serializeDashboard) };
}

export async function getDashboard(c: AnalyticsContext, id: string) {
  const dashboard = await dashboardRow(c, id);
  const widgets = await c.env.DB.prepare(
    `SELECT id, widget_type, title, definition_json, position_json, created_at, updated_at
     FROM analytics_dashboard_widgets
     WHERE project_id = ? AND dashboard_id = ? ORDER BY created_at, id`,
  )
    .bind(projectId(c), id)
    .all<Record<string, unknown>>();
  return {
    ...serializeDashboard(dashboard),
    widgets: widgets.results.map(serializeWidget),
  };
}

export async function createDashboard(
  c: AnalyticsContext,
): Promise<MutationResult> {
  const body = objectBody(await readJson(c.req.raw));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = requiredText(body.name, "name", 120);
  const description = optionalText(body.description, 1_000);
  const visibility = choice(body.visibility ?? "private", "visibility", [
    "private",
    "project",
  ] as const);
  const layout =
    body.layout === undefined ? {} : jsonObject(body.layout, "layout");
  const data = {
    id,
    name,
    description,
    visibility,
    layout,
    widget_count: 0,
    created_at: now,
    updated_at: now,
  };
  return mutation(c, {
    action: "analytics.dashboard.created",
    entityType: "dashboard",
    entityId: id,
    body,
    data,
    status: 201,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO analytics_dashboards
          (id, project_id, name, description, visibility, layout_json,
           created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        projectId(c),
        name,
        description,
        visibility,
        stableAnalyticsJson(layout),
        actorId(c),
        now,
        now,
      ),
    ],
  });
}

export async function updateDashboard(
  c: AnalyticsContext,
  id: string,
): Promise<MutationResult> {
  const current = await dashboardRow(c, id);
  const body = objectBody(await readJson(c.req.raw));
  const name = optionalText(body.name, 120) ?? String(current.name);
  const description =
    body.description === undefined
      ? nullableString(current.description)
      : optionalText(body.description, 1_000);
  const visibility =
    body.visibility === undefined
      ? String(current.visibility)
      : choice(body.visibility, "visibility", ["private", "project"] as const);
  const layout =
    body.layout === undefined
      ? parseJson(current.layout_json, {})
      : jsonObject(body.layout, "layout");
  const now = new Date().toISOString();
  const data = { id, name, description, visibility, layout, updated_at: now };
  return mutation(c, {
    action: "analytics.dashboard.updated",
    entityType: "dashboard",
    entityId: id,
    body,
    data,
    statements: [
      c.env.DB.prepare(
        `UPDATE analytics_dashboards
         SET name = ?, description = ?, visibility = ?, layout_json = ?, updated_at = ?
         WHERE project_id = ? AND id = ?`,
      ).bind(
        name,
        description,
        visibility,
        stableAnalyticsJson(layout),
        now,
        projectId(c),
        id,
      ),
    ],
  });
}

export async function deleteDashboard(
  c: AnalyticsContext,
  id: string,
): Promise<MutationResult> {
  await dashboardRow(c, id);
  return deleteMutation(
    c,
    "dashboard",
    "analytics.dashboard.deleted",
    id,
    c.env.DB.prepare(
      "DELETE FROM analytics_dashboards WHERE project_id = ? AND id = ?",
    ).bind(projectId(c), id),
  );
}

const WIDGET_TYPES = [
  "metric",
  "timeseries",
  "event",
  "funnel",
  "retention",
  "table",
  "map",
  "crashes",
  "views",
  "purchases",
  "installations",
] as const;

export async function createDashboardWidget(
  c: AnalyticsContext,
  dashboardId: string,
): Promise<MutationResult> {
  await dashboardRow(c, dashboardId);
  const body = objectBody(await readJson(c.req.raw));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const widgetType = choice(body.widget_type, "widget_type", WIDGET_TYPES);
  const title = requiredText(body.title, "title", 120);
  const definition = jsonObject(body.definition, "definition");
  const position =
    body.position === undefined ? {} : jsonObject(body.position, "position");
  const data = {
    id,
    dashboard_id: dashboardId,
    widget_type: widgetType,
    title,
    definition,
    position,
    created_at: now,
    updated_at: now,
  };
  return mutation(c, {
    action: "analytics.dashboard_widget.created",
    entityType: "dashboard_widget",
    entityId: id,
    body,
    data,
    status: 201,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO analytics_dashboard_widgets
          (id, project_id, dashboard_id, widget_type, title, definition_json,
           position_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        projectId(c),
        dashboardId,
        widgetType,
        title,
        stableAnalyticsJson(definition),
        stableAnalyticsJson(position),
        now,
        now,
      ),
      c.env.DB.prepare(
        "UPDATE analytics_dashboards SET updated_at = ? WHERE project_id = ? AND id = ?",
      ).bind(now, projectId(c), dashboardId),
    ],
  });
}

export async function deleteDashboardWidget(
  c: AnalyticsContext,
  dashboardId: string,
  widgetId: string,
): Promise<MutationResult> {
  const row = await c.env.DB.prepare(
    "SELECT id FROM analytics_dashboard_widgets WHERE project_id = ? AND dashboard_id = ? AND id = ?",
  )
    .bind(projectId(c), dashboardId, widgetId)
    .first();
  if (!row)
    throw httpError("analytics_widget_not_found", "Widget not found", 404);
  return deleteMutation(
    c,
    "dashboard_widget",
    "analytics.dashboard_widget.deleted",
    widgetId,
    c.env.DB.prepare(
      "DELETE FROM analytics_dashboard_widgets WHERE project_id = ? AND dashboard_id = ? AND id = ?",
    ).bind(projectId(c), dashboardId, widgetId),
  );
}

export async function listViews(c: AnalyticsContext) {
  const url = new URL(c.req.url);
  const from = iso(url.searchParams.get("from")) ?? "1970-01-01T00:00:00.000Z";
  const to = iso(url.searchParams.get("to")) ?? new Date().toISOString();
  const rows = await c.env.DB.prepare(
    `SELECT view_name, MAX(view_url) AS view_url, COUNT(*) AS views,
            COUNT(DISTINCT session_id_hash) AS sessions,
            ROUND(AVG(duration_seconds), 2) AS average_duration_seconds,
            MAX(occurred_at) AS last_seen_at
     FROM analytics_view_facts
     WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ?
     GROUP BY view_name ORDER BY views DESC, view_name LIMIT ?`,
  )
    .bind(projectId(c), from, to, positiveLimit(c.req.query("limit"), 100))
    .all<Record<string, unknown>>();
  return { items: rows.results, from, to };
}

const PRODUCT_DIMENSIONS = [
  "platform",
  "app_version",
  "os_version",
  "device",
  "device_type",
  "browser",
  "browser_version",
  "country_code",
  "city",
  "carrier",
  "screen_resolution",
  "connection_type",
  "campaign",
  "acquisition_source",
] as const;

export async function listDimensions(c: AnalyticsContext) {
  const url = new URL(c.req.url);
  const from = iso(url.searchParams.get("from")) ?? "1970-01-01T00:00:00.000Z";
  const to = iso(url.searchParams.get("to")) ?? new Date().toISOString();
  const entries = await Promise.all(
    PRODUCT_DIMENSIONS.map(async (dimension) => {
      const jsonPath = `$.${dimension}`;
      const rows = await c.env.DB.prepare(
        `SELECT json_extract(context_json, ?) AS value,
                COUNT(*) AS events,
                COUNT(DISTINCT COALESCE(user_id_hash, anonymous_id_hash,
                                        app_instance_id_hash)) AS users
         FROM analytics_events_hot
         WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ?
           AND json_extract(context_json, ?) IS NOT NULL
           AND json_extract(context_json, ?) != ''
         GROUP BY json_extract(context_json, ?)
         ORDER BY events DESC, value LIMIT 50`,
      )
        .bind(jsonPath, projectId(c), from, to, jsonPath, jsonPath, jsonPath)
        .all<{ value: string; events: number; users: number }>();
      return [dimension, rows.results] as const;
    }),
  );
  return { dimensions: Object.fromEntries(entries), from, to };
}

export async function analyzeEvent(c: AnalyticsContext) {
  const url = new URL(c.req.url);
  const eventName = requiredText(
    url.searchParams.get("event_name"),
    "event_name",
    128,
  );
  const from = iso(url.searchParams.get("from")) ?? "1970-01-01T00:00:00.000Z";
  const to = iso(url.searchParams.get("to")) ?? new Date().toISOString();
  const property = optionalText(url.searchParams.get("property"), 128);
  if (property && !/^[A-Za-z0-9_.:-]+$/u.test(property)) {
    throw httpError(
      "analytics_property_invalid",
      "Event property is invalid",
      400,
    );
  }
  const [series, properties, totals] = await Promise.all([
    c.env.DB.prepare(
      `SELECT substr(occurred_at, 1, 10) AS date, COUNT(*) AS events,
              COUNT(DISTINCT COALESCE(user_id_hash, anonymous_id_hash,
                                      app_instance_id_hash)) AS users
       FROM analytics_events_hot
       WHERE project_id = ? AND event_name = ?
         AND occurred_at >= ? AND occurred_at <= ?
       GROUP BY substr(occurred_at, 1, 10) ORDER BY date`,
    )
      .bind(projectId(c), eventName, from, to)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT DISTINCT property.key AS property
       FROM analytics_events_hot event, json_each(event.properties_json) property
       WHERE event.project_id = ? AND event.event_name = ?
         AND event.occurred_at >= ? AND event.occurred_at <= ?
       ORDER BY property.key LIMIT 100`,
    )
      .bind(projectId(c), eventName, from, to)
      .all<{ property: string }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS events,
              COUNT(DISTINCT COALESCE(user_id_hash, anonymous_id_hash,
                                      app_instance_id_hash)) AS users,
              SUM(CASE WHEN json_type(properties_json, '$.sum')
                            IN ('integer', 'real')
                       THEN json_extract(properties_json, '$.sum') ELSE 0 END) AS sum,
              AVG(CASE WHEN json_type(properties_json, '$.duration_seconds')
                            IN ('integer', 'real')
                       THEN json_extract(properties_json, '$.duration_seconds') END) AS average_duration_seconds
       FROM analytics_events_hot
       WHERE project_id = ? AND event_name = ?
         AND occurred_at >= ? AND occurred_at <= ?`,
    )
      .bind(projectId(c), eventName, from, to)
      .first<Record<string, unknown>>(),
  ]);
  let segments: Record<string, unknown>[] = [];
  if (property) {
    const jsonPath = `$.${property}`;
    segments = (
      await c.env.DB.prepare(
        `SELECT CAST(json_extract(properties_json, ?) AS TEXT) AS value,
                COUNT(*) AS events,
                COUNT(DISTINCT COALESCE(user_id_hash, anonymous_id_hash,
                                        app_instance_id_hash)) AS users
         FROM analytics_events_hot
         WHERE project_id = ? AND event_name = ?
           AND occurred_at >= ? AND occurred_at <= ?
           AND json_extract(properties_json, ?) IS NOT NULL
         GROUP BY CAST(json_extract(properties_json, ?) AS TEXT)
         ORDER BY events DESC, value LIMIT 100`,
      )
        .bind(jsonPath, projectId(c), eventName, from, to, jsonPath, jsonPath)
        .all<Record<string, unknown>>()
    ).results;
  }
  return {
    event_name: eventName,
    from,
    to,
    totals: totals ?? {
      events: 0,
      users: 0,
      sum: 0,
      average_duration_seconds: null,
    },
    series: series.results,
    properties: properties.results.map((item) => item.property),
    segmentation: property ? { property, items: segments } : null,
  };
}

export async function listCrashGroups(c: AnalyticsContext) {
  const resolved = c.req.query("resolved");
  const rows = await c.env.DB.prepare(
    `SELECT project_id, application_id, fingerprint, title, fatal, resolved,
            occurrence_count, affected_profiles, first_seen_at, last_seen_at,
            last_app_version, last_platform, assignee, notes, updated_at
     FROM analytics_crash_groups
     WHERE project_id = ? AND (? IS NULL OR resolved = ?)
     ORDER BY resolved, last_seen_at DESC LIMIT ?`,
  )
    .bind(
      projectId(c),
      resolved == null ? null : Number(resolved === "true"),
      resolved == null ? null : Number(resolved === "true"),
      positiveLimit(c.req.query("limit"), 100),
    )
    .all<Record<string, unknown>>();
  return {
    items: rows.results.map((row) => ({
      ...row,
      fatal: Number(row.fatal) === 1,
      resolved: Number(row.resolved) === 1,
    })),
  };
}

export async function getCrashGroup(c: AnalyticsContext, fingerprint: string) {
  const group = await crashGroupRow(c, fingerprint);
  const occurrences = await c.env.DB.prepare(
    `SELECT id, application_id, fingerprint, source_event_id, profile_id,
            message, stack, app_version, platform, occurred_at
     FROM analytics_crash_occurrences
     WHERE project_id = ? AND fingerprint = ?
     ORDER BY occurred_at DESC, id DESC LIMIT 100`,
  )
    .bind(projectId(c), fingerprint)
    .all<Record<string, unknown>>();
  return {
    ...group,
    fatal: Number(group.fatal) === 1,
    resolved: Number(group.resolved) === 1,
    occurrences: occurrences.results,
  };
}

export async function updateCrashGroup(
  c: AnalyticsContext,
  fingerprint: string,
): Promise<MutationResult> {
  const current = await crashGroupRow(c, fingerprint);
  const body = objectBody(await readJson(c.req.raw));
  const resolved =
    body.resolved === undefined
      ? Number(current.resolved) === 1
      : body.resolved === true;
  const assignee =
    body.assignee === undefined
      ? nullableString(current.assignee)
      : optionalText(body.assignee, 255);
  const notes =
    body.notes === undefined
      ? nullableString(current.notes)
      : optionalText(body.notes, 4_000);
  const now = new Date().toISOString();
  const data = { fingerprint, resolved, assignee, notes, updated_at: now };
  return mutation(c, {
    action: "analytics.crash_group.updated",
    entityType: "crash_group",
    entityId: fingerprint,
    body,
    data,
    statements: [
      c.env.DB.prepare(
        `UPDATE analytics_crash_groups SET resolved = ?, assignee = ?, notes = ?, updated_at = ?
       WHERE project_id = ? AND fingerprint = ?`,
      ).bind(resolved ? 1 : 0, assignee, notes, now, projectId(c), fingerprint),
    ],
  });
}

export async function listFeedback(c: AnalyticsContext) {
  const rows = await c.env.DB.prepare(
    `SELECT id, application_id, source_event_id, profile_id, rating, comment,
            widget_id, occurred_at
     FROM analytics_feedback_facts WHERE project_id = ?
     ORDER BY occurred_at DESC, id DESC LIMIT ?`,
  )
    .bind(projectId(c), positiveLimit(c.req.query("limit"), 100))
    .all<Record<string, unknown>>();
  const summary = await c.env.DB.prepare(
    `SELECT COUNT(*) AS responses, ROUND(AVG(rating), 2) AS average_rating,
            SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) AS positive,
            SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) AS negative
     FROM analytics_feedback_facts WHERE project_id = ?`,
  )
    .bind(projectId(c))
    .first<Record<string, unknown>>();
  return {
    items: rows.results,
    summary: summary ?? {
      responses: 0,
      average_rating: null,
      positive: 0,
      negative: 0,
    },
  };
}

export async function listRemoteConfig(c: AnalyticsContext) {
  const rows = await c.env.DB.prepare(
    `SELECT id, config_key, environment, value_json, conditions_json, enabled,
            version, created_by, created_at, updated_at
     FROM analytics_remote_config WHERE project_id = ?
     ORDER BY config_key, environment`,
  )
    .bind(projectId(c))
    .all<Record<string, unknown>>();
  return { items: rows.results.map(serializeRemoteConfig) };
}

export async function upsertRemoteConfig(
  c: AnalyticsContext,
  key: string,
): Promise<MutationResult> {
  const body = objectBody(await readJson(c.req.raw));
  const configKey = identifier(key, "config_key");
  const environment = choice(
    body.environment ?? c.get("project").environment,
    "environment",
    ["production", "test"] as const,
  );
  const value = jsonValue(body.value, "value");
  const conditions =
    body.conditions === undefined
      ? []
      : jsonArray(body.conditions, "conditions");
  validateRemoteConfigConditions(conditions);
  const enabled = body.enabled !== false;
  const existing = await c.env.DB.prepare(
    `SELECT id, version, created_by, created_at FROM analytics_remote_config
     WHERE project_id = ? AND environment = ? AND config_key = ?`,
  )
    .bind(projectId(c), environment, configKey)
    .first<Record<string, unknown>>();
  const id = existing ? String(existing.id) : crypto.randomUUID();
  const version = Number(existing?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const data = {
    id,
    config_key: configKey,
    environment,
    value,
    conditions,
    enabled,
    version,
    updated_at: now,
  };
  return mutation(c, {
    action: existing
      ? "analytics.remote_config.updated"
      : "analytics.remote_config.created",
    entityType: "remote_config",
    entityId: id,
    body,
    data,
    status: existing ? 200 : 201,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO analytics_remote_config
        (id, project_id, config_key, environment, value_json, conditions_json,
         enabled, version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, environment, config_key) DO UPDATE SET
         value_json = excluded.value_json,
         conditions_json = excluded.conditions_json,
         enabled = excluded.enabled,
         version = analytics_remote_config.version + 1,
         updated_at = excluded.updated_at`,
      ).bind(
        id,
        projectId(c),
        configKey,
        environment,
        stableAnalyticsJson(value),
        stableAnalyticsJson(conditions),
        enabled ? 1 : 0,
        version,
        actorId(c),
        now,
        now,
      ),
    ],
  });
}

export async function deleteRemoteConfig(
  c: AnalyticsContext,
  key: string,
): Promise<MutationResult> {
  const environment = choice(
    c.req.query("environment") ?? c.get("project").environment,
    "environment",
    ["production", "test"] as const,
  );
  const row = await c.env.DB.prepare(
    "SELECT id FROM analytics_remote_config WHERE project_id = ? AND environment = ? AND config_key = ?",
  )
    .bind(projectId(c), environment, key)
    .first<{ id: string }>();
  if (!row)
    throw httpError(
      "analytics_remote_config_not_found",
      "Remote config key not found",
      404,
    );
  return deleteMutation(
    c,
    "remote_config",
    "analytics.remote_config.deleted",
    row.id,
    c.env.DB.prepare(
      "DELETE FROM analytics_remote_config WHERE project_id = ? AND environment = ? AND config_key = ?",
    ).bind(projectId(c), environment, key),
  );
}

export async function resolveRemoteConfig(c: AnalyticsContext) {
  const body = objectBody(await readJson(c.req.raw));
  const environment = c.get("project").environment;
  const context =
    body.context === undefined ? {} : jsonObject(body.context, "context");
  const identity =
    optionalText(
      body.app_instance_id ?? body.user_id ?? body.anonymous_id,
      255,
    ) ?? "anonymous";
  const rows = await c.env.DB.prepare(
    `SELECT config_key, value_json, conditions_json, version
     FROM analytics_remote_config
     WHERE project_id = ? AND environment = ? AND enabled = 1
     ORDER BY config_key`,
  )
    .bind(projectId(c), environment)
    .all<Record<string, unknown>>();
  const values: Record<string, unknown> = {};
  const versions: Record<string, number> = {};
  for (const row of rows.results) {
    const key = String(row.config_key);
    const conditions = parseJson<unknown[]>(row.conditions_json, []);
    if (
      await matchesConditions(projectId(c), key, identity, context, conditions)
    ) {
      values[key] = parseJson(row.value_json, null);
      versions[key] = Number(row.version);
    }
  }
  return {
    values,
    versions,
    environment,
    evaluated_at: new Date().toISOString(),
  };
}

export async function listCohorts(c: AnalyticsContext) {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, description, definition_json, estimated_size,
            last_evaluated_at, enabled, created_by, created_at, updated_at
     FROM analytics_cohorts WHERE project_id = ? ORDER BY updated_at DESC`,
  )
    .bind(projectId(c))
    .all<Record<string, unknown>>();
  return {
    items: rows.results.map((row) => ({
      ...row,
      definition: parseJson(row.definition_json, {}),
      definition_json: undefined,
      enabled: Number(row.enabled) === 1,
    })),
  };
}

export async function saveCohort(
  c: AnalyticsContext,
  id?: string,
): Promise<MutationResult> {
  const body = objectBody(await readJson(c.req.raw));
  const current = id ? await cohortRow(c, id) : null;
  const cohortId = id ?? crypto.randomUUID();
  const name =
    optionalText(body.name, 120) ??
    (current ? String(current.name) : requiredText(body.name, "name", 120));
  const description =
    body.description === undefined
      ? nullableString(current?.description)
      : optionalText(body.description, 1_000);
  const definition =
    body.definition === undefined
      ? parseJson(current?.definition_json, {})
      : jsonObject(body.definition, "definition");
  validateCohortDefinition(definition);
  const enabled =
    body.enabled === undefined
      ? Number(current?.enabled ?? 1) === 1
      : body.enabled === true;
  const now = new Date().toISOString();
  const data = {
    id: cohortId,
    name,
    description,
    definition,
    estimated_size: Number(current?.estimated_size ?? 0),
    enabled,
    updated_at: now,
  };
  return mutation(c, {
    action: current ? "analytics.cohort.updated" : "analytics.cohort.created",
    entityType: "cohort",
    entityId: cohortId,
    body,
    data,
    status: current ? 200 : 201,
    statements: current
      ? [
          c.env.DB.prepare(
            `UPDATE analytics_cohorts SET name = ?, description = ?, definition_json = ?, enabled = ?, updated_at = ?
           WHERE project_id = ? AND id = ?`,
          ).bind(
            name,
            description,
            stableAnalyticsJson(definition),
            enabled ? 1 : 0,
            now,
            projectId(c),
            cohortId,
          ),
        ]
      : [
          c.env.DB.prepare(
            `INSERT INTO analytics_cohorts
            (id, project_id, name, description, definition_json, enabled,
             created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            cohortId,
            projectId(c),
            name,
            description,
            stableAnalyticsJson(definition),
            enabled ? 1 : 0,
            actorId(c),
            now,
            now,
          ),
        ],
  });
}

export async function evaluateCohort(
  c: AnalyticsContext,
  id: string,
): Promise<MutationResult> {
  const current = await cohortRow(c, id);
  const definition = parseJson<Record<string, unknown>>(
    current.definition_json,
    {},
  );
  validateCohortDefinition(definition);
  const eventName = String(definition.event_name);
  const days = boundedInteger(definition.days, 30, 1, 366);
  const result = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT COALESCE(user_id_hash, anonymous_id_hash, app_instance_id_hash)) AS total
     FROM analytics_events_hot
     WHERE project_id = ? AND event_name = ? AND occurred_at >= datetime('now', ?)`,
  )
    .bind(projectId(c), eventName, `-${days} days`)
    .first<{ total: number }>();
  const estimatedSize = Number(result?.total ?? 0);
  const now = new Date().toISOString();
  return mutation(c, {
    action: "analytics.cohort.evaluated",
    entityType: "cohort",
    entityId: id,
    body: {},
    data: { id, estimated_size: estimatedSize, last_evaluated_at: now },
    statements: [
      c.env.DB.prepare(
        `UPDATE analytics_cohorts SET estimated_size = ?, last_evaluated_at = ?, updated_at = ?
       WHERE project_id = ? AND id = ?`,
      ).bind(estimatedSize, now, now, projectId(c), id),
    ],
  });
}

export async function deleteCohort(
  c: AnalyticsContext,
  id: string,
): Promise<MutationResult> {
  await cohortRow(c, id);
  return deleteMutation(
    c,
    "cohort",
    "analytics.cohort.deleted",
    id,
    c.env.DB.prepare(
      "DELETE FROM analytics_cohorts WHERE project_id = ? AND id = ?",
    ).bind(projectId(c), id),
  );
}

export async function listAlerts(c: AnalyticsContext) {
  const [alerts, incidents] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, alert_type, definition_json, channels_json, enabled,
              cooldown_minutes, last_evaluated_at, last_triggered_at,
              created_by, created_at, updated_at
       FROM analytics_alerts WHERE project_id = ? ORDER BY updated_at DESC`,
    )
      .bind(projectId(c))
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT id, alert_id, status, summary, value_json, notification_status,
              notifications_json, triggered_at, acknowledged_at, resolved_at
       FROM analytics_alert_incidents WHERE project_id = ?
       ORDER BY triggered_at DESC LIMIT 100`,
    )
      .bind(projectId(c))
      .all<Record<string, unknown>>(),
  ]);
  return {
    items: alerts.results.map(serializeAlert),
    incidents: incidents.results.map((row) => ({
      ...row,
      value: parseJson(row.value_json, {}),
      notifications: parseJson(row.notifications_json, []),
      value_json: undefined,
      notifications_json: undefined,
    })),
  };
}

const ALERT_TYPES = [
  "metric_threshold",
  "crash_spike",
  "no_data",
  "purchase_drop",
  "installation_drop",
  "custom",
] as const;

export async function saveAlert(
  c: AnalyticsContext,
  id?: string,
): Promise<MutationResult> {
  const body = objectBody(await readJson(c.req.raw));
  const current = id ? await alertRow(c, id) : null;
  const alertId = id ?? crypto.randomUUID();
  const name =
    optionalText(body.name, 120) ??
    (current ? String(current.name) : requiredText(body.name, "name", 120));
  const alertType = choice(
    body.alert_type ?? current?.alert_type,
    "alert_type",
    ALERT_TYPES,
  );
  const definition =
    body.definition === undefined
      ? parseJson(current?.definition_json, {})
      : jsonObject(body.definition, "definition");
  const channels =
    body.channels === undefined
      ? parseJson<unknown[]>(current?.channels_json, [])
      : jsonArray(body.channels, "channels");
  validateAlertConfiguration(alertType, definition, channels);
  const enabled =
    body.enabled === undefined
      ? Number(current?.enabled ?? 1) === 1
      : body.enabled === true;
  const cooldown = boundedInteger(
    body.cooldown_minutes ?? current?.cooldown_minutes,
    60,
    1,
    10_080,
  );
  const now = new Date().toISOString();
  const data = {
    id: alertId,
    name,
    alert_type: alertType,
    definition,
    channels,
    enabled,
    cooldown_minutes: cooldown,
    updated_at: now,
  };
  return mutation(c, {
    action: current ? "analytics.alert.updated" : "analytics.alert.created",
    entityType: "alert",
    entityId: alertId,
    body,
    data,
    status: current ? 200 : 201,
    statements: current
      ? [
          c.env.DB.prepare(
            `UPDATE analytics_alerts SET name = ?, alert_type = ?, definition_json = ?, channels_json = ?,
                  enabled = ?, cooldown_minutes = ?, updated_at = ? WHERE project_id = ? AND id = ?`,
          ).bind(
            name,
            alertType,
            stableAnalyticsJson(definition),
            stableAnalyticsJson(channels),
            enabled ? 1 : 0,
            cooldown,
            now,
            projectId(c),
            alertId,
          ),
        ]
      : [
          c.env.DB.prepare(
            `INSERT INTO analytics_alerts
            (id, project_id, name, alert_type, definition_json, channels_json,
             enabled, cooldown_minutes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            alertId,
            projectId(c),
            name,
            alertType,
            stableAnalyticsJson(definition),
            stableAnalyticsJson(channels),
            enabled ? 1 : 0,
            cooldown,
            actorId(c),
            now,
            now,
          ),
        ],
  });
}

export async function transitionAlertIncident(
  c: AnalyticsContext,
  id: string,
  status: "acknowledged" | "resolved",
): Promise<MutationResult> {
  const row = await c.env.DB.prepare(
    "SELECT id FROM analytics_alert_incidents WHERE project_id = ? AND id = ?",
  )
    .bind(projectId(c), id)
    .first();
  if (!row)
    throw httpError(
      "analytics_incident_not_found",
      "Alert incident not found",
      404,
    );
  const now = new Date().toISOString();
  return mutation(c, {
    action: `analytics.alert_incident.${status}`,
    entityType: "alert_incident",
    entityId: id,
    body: {},
    data: { id, status },
    statements: [
      c.env.DB.prepare(
        `UPDATE analytics_alert_incidents SET status = ?,
         acknowledged_at = CASE WHEN ? = 'acknowledged' THEN ? ELSE acknowledged_at END,
         resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE resolved_at END
       WHERE project_id = ? AND id = ?`,
      ).bind(status, status, now, status, now, projectId(c), id),
    ],
  });
}

export async function deleteAlert(
  c: AnalyticsContext,
  id: string,
): Promise<MutationResult> {
  await alertRow(c, id);
  return deleteMutation(
    c,
    "alert",
    "analytics.alert.deleted",
    id,
    c.env.DB.prepare(
      "DELETE FROM analytics_alerts WHERE project_id = ? AND id = ?",
    ).bind(projectId(c), id),
  );
}

export async function listHooks(c: AnalyticsContext) {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, event_types_json, endpoint_url, enabled, last_delivery_at,
            last_delivery_status, created_by, created_at, updated_at,
            encrypted_secret IS NOT NULL AS secret_configured
     FROM analytics_hooks WHERE project_id = ? ORDER BY updated_at DESC`,
  )
    .bind(projectId(c))
    .all<Record<string, unknown>>();
  return {
    items: rows.results.map((row) => ({
      ...row,
      event_types: parseJson(row.event_types_json, []),
      event_types_json: undefined,
      enabled: Number(row.enabled) === 1,
      secret_configured: Number(row.secret_configured) === 1,
    })),
  };
}

export async function saveHook(
  c: AnalyticsContext,
  id?: string,
): Promise<MutationResult> {
  const body = objectBody(await readJson(c.req.raw));
  const current = id ? await hookRow(c, id) : null;
  const hookId = id ?? crypto.randomUUID();
  const name =
    optionalText(body.name, 120) ??
    (current ? String(current.name) : requiredText(body.name, "name", 120));
  const endpoint =
    optionalText(body.endpoint_url, 2_048) ??
    (current ? String(current.endpoint_url) : "");
  if (!isSafePublicHttpsUrl(endpoint))
    throw httpError(
      "analytics_hook_url_invalid",
      "Hook endpoint must be a public HTTPS URL",
      400,
    );
  const eventTypes =
    body.event_types === undefined
      ? parseJson<unknown[]>(current?.event_types_json, [])
      : jsonArray(body.event_types, "event_types");
  if (
    !eventTypes.length ||
    eventTypes.length > 100 ||
    eventTypes.some(
      (value) =>
        typeof value !== "string" ||
        (value !== "*" &&
          !/^(?:[A-Za-z][A-Za-z0-9._:-]{0,127}|\[CLY\]_[A-Za-z0-9._:-]{1,122})$/u.test(
            value,
          )),
    )
  ) {
    throw httpError(
      "analytics_hook_events_invalid",
      "Hooks require between 1 and 100 valid event types",
      400,
    );
  }
  const enabled =
    body.enabled === undefined
      ? Number(current?.enabled ?? 1) === 1
      : body.enabled === true;
  const secret = optionalText(body.secret, 4_096);
  const encryptedSecret = secret
    ? await encryptAnalyticsConfiguration(
        c.env.ANALYTICS_CONFIG_ENCRYPTION_KEY,
        { secret },
      )
    : nullableString(current?.encrypted_secret);
  const now = new Date().toISOString();
  const data = {
    id: hookId,
    name,
    event_types: eventTypes,
    endpoint_url: endpoint,
    enabled,
    secret_configured: Boolean(encryptedSecret),
    updated_at: now,
  };
  return mutation(c, {
    action: current ? "analytics.hook.updated" : "analytics.hook.created",
    entityType: "hook",
    entityId: hookId,
    body: { ...body, secret: secret ? "[configured]" : undefined },
    data,
    status: current ? 200 : 201,
    statements: current
      ? [
          c.env.DB.prepare(
            `UPDATE analytics_hooks SET name = ?, event_types_json = ?, endpoint_url = ?,
                  encrypted_secret = ?, enabled = ?, updated_at = ? WHERE project_id = ? AND id = ?`,
          ).bind(
            name,
            stableAnalyticsJson(eventTypes),
            endpoint,
            encryptedSecret,
            enabled ? 1 : 0,
            now,
            projectId(c),
            hookId,
          ),
        ]
      : [
          c.env.DB.prepare(
            `INSERT INTO analytics_hooks
            (id, project_id, name, event_types_json, endpoint_url, encrypted_secret,
             enabled, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            hookId,
            projectId(c),
            name,
            stableAnalyticsJson(eventTypes),
            endpoint,
            encryptedSecret,
            enabled ? 1 : 0,
            actorId(c),
            now,
            now,
          ),
        ],
  });
}

export async function deleteHook(
  c: AnalyticsContext,
  id: string,
): Promise<MutationResult> {
  await hookRow(c, id);
  return deleteMutation(
    c,
    "hook",
    "analytics.hook.deleted",
    id,
    c.env.DB.prepare(
      "DELETE FROM analytics_hooks WHERE project_id = ? AND id = ?",
    ).bind(projectId(c), id),
  );
}

export async function listAnnotations(c: AnalyticsContext) {
  const rows = await c.env.DB.prepare(
    `SELECT id, title, description, annotation_at, color, created_by, created_at, updated_at
     FROM analytics_annotations WHERE project_id = ? ORDER BY annotation_at DESC LIMIT 250`,
  )
    .bind(projectId(c))
    .all<Record<string, unknown>>();
  return { items: rows.results };
}

export async function saveAnnotation(
  c: AnalyticsContext,
  id?: string,
): Promise<MutationResult> {
  const body = objectBody(await readJson(c.req.raw));
  const current = id ? await annotationRow(c, id) : null;
  const annotationId = id ?? crypto.randomUUID();
  const title =
    optionalText(body.title, 120) ??
    (current ? String(current.title) : requiredText(body.title, "title", 120));
  const description =
    body.description === undefined
      ? nullableString(current?.description)
      : optionalText(body.description, 1_000);
  const annotationAt =
    body.annotation_at === undefined && current
      ? String(current.annotation_at)
      : iso(String(body.annotation_at ?? ""));
  if (!annotationAt)
    throw httpError(
      "analytics_annotation_time_invalid",
      "annotation_at must be an ISO timestamp",
      400,
    );
  const color =
    optionalText(body.color, 32) ?? String(current?.color ?? "#6366f1");
  if (!/^#[0-9a-f]{6}$/iu.test(color))
    throw httpError(
      "analytics_annotation_color_invalid",
      "Annotation color must be a six-digit hex color",
      400,
    );
  const now = new Date().toISOString();
  const data = {
    id: annotationId,
    title,
    description,
    annotation_at: annotationAt,
    color,
    updated_at: now,
  };
  return mutation(c, {
    action: current
      ? "analytics.annotation.updated"
      : "analytics.annotation.created",
    entityType: "annotation",
    entityId: annotationId,
    body,
    data,
    status: current ? 200 : 201,
    statements: current
      ? [
          c.env.DB.prepare(
            `UPDATE analytics_annotations SET title = ?, description = ?, annotation_at = ?, color = ?, updated_at = ?
           WHERE project_id = ? AND id = ?`,
          ).bind(
            title,
            description,
            annotationAt,
            color,
            now,
            projectId(c),
            annotationId,
          ),
        ]
      : [
          c.env.DB.prepare(
            `INSERT INTO analytics_annotations
            (id, project_id, title, description, annotation_at, color,
             created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            annotationId,
            projectId(c),
            title,
            description,
            annotationAt,
            color,
            actorId(c),
            now,
            now,
          ),
        ],
  });
}

export async function deleteAnnotation(
  c: AnalyticsContext,
  id: string,
): Promise<MutationResult> {
  await annotationRow(c, id);
  return deleteMutation(
    c,
    "annotation",
    "analytics.annotation.deleted",
    id,
    c.env.DB.prepare(
      "DELETE FROM analytics_annotations WHERE project_id = ? AND id = ?",
    ).bind(projectId(c), id),
  );
}

export async function getAnalyticsSettings(c: AnalyticsContext) {
  const row = await c.env.DB.prepare(
    `SELECT hot_retention_days, timezone, data_collection_enabled, updated_at
     FROM analytics_project_settings WHERE project_id = ?`,
  )
    .bind(projectId(c))
    .first<Record<string, unknown>>();
  return row
    ? {
        ...row,
        data_collection_enabled: Number(row.data_collection_enabled) === 1,
      }
    : {
        hot_retention_days: 35,
        timezone: "UTC",
        data_collection_enabled: true,
        updated_at: null,
      };
}

export async function updateAnalyticsSettings(
  c: AnalyticsContext,
): Promise<MutationResult> {
  const body = objectBody(await readJson(c.req.raw));
  const current = await getAnalyticsSettings(c);
  const retention = boundedInteger(
    body.hot_retention_days ?? current.hot_retention_days,
    35,
    1,
    366,
  );
  const timezone = optionalText(body.timezone, 64) ?? String(current.timezone);
  const enabled =
    body.data_collection_enabled === undefined
      ? Boolean(current.data_collection_enabled)
      : body.data_collection_enabled === true;
  const now = new Date().toISOString();
  const data = {
    hot_retention_days: retention,
    timezone,
    data_collection_enabled: enabled,
    updated_at: now,
  };
  return mutation(c, {
    action: "analytics.settings.updated",
    entityType: "settings",
    entityId: projectId(c),
    body,
    data,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO analytics_project_settings
        (project_id, hot_retention_days, timezone, data_collection_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         hot_retention_days = excluded.hot_retention_days,
         timezone = excluded.timezone,
         data_collection_enabled = excluded.data_collection_enabled,
         updated_at = excluded.updated_at`,
      ).bind(projectId(c), retention, timezone, enabled ? 1 : 0, now),
    ],
  });
}

async function dashboardRow(c: AnalyticsContext, id: string) {
  const row = await c.env.DB.prepare(
    `SELECT id, name, description, visibility, layout_json, created_by, created_at, updated_at
     FROM analytics_dashboards WHERE project_id = ? AND id = ?`,
  )
    .bind(projectId(c), id)
    .first<Record<string, unknown>>();
  if (!row)
    throw httpError(
      "analytics_dashboard_not_found",
      "Dashboard not found",
      404,
    );
  return row;
}

async function crashGroupRow(c: AnalyticsContext, fingerprint: string) {
  const row = await c.env.DB.prepare(
    `SELECT * FROM analytics_crash_groups WHERE project_id = ? AND fingerprint = ?
     ORDER BY last_seen_at DESC LIMIT 1`,
  )
    .bind(projectId(c), fingerprint)
    .first<Record<string, unknown>>();
  if (!row)
    throw httpError("analytics_crash_not_found", "Crash group not found", 404);
  return row;
}

async function cohortRow(c: AnalyticsContext, id: string) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM analytics_cohorts WHERE project_id = ? AND id = ?",
  )
    .bind(projectId(c), id)
    .first<Record<string, unknown>>();
  if (!row)
    throw httpError("analytics_cohort_not_found", "Cohort not found", 404);
  return row;
}

async function alertRow(c: AnalyticsContext, id: string) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM analytics_alerts WHERE project_id = ? AND id = ?",
  )
    .bind(projectId(c), id)
    .first<Record<string, unknown>>();
  if (!row)
    throw httpError("analytics_alert_not_found", "Alert not found", 404);
  return row;
}

async function hookRow(c: AnalyticsContext, id: string) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM analytics_hooks WHERE project_id = ? AND id = ?",
  )
    .bind(projectId(c), id)
    .first<Record<string, unknown>>();
  if (!row) throw httpError("analytics_hook_not_found", "Hook not found", 404);
  return row;
}

async function annotationRow(c: AnalyticsContext, id: string) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM analytics_annotations WHERE project_id = ? AND id = ?",
  )
    .bind(projectId(c), id)
    .first<Record<string, unknown>>();
  if (!row)
    throw httpError(
      "analytics_annotation_not_found",
      "Annotation not found",
      404,
    );
  return row;
}

function serializeDashboard(row: Record<string, unknown>) {
  return {
    ...row,
    layout: parseJson(row.layout_json, {}),
    layout_json: undefined,
    widget_count: Number(row.widget_count ?? 0),
  };
}

function serializeWidget(row: Record<string, unknown>) {
  return {
    ...row,
    definition: parseJson(row.definition_json, {}),
    position: parseJson(row.position_json, {}),
    definition_json: undefined,
    position_json: undefined,
  };
}

function serializeRemoteConfig(row: Record<string, unknown>) {
  return {
    ...row,
    value: parseJson(row.value_json, null),
    conditions: parseJson(row.conditions_json, []),
    value_json: undefined,
    conditions_json: undefined,
    enabled: Number(row.enabled) === 1,
    version: Number(row.version),
  };
}

function serializeAlert(row: Record<string, unknown>) {
  return {
    ...row,
    definition: parseJson(row.definition_json, {}),
    channels: parseJson(row.channels_json, []),
    definition_json: undefined,
    channels_json: undefined,
    enabled: Number(row.enabled) === 1,
    cooldown_minutes: Number(row.cooldown_minutes),
  };
}

async function mutation(
  c: AnalyticsContext,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    body: unknown;
    data: unknown;
    statements: D1PreparedStatement[];
    status?: number;
  },
) {
  return commitAnalyticsMutation(c.env.DB, {
    project: c.get("project"),
    idempotencyKey: c.req.header("idempotency-key"),
    method: c.req.method,
    path: c.req.path,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    requestBody: input.body,
    data: input.data,
    statements: input.statements,
    ...(input.status ? { status: input.status } : {}),
  });
}

function deleteMutation(
  c: AnalyticsContext,
  entityType: string,
  action: string,
  id: string,
  statement: D1PreparedStatement,
) {
  return mutation(c, {
    action,
    entityType,
    entityId: id,
    body: {},
    data: { id, deleted: true },
    statements: [statement],
  });
}

async function matchesConditions(
  project: string,
  key: string,
  identity: string,
  context: Record<string, unknown>,
  conditions: unknown[],
) {
  for (const raw of conditions) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const condition = raw as Record<string, unknown>;
    if (condition.rollout_percentage !== undefined) {
      const percentage = boundedInteger(
        condition.rollout_percentage,
        100,
        0,
        100,
      );
      const digest = await sha256Hex(`${project}:${key}:${identity}`);
      const bucket = Number.parseInt(digest.slice(0, 8), 16) % 100;
      if (bucket >= percentage) return false;
      continue;
    }
    const field = String(condition.field ?? "");
    const operator = String(condition.operator ?? "equals");
    const actual = nestedValue(context, field);
    const expected = condition.value;
    if (operator === "equals" && actual !== expected) return false;
    if (operator === "not_equals" && actual === expected) return false;
    if (
      operator === "in" &&
      (!Array.isArray(expected) || !expected.includes(actual))
    )
      return false;
    if (
      operator === "contains" &&
      !String(actual ?? "").includes(String(expected ?? ""))
    )
      return false;
  }
  return true;
}

function nestedValue(value: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === "object" && !Array.isArray(current)
          ? (current as Record<string, unknown>)[part]
          : undefined,
      value,
    );
}

function validateCohortDefinition(value: Record<string, unknown>) {
  identifier(value.event_name, "event_name");
  boundedInteger(value.days, 30, 1, 366);
}

function validateRemoteConfigConditions(conditions: unknown[]) {
  if (conditions.length > 50) {
    throw httpError(
      "analytics_remote_config_conditions_invalid",
      "Remote Config accepts at most 50 conditions",
      400,
    );
  }
  for (const raw of conditions) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw httpError(
        "analytics_remote_config_condition_invalid",
        "Each Remote Config condition must be an object",
        400,
      );
    }
    const condition = raw as Record<string, unknown>;
    if (condition.rollout_percentage !== undefined) {
      boundedInteger(condition.rollout_percentage, 100, 0, 100);
      continue;
    }
    const field = requiredText(condition.field, "conditions.field", 128);
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(field)) {
      throw httpError(
        "analytics_remote_config_condition_invalid",
        "Remote Config condition field is invalid",
        400,
      );
    }
    choice(condition.operator ?? "equals", "conditions.operator", [
      "equals",
      "not_equals",
      "in",
      "contains",
    ] as const);
    if (!("value" in condition)) {
      throw httpError(
        "analytics_remote_config_condition_invalid",
        "Remote Config condition value is required",
        400,
      );
    }
  }
}

function validateAlertConfiguration(
  alertType: (typeof ALERT_TYPES)[number],
  definition: Record<string, unknown>,
  channels: unknown[],
) {
  boundedInteger(definition.window_minutes, 60, 1, 10_080);
  if (alertType === "purchase_drop" || alertType === "installation_drop") {
    boundedInteger(definition.drop_percentage, 50, 0, 100);
  } else if (alertType !== "no_data") {
    boundedInteger(definition.threshold, 1, 0, 1_000_000_000);
    const operator = String(definition.operator ?? "gte");
    if (!["gte", "gt", "lte", "lt", "eq"].includes(operator)) {
      throw httpError(
        "analytics_alert_operator_invalid",
        "Alert operator must be gte, gt, lte, lt or eq",
        400,
      );
    }
    if (alertType === "metric_threshold" || alertType === "custom") {
      identifier(definition.event_name, "event_name");
    }
  }
  if (channels.length > 10) {
    throw httpError(
      "analytics_alert_channels_invalid",
      "An alert can have at most 10 notification channels",
      400,
    );
  }
  const recipients = new Set<string>();
  for (const channel of channels) {
    if (!channel || typeof channel !== "object" || Array.isArray(channel)) {
      throw httpError(
        "analytics_alert_channel_invalid",
        "Each alert channel must be an object",
        400,
      );
    }
    const candidate = channel as Record<string, unknown>;
    if (candidate.type !== "email") {
      throw httpError(
        "analytics_alert_channel_invalid",
        "AWS SES email is the supported alert notification channel",
        400,
      );
    }
    const recipient = requiredText(
      candidate.to,
      "channels.to",
      320,
    ).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)) {
      throw httpError(
        "analytics_alert_recipient_invalid",
        "Alert recipient must be a valid email address",
        400,
      );
    }
    if (recipients.has(recipient)) {
      throw httpError(
        "analytics_alert_recipient_duplicate",
        "Alert recipients must be unique",
        400,
      );
    }
    recipients.add(recipient);
  }
}

function projectId(c: AnalyticsContext) {
  return String(c.get("project").projectId);
}
function actorId(c: AnalyticsContext) {
  return String(c.get("project").actorId);
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw httpError(
      "analytics_body_invalid",
      "Request body must be an object",
      400,
    );
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, maximum: number) {
  const parsed = optionalText(value, maximum);
  if (!parsed)
    throw httpError("analytics_field_invalid", `${field} is required`, 400);
  return parsed;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = String(value).trim();
  if (!parsed || parsed.length > maximum)
    throw httpError(
      "analytics_field_invalid",
      `Text is limited to ${maximum} characters`,
      400,
    );
  return parsed;
}

function identifier(value: unknown, field: string) {
  const parsed = requiredText(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(parsed))
    throw httpError("analytics_identifier_invalid", `${field} is invalid`, 400);
  return parsed;
}

function choice<const T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
): T[number] {
  const parsed = String(value ?? "");
  if (!allowed.includes(parsed))
    throw httpError("analytics_field_invalid", `${field} is invalid`, 400);
  return parsed as T[number];
}

function jsonObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw httpError(
      "analytics_field_invalid",
      `${field} must be an object`,
      400,
    );
  jsonSize(value, field);
  return structuredClone(value as Record<string, unknown>);
}

function jsonArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value))
    throw httpError(
      "analytics_field_invalid",
      `${field} must be an array`,
      400,
    );
  jsonSize(value, field);
  return structuredClone(value);
}

function jsonValue(value: unknown, field: string): unknown {
  if (value === undefined)
    throw httpError("analytics_field_invalid", `${field} is required`, 400);
  jsonSize(value, field);
  return structuredClone(value);
}

function jsonSize(value: unknown, field: string) {
  if (stableAnalyticsJson(value).length > 65_536)
    throw httpError(
      "analytics_field_too_large",
      `${field} is limited to 64 KB`,
      413,
    );
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function iso(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed =
    value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw httpError(
      "analytics_number_invalid",
      `Value must be between ${minimum} and ${maximum}`,
      400,
    );
  return parsed;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}
