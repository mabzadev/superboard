import type { FlowContext, SqlRow } from "../d1/helpers";
import {
  audit,
  isoNow,
  parseJsonObject,
  projectId,
} from "../d1/helpers";
import { failure } from "../http/errors";
import { optionalString } from "../http/validation";
import { decryptFlowValue } from "../services/crypto";
import { flowRuntimeName } from "../runtime/names";

export async function flowOverview(context: FlowContext) {
  const row = await context.env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM flow_workflows WHERE project_id = ? AND status != 'archived') AS workflows,
      (SELECT COUNT(*) FROM flow_workflows WHERE project_id = ? AND status = 'active') AS active_workflows,
      (SELECT COUNT(*) FROM flow_users WHERE project_id = ?) AS users,
      (SELECT COUNT(*) FROM flow_analytics_events WHERE project_id = ?) AS events,
      (SELECT COUNT(*) FROM flow_survey_responses WHERE project_id = ?) AS survey_responses,
      (SELECT COUNT(*) FROM flow_outbox_receipts
       WHERE project_id = ? AND status = 'dead-letter') AS dead_letters`,
  ).bind(
    projectId(context),
    projectId(context),
    projectId(context),
    projectId(context),
    projectId(context),
    projectId(context),
  ).first<Record<string, number>>();
  const recent = await context.env.DB.prepare(
    `SELECT event_id, event_name, workflow_id, block_key, environment_id,
      occurred_at, legacy_event_type
     FROM flow_analytics_events
     WHERE project_id = ?
     ORDER BY occurred_at DESC, event_id DESC LIMIT 25`,
  ).bind(projectId(context)).all<SqlRow>();
  return {
    counters: Object.fromEntries(
      Object.entries(row ?? {}).map(([key, value]) => [key, Number(value || 0)]),
    ),
    recent_activity: recent.results,
  };
}

export async function listUsers(context: FlowContext) {
  const url = new URL(context.req.url);
  const environmentId = url.searchParams.get("environment_id")?.trim() || "";
  const conditions = ["u.project_id = ?"];
  const bindings: unknown[] = [projectId(context)];
  if (environmentId) {
    conditions.push("u.environment_id = ?");
    bindings.push(environmentId);
  }
  const rows = await context.env.DB.prepare(
    `SELECT u.project_id, u.environment_id, u.user_id_hash,
      u.locale, u.country, u.platform, u.first_seen_at, u.last_seen_at,
      (SELECT COUNT(*) FROM flow_user_workflow_states s
       WHERE s.project_id = u.project_id
         AND s.environment_id = u.environment_id AND s.user_id_hash = u.user_id_hash
         AND s.state = 'in-progress') AS workflows_in_progress
     FROM flow_users u WHERE ${conditions.join(" AND ")}
     ORDER BY u.last_seen_at DESC LIMIT 500`,
  ).bind(...bindings).all<SqlRow>();
  return { items: rows.results };
}

export async function getUser(
  context: FlowContext,
  userHash: string,
) {
  const profiles = await context.env.DB.prepare(
    `SELECT project_id, environment_id, user_id_hash,
      external_user_id_ciphertext, properties_ciphertext, locale,
      country, platform, first_seen_at, last_seen_at
     FROM flow_users WHERE project_id = ? AND user_id_hash = ?
     ORDER BY last_seen_at DESC`,
  ).bind(projectId(context), userHash).all<SqlRow>();
  if (!profiles.results.length) throw failure("flow_user_not_found", "User not found", 404);
  const [states, events] = await Promise.all([
    context.env.DB.prepare(
      `SELECT s.*, w.name AS workflow_name, w.identifier AS workflow_identifier
       FROM flow_user_workflow_states s
       JOIN flow_workflows w ON w.id = s.workflow_id
       WHERE s.project_id = ? AND s.user_id_hash = ?
       ORDER BY s.updated_at DESC`,
    ).bind(projectId(context), userHash).all<SqlRow>(),
    context.env.DB.prepare(
      `SELECT event_id, environment_id, event_name, workflow_id, block_id,
        block_key, properties_json, occurred_at, legacy_event_type
       FROM flow_analytics_events
       WHERE project_id = ? AND user_id_hash = ?
       ORDER BY occurred_at DESC LIMIT 250`,
    ).bind(projectId(context), userHash).all<SqlRow>(),
  ]);
  return {
    profiles: await Promise.all(
      profiles.results.map(async (profile) => ({
        project_id: profile.project_id,
        environment_id: profile.environment_id,
        user_id_hash: profile.user_id_hash,
        external_user_id: profile.external_user_id_ciphertext == null
          ? null
          : await decryptFlowValue(
              context.env,
              String(profile.external_user_id_ciphertext),
            ),
        properties: profile.properties_ciphertext == null
          ? {}
          : await decryptFlowValue<Record<string, unknown>>(
              context.env,
              String(profile.properties_ciphertext),
            ),
        locale: profile.locale,
        country: profile.country,
        platform: profile.platform,
        first_seen_at: profile.first_seen_at,
        last_seen_at: profile.last_seen_at,
      })),
    ),
    workflow_states: states.results.map((row) => ({
      ...row,
      active_block_ids: parseStringArray(row.active_block_ids_json),
      active_block_ids_json: undefined,
    })),
    events: events.results.map((row) => ({
      ...row,
      properties: parseJsonObject(row.properties_json),
      properties_json: undefined,
    })),
  };
}

export async function resetUserWorkflow(
  context: FlowContext,
  userHash: string,
  body: Record<string, unknown>,
) {
  const workflowId = optionalString(body.workflow_id, "workflow_id", 192);
  const environmentId = optionalString(body.environment_id, "environment_id", 192);
  const conditions = ["project_id = ?", "user_id_hash = ?"];
  const bindings: unknown[] = [projectId(context), userHash];
  if (workflowId) { conditions.push("workflow_id = ?"); bindings.push(workflowId); }
  if (environmentId) { conditions.push("environment_id = ?"); bindings.push(environmentId); }
  const profileConditions = ["project_id = ?", "user_id_hash = ?"];
  const profileBindings: unknown[] = [projectId(context), userHash];
  if (environmentId) {
    profileConditions.push("environment_id = ?");
    profileBindings.push(environmentId);
  }
  const profiles = await context.env.DB.prepare(
    `SELECT DISTINCT environment_id FROM flow_users
     WHERE ${profileConditions.join(" AND ")}`,
  ).bind(...profileBindings).all<{ environment_id: string }>();
  const project = context.get("project");
  const eventId = crypto.randomUUID();
  const runtimeResults = await Promise.all(
    profiles.results.map(({ environment_id: runtimeEnvironmentId }) =>
      context.env.FLOW_USER_RUNTIME.getByName(
        flowRuntimeName(
          project.projectId,
          runtimeEnvironmentId,
          userHash,
        ),
      ).resetProgress({
        eventId,
        projectId: project.projectId,
        projectRef: project.projectRef,
        environmentId: runtimeEnvironmentId,
        userIdHash: userHash,
        ...(workflowId ? { workflowIds: [workflowId] } : {}),
      }),
    ),
  );
  const result = await context.env.DB.prepare(
    `DELETE FROM flow_user_workflow_states WHERE ${conditions.join(" AND ")}`,
  ).bind(...bindings).run();
  await audit(context, "flows.user.progress-reset", "flow_user", userHash, { workflow_id: workflowId, environment_id: environmentId, states_removed: result.meta.changes });
  return {
    user_id_hash: userHash,
    states_removed: result.meta.changes,
    runtimes_reset: runtimeResults.reduce((sum, item) => sum + item.reset, 0),
  };
}

export async function workflowAnalytics(
  context: FlowContext,
  workflowId: string,
) {
  const { from, to, environmentId } = analyticsFilters(context.req.url);
  const conditions = [
    "project_id = ?", "workflow_id = ?",
    "occurred_at >= ?", "occurred_at <= ?",
  ];
  const bindings: unknown[] = [projectId(context), workflowId, from, to];
  if (environmentId) { conditions.push("environment_id = ?"); bindings.push(environmentId); }
  const [totals, timeline, blocks] = await Promise.all([
    context.env.DB.prepare(
      `SELECT event_name, COUNT(*) AS count, COUNT(DISTINCT user_id_hash) AS users
       FROM flow_analytics_events WHERE ${conditions.join(" AND ")}
       GROUP BY event_name ORDER BY event_name`,
    ).bind(...bindings).all<SqlRow>(),
    context.env.DB.prepare(
      `SELECT substr(occurred_at, 1, 10) AS day, event_name, COUNT(*) AS count
       FROM flow_analytics_events WHERE ${conditions.join(" AND ")}
       GROUP BY day, event_name ORDER BY day`,
    ).bind(...bindings).all<SqlRow>(),
    context.env.DB.prepare(
      `SELECT block_id, block_key, event_name, COUNT(*) AS count,
        COUNT(DISTINCT user_id_hash) AS users
       FROM flow_analytics_events WHERE ${conditions.join(" AND ")}
         AND block_id IS NOT NULL
       GROUP BY block_id, block_key, event_name ORDER BY count DESC`,
    ).bind(...bindings).all<SqlRow>(),
  ]);
  return { from, to, environment_id: environmentId, totals: totals.results, timeline: timeline.results, blocks: blocks.results };
}

export async function surveyAnalytics(
  context: FlowContext,
  surveyId: string,
) {
  const { from, to, environmentId } = analyticsFilters(context.req.url);
  const conditions = [
    "r.project_id = ?", "r.survey_id = ?",
    "r.submitted_at >= ?", "r.submitted_at <= ?",
  ];
  const bindings: unknown[] = [projectId(context), surveyId, from, to];
  if (environmentId) { conditions.push("r.environment_id = ?"); bindings.push(environmentId); }
  const questionTypes = await surveyQuestionTypes(context, surveyId);
  const responses: Array<Record<string, unknown>> = [];
  const statistics = new Map<string, SurveyQuestionAccumulator>();
  let responseCount = 0;
  let cursorSubmittedAt: string | null = null;
  let cursorId: string | null = null;
  for (;;) {
    const pageConditions = [...conditions];
    const pageBindings = [...bindings];
    if (cursorSubmittedAt && cursorId) {
      pageConditions.push("(r.submitted_at < ? OR (r.submitted_at = ? AND r.id < ?))");
      pageBindings.push(cursorSubmittedAt, cursorSubmittedAt, cursorId);
    }
    const page = await context.env.DB.prepare(
      `SELECT r.id, r.event_id, r.environment_id, r.user_id_hash, r.workflow_id,
        r.block_id, r.block_state_id, r.url, r.response_json, r.submitted_at
       FROM flow_survey_responses r WHERE ${pageConditions.join(" AND ")}
       ORDER BY r.submitted_at DESC, r.id DESC LIMIT 1000`,
    ).bind(...pageBindings).all<SqlRow>();
    if (!page.results.length) break;
    for (const row of page.results) {
      const response = {
        id: row.id,
        event_id: row.event_id,
        environment_id: row.environment_id,
        user_id_hash: row.user_id_hash,
        workflow_id: row.workflow_id,
        block_id: row.block_id,
        block_state_id: row.block_state_id,
        url: row.url,
        submitted_at: row.submitted_at,
        response: parseUnknownJson(row.response_json),
      };
      responseCount += 1;
      if (responses.length < 10_000) responses.push(response);
      accumulateSurveyResponse(statistics, questionTypes, response.response);
    }
    const last = page.results.at(-1)!;
    cursorSubmittedAt = String(last.submitted_at);
    cursorId = String(last.id);
    if (page.results.length < 1000) break;
  }
  const shown = await surveyShown(context, surveyId, from, to, environmentId);
  const questionStatistics = Object.fromEntries(
    [...statistics.entries()].map(([questionId, accumulator]) => [
      questionId,
      finalizeSurveyQuestion(accumulator),
    ]),
  );
  const ratingAccumulators = [...statistics.values()].filter(
    (entry) => entry.type === "rating",
  );
  return {
    survey_id: surveyId,
    from,
    to,
    environment_id: environmentId,
    summary: {
      shown,
      responses: responseCount,
      completion: shown ? responseCount / shown : 0,
    },
    numeric: finalizeNumeric(combineNumeric(ratingAccumulators)),
    distributions: combineDistributions(statistics),
    links: combineLinks(statistics, responseCount),
    questions: questionStatistics,
    responses,
    responses_truncated: responseCount > responses.length,
  };
}

export async function exportSurveyCsv(
  context: FlowContext,
  surveyId: string,
) {
  const { from, to, environmentId } = analyticsFilters(context.req.url);
  const id = crypto.randomUUID();
  const key = `v1/exports/project=${projectId(context)}/survey=${encodeURIComponent(surveyId)}/${id}.csv`;
  const header = ["response_id", "event_id", "environment_id", "user_id_hash", "workflow_id", "block_id", "url", "submitted_at", "response_json"];
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let rowCount = 0;
  const producer = (async () => {
    try {
      await writer.write(encoder.encode(`${header.join(",")}\n`));
      let cursorSubmittedAt: string | null = null;
      let cursorId: string | null = null;
      for (;;) {
        const conditions = [
          "project_id = ?",
          "survey_id = ?",
          "submitted_at >= ?",
          "submitted_at <= ?",
        ];
        const bindings: unknown[] = [projectId(context), surveyId, from, to];
        if (environmentId) {
          conditions.push("environment_id = ?");
          bindings.push(environmentId);
        }
        if (cursorSubmittedAt && cursorId) {
          conditions.push("(submitted_at > ? OR (submitted_at = ? AND id > ?))");
          bindings.push(cursorSubmittedAt, cursorSubmittedAt, cursorId);
        }
        const page = await context.env.DB.prepare(
          `SELECT id, event_id, environment_id, user_id_hash, workflow_id,
            block_id, url, submitted_at, response_json
           FROM flow_survey_responses
           WHERE ${conditions.join(" AND ")}
           ORDER BY submitted_at, id LIMIT 1000`,
        ).bind(...bindings).all<SqlRow>();
        if (!page.results.length) break;
        const chunk = page.results.map((item) => [
          item.id,
          item.event_id,
          item.environment_id,
          item.user_id_hash,
          item.workflow_id,
          item.block_id,
          item.url,
          item.submitted_at,
          item.response_json,
        ].map(csv).join(",")).join("\n");
        await writer.write(encoder.encode(`${chunk}\n`));
        rowCount += page.results.length;
        const last = page.results.at(-1)!;
        cursorSubmittedAt = String(last.submitted_at);
        cursorId = String(last.id);
        if (page.results.length < 1000) break;
      }
      await writer.close();
    } catch (error) {
      await writer.abort(error);
      throw error;
    }
  })();
  await Promise.all([
    producer,
    context.env.ARCHIVE.put(key, stream.readable, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
      customMetadata: { projectId: String(projectId(context)), surveyId },
    }),
  ]);
  await context.env.DB.prepare(
    `INSERT INTO flow_exports
      (id, project_id, export_type, status, filters_json,
       r2_key, requested_by, created_at, completed_at)
     VALUES (?, ?, 'survey-csv', 'completed', ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    projectId(context),
    JSON.stringify({ survey_id: surveyId, from, to, environment_id: environmentId }),
    key,
    String(context.get("project").actorId),
    isoNow(),
    isoNow(),
  ).run();
  await audit(context, "flows.survey.exported", "flow_export", id, {
    survey_id: surveyId,
    rows: rowCount,
    r2_key: key,
  });
  return { id, status: "completed", r2_key: key, row_count: rowCount };
}

