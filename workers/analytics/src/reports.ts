import { stableAnalyticsJson } from "@superboard/contracts/analytics";
import type { AnalyticsContext } from "./http";
import { httpError, readJson } from "./http";
import { commitAnalyticsMutation } from "./mutations";

const REPORT_TYPES = [
  "dashboard",
  "funnel",
  "cohort",
  "retention",
  "query",
  "alert",
] as const;
type ReportType = (typeof REPORT_TYPES)[number];

type SavedReportRow = {
  id: string;
  report_type: ReportType;
  name: string;
  description: string | null;
  definition_json: string;
  enabled: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export async function listSavedReports(c: AnalyticsContext) {
  const projectId = String(c.get("project").projectId);
  const type = c.req.query("type");
  if (type && !REPORT_TYPES.includes(type as ReportType)) {
    throw httpError("analytics_report_type_invalid", "Report type is invalid", 400);
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, report_type, name, description, definition_json, enabled,
      created_by, created_at, updated_at
     FROM analytics_saved_reports
     WHERE project_id = ?${type ? " AND report_type = ?" : ""}
     ORDER BY updated_at DESC, id DESC LIMIT 250`,
  )
    .bind(projectId, ...(type ? [type] : []))
    .all<SavedReportRow>();
  return { items: rows.results.map(serializeSavedReport) };
}

export async function getSavedReport(c: AnalyticsContext, id: string) {
  const row = await c.env.DB.prepare(
    `SELECT id, report_type, name, description, definition_json, enabled,
      created_by, created_at, updated_at
     FROM analytics_saved_reports WHERE project_id = ? AND id = ?`,
  )
    .bind(String(c.get("project").projectId), id)
    .first<SavedReportRow>();
  if (!row) throw httpError("analytics_report_not_found", "Report not found", 404);
  return serializeSavedReport(row);
}

export async function createSavedReport(c: AnalyticsContext) {
  const body = reportBody(await readJson(c.req.raw));
  const project = c.get("project");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const data = {
    id,
    report_type: body.reportType,
    name: body.name,
    description: body.description,
    definition: body.definition,
    enabled: body.enabled,
    created_by: String(project.actorId),
    created_at: now,
    updated_at: now,
  };
  return commitAnalyticsMutation(c.env.DB, {
    project,
    idempotencyKey: c.req.header("idempotency-key"),
    method: c.req.method,
    path: c.req.path,
    action: "analytics.report.created",
    entityType: "saved_report",
    entityId: id,
    requestBody: body.raw,
    data,
    status: 201,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO analytics_saved_reports
          (id, project_id, report_type, name, description, definition_json,
           enabled, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        String(project.projectId),
        body.reportType,
        body.name,
        body.description,
        stableAnalyticsJson(body.definition),
        body.enabled ? 1 : 0,
        String(project.actorId),
        now,
        now,
      ),
    ],
  });
}

export async function updateSavedReport(c: AnalyticsContext, id: string) {
  await getSavedReport(c, id);
  const body = reportBody(await readJson(c.req.raw));
  const project = c.get("project");
  const now = new Date().toISOString();
  const data = {
    id,
    report_type: body.reportType,
    name: body.name,
    description: body.description,
    definition: body.definition,
    enabled: body.enabled,
    updated_at: now,
  };
  return commitAnalyticsMutation(c.env.DB, {
    project,
    idempotencyKey: c.req.header("idempotency-key"),
    method: c.req.method,
    path: c.req.path,
    action: "analytics.report.updated",
    entityType: "saved_report",
    entityId: id,
    requestBody: body.raw,
    data,
    statements: [
      c.env.DB.prepare(
        `UPDATE analytics_saved_reports
         SET report_type = ?, name = ?, description = ?, definition_json = ?,
             enabled = ?, updated_at = ?
         WHERE project_id = ? AND id = ?`,
      ).bind(
        body.reportType,
        body.name,
        body.description,
        stableAnalyticsJson(body.definition),
        body.enabled ? 1 : 0,
        now,
        String(project.projectId),
        id,
      ),
    ],
  });
}

export async function deleteSavedReport(c: AnalyticsContext, id: string) {
  await getSavedReport(c, id);
  const project = c.get("project");
  return commitAnalyticsMutation(c.env.DB, {
    project,
    idempotencyKey: c.req.header("idempotency-key"),
    method: c.req.method,
    path: c.req.path,
    action: "analytics.report.deleted",
    entityType: "saved_report",
    entityId: id,
    requestBody: {},
    data: { id, deleted: true },
    statements: [
      c.env.DB.prepare(
        "DELETE FROM analytics_saved_reports WHERE project_id = ? AND id = ?",
      ).bind(String(project.projectId), id),
    ],
  });
}

function reportBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError("analytics_report_invalid", "Report body must be an object", 400);
  }
  const raw = value as Record<string, unknown>;
  const reportType = String(raw.report_type ?? "") as ReportType;
  if (!REPORT_TYPES.includes(reportType)) {
    throw httpError("analytics_report_type_invalid", "Report type is invalid", 400);
  }
  const name = text(raw.name, "name", 120);
  const description =
    raw.description === undefined || raw.description === null || raw.description === ""
      ? null
      : text(raw.description, "description", 1_000);
  const definition = raw.definition;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw httpError(
      "analytics_report_definition_invalid",
      "Report definition must be an object",
      400,
    );
  }
  if (stableAnalyticsJson(definition).length > 65_536) {
    throw httpError(
      "analytics_report_definition_too_large",
      "Report definition is limited to 64 KB",
      413,
    );
  }
  return {
    raw,
    reportType,
    name,
    description,
    definition: definition as Record<string, unknown>,
    enabled: raw.enabled !== false,
  };
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw httpError(
      "analytics_report_invalid",
      `${field} must contain between 1 and ${maximum} characters`,
      400,
    );
  }
  return value.trim();
}

function serializeSavedReport(row: SavedReportRow) {
  return {
    id: row.id,
    report_type: row.report_type,
    name: row.name,
    description: row.description,
    definition: JSON.parse(row.definition_json) as unknown,
    enabled: Number(row.enabled) === 1,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