function analyticsFilters(urlValue: string) {
  const url = new URL(urlValue);
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  return {
    from: validIso(url.searchParams.get("from")) ?? defaultFrom,
    to: validIso(url.searchParams.get("to")) ?? now.toISOString(),
    environmentId: url.searchParams.get("environment_id")?.trim() || null,
  };
}

async function surveyShown(
  context: FlowContext,
  surveyId: string,
  from: string,
  to: string,
  environmentId: string | null,
): Promise<number> {
  const conditions = [
    "project_id = ?", "block_id = ?",
    "event_name = 'block-activated'", "occurred_at >= ?", "occurred_at <= ?",
  ];
  const bindings: unknown[] = [projectId(context), surveyId, from, to];
  if (environmentId) { conditions.push("environment_id = ?"); bindings.push(environmentId); }
  const row = await context.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM flow_analytics_events WHERE ${conditions.join(" AND ")}`,
  ).bind(...bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

type SurveyQuestionAccumulator = {
  type: string;
  responses: number;
  numeric: {
    count: number;
    sum: number;
    sumSquares: number;
    values: Map<number, number>;
  };
  distribution: Map<string, number>;
  clicks: number;
};

async function surveyQuestionTypes(
  context: FlowContext,
  surveyId: string,
): Promise<Map<string, string>> {
  const rows = await context.env.DB.prepare(
    `SELECT graph_json FROM flow_workflow_versions
     WHERE project_id = ? ORDER BY published_at DESC LIMIT 1000`,
  ).bind(projectId(context)).all<{ graph_json: string }>();
  for (const row of rows.results) {
    const graph = parseUnknownJson(row.graph_json);
    if (!graph || typeof graph !== "object" || Array.isArray(graph)) continue;
    const blocks = (graph as Record<string, unknown>).blocks;
    if (!Array.isArray(blocks)) continue;
    const block = blocks.find((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry) &&
      (entry as Record<string, unknown>).id === surveyId &&
      (entry as Record<string, unknown>).type === "survey"
    ) as Record<string, unknown> | undefined;
    if (!block) continue;
    const data = block.data && typeof block.data === "object" && !Array.isArray(block.data)
      ? block.data as Record<string, unknown>
      : {};
    const questions = Array.isArray(block.surveyQuestions)
      ? block.surveyQuestions
      : Array.isArray(data.questions)
        ? data.questions
        : [];
    return new Map(questions.flatMap((question) => {
      if (!question || typeof question !== "object" || Array.isArray(question)) return [];
      const value = question as Record<string, unknown>;
      return typeof value.id === "string" && typeof value.type === "string"
        ? [[value.id, value.type] as const]
        : [];
    }));
  }
  return new Map();
}

function accumulateSurveyResponse(
  statistics: Map<string, SurveyQuestionAccumulator>,
  questionTypes: ReadonlyMap<string, string>,
  payload: unknown,
): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const questions = (payload as Record<string, unknown>).questions;
  if (!Array.isArray(questions)) return;
  for (const question of questions) {
    if (!question || typeof question !== "object" || Array.isArray(question)) continue;
    const value = question as Record<string, unknown>;
    if (typeof value.questionId !== "string") continue;
    const type = questionTypes.get(value.questionId) ?? "unknown";
    const accumulator = statistics.get(value.questionId) ?? {
      type,
      responses: 0,
      numeric: { count: 0, sum: 0, sumSquares: 0, values: new Map() },
      distribution: new Map(),
      clicks: 0,
    };
    accumulator.responses += 1;
    if (type === "rating") {
      const parsed = typeof value.textResponse === "number"
        ? value.textResponse
        : typeof value.textResponse === "string" && value.textResponse.trim()
          ? Number(value.textResponse)
          : Number.NaN;
      if (Number.isFinite(parsed)) {
        accumulator.numeric.count += 1;
        accumulator.numeric.sum += parsed;
        accumulator.numeric.sumSquares += parsed * parsed;
        accumulator.numeric.values.set(
          parsed,
          (accumulator.numeric.values.get(parsed) ?? 0) + 1,
        );
      }
    }
    if ((type === "single-choice" || type === "multiple-choice") && Array.isArray(value.optionIds)) {
      for (const optionId of value.optionIds) {
        const key = String(optionId);
        accumulator.distribution.set(key, (accumulator.distribution.get(key) ?? 0) + 1);
      }
    }
    if (type === "link" && value.clickedLink === true) accumulator.clicks += 1;
    statistics.set(value.questionId, accumulator);
  }
}

function finalizeSurveyQuestion(accumulator: SurveyQuestionAccumulator) {
  return {
    type: accumulator.type,
    responses: accumulator.responses,
    ...(accumulator.type === "rating"
      ? { numeric: finalizeNumeric(accumulator.numeric) }
      : {}),
    ...(accumulator.type === "single-choice" || accumulator.type === "multiple-choice"
      ? { distribution: Object.fromEntries(accumulator.distribution) }
      : {}),
    ...(accumulator.type === "link"
      ? {
          links: {
            clicks: accumulator.clicks,
            conversion: accumulator.responses
              ? accumulator.clicks / accumulator.responses
              : 0,
          },
        }
      : {}),
  };
}

function finalizeNumeric(numeric: SurveyQuestionAccumulator["numeric"]) {
  if (!numeric.count) {
    return { count: 0, average: null, median: null, standard_deviation: null };
  }
  const average = numeric.sum / numeric.count;
  const left = Math.floor((numeric.count - 1) / 2);
  const right = Math.floor(numeric.count / 2);
  let offset = 0;
  let leftValue = 0;
  let rightValue = 0;
  for (const [value, count] of [...numeric.values.entries()].sort((a, b) => a[0] - b[0])) {
    if (left >= offset && left < offset + count) leftValue = value;
    if (right >= offset && right < offset + count) rightValue = value;
    offset += count;
  }
  const variance = Math.max(0, numeric.sumSquares / numeric.count - average ** 2);
  return {
    count: numeric.count,
    average,
    median: (leftValue + rightValue) / 2,
    standard_deviation: Math.sqrt(variance),
  };
}

function combineNumeric(accumulators: SurveyQuestionAccumulator[]) {
  const combined: SurveyQuestionAccumulator["numeric"] = {
    count: 0,
    sum: 0,
    sumSquares: 0,
    values: new Map(),
  };
  for (const accumulator of accumulators) {
    combined.count += accumulator.numeric.count;
    combined.sum += accumulator.numeric.sum;
    combined.sumSquares += accumulator.numeric.sumSquares;
    for (const [value, count] of accumulator.numeric.values) {
      combined.values.set(value, (combined.values.get(value) ?? 0) + count);
    }
  }
  return combined;
}

function combineDistributions(statistics: ReadonlyMap<string, SurveyQuestionAccumulator>) {
  const distribution: Record<string, number> = {};
  const owners = new Map<string, string>();
  for (const [questionId, accumulator] of statistics) {
    for (const [optionId, count] of accumulator.distribution) {
      const previousOwner = owners.get(optionId);
      if (previousOwner && previousOwner !== questionId) {
        const previousCount = distribution[optionId] ?? 0;
        delete distribution[optionId];
        distribution[`${previousOwner}:${optionId}`] = previousCount;
        distribution[`${questionId}:${optionId}`] = count;
      } else {
        owners.set(optionId, questionId);
        distribution[optionId] = count;
      }
    }
  }
  return distribution;
}

function combineLinks(
  statistics: ReadonlyMap<string, SurveyQuestionAccumulator>,
  responseCount: number,
) {
  const clicks = [...statistics.values()].reduce((sum, item) => sum + item.clicks, 0);
  return { clicks, conversion: responseCount ? clicks / responseCount : 0 };
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function parseUnknownJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function validIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function csv(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
