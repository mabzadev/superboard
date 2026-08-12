import { Hono } from "hono";
import {
  AnalyticsContractError,
  parseMarketingSignalV1,
  type MarketingSignalV1,
} from "@superboard/contracts/analytics";
import type { ProjectContext } from "@superboard/contracts/project-context";
import { failure } from "./auth";
import { decryptJson, encryptJson } from "./secrets";
import { sendSmtpMessage } from "./email-service";
import { instrumentHtml, unsubscribeUrl } from "./tracking";
import type {
  Env,
  MarketingQueueJob,
  SmtpPublicConfig,
  SmtpSecretConfig,
} from "./types";
import {
  jsonObject,
  optionalText,
  parseStoredJson,
  positiveInt,
  readJsonObject,
  stringArray,
  text,
} from "./validation";

type JourneyBindings = {
  Bindings: Env;
  Variables: { project: ProjectContext };
};

type JourneyStatus = "draft" | "active" | "paused" | "archived";
type ReentryPolicy = "once" | "after_completion" | "every_event";
type JourneyNodeType =
  | "email"
  | "channel"
  | "delay"
  | "branch"
  | "update_attribute"
  | "exit";

type JourneyCondition = {
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "starts_with"
    | "exists"
    | "in"
    | "greater_than"
    | "greater_or_equal"
    | "less_than"
    | "less_or_equal";
  value?: unknown;
};

type JourneyTrigger = {
  event_name: string;
  conditions: JourneyCondition[];
};

type JourneyNode = {
  id: string;
  type: JourneyNodeType;
  template_id?: string;
  smtp_profile_id?: string;
  connector_id?: string;
  delay_seconds?: number;
  condition?: JourneyCondition;
  attributes?: Record<string, unknown>;
};

type JourneyEdge = {
  from: string;
  to: string;
  outcome: "default" | "true" | "false";
};

type JourneyDefinition = {
  start_node_id: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
};

type JourneyRow = Record<string, unknown> & {
  id: string;
  project_id: number;
  status: JourneyStatus;
  trigger_event_name: string;
  trigger_json: string;
  definition_json: string;
  current_version: number;
  reentry_policy: ReentryPolicy;
  entry_segment_id: string | null;
};

type EnrollmentRow = Record<string, unknown> & {
  id: string;
  project_id: number;
  journey_id: string;
  journey_version: number;
  subscriber_id: string;
  current_node_id: string;
  status: string;
  context_json: string;
  next_run_at: string;
};

type SubscriberRow = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  consent_status: string;
  attributes_json: string;
};

const NODE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const EVENT_NAME = /^(?:\*|[A-Za-z0-9][A-Za-z0-9._:-]{0,254})$/u;
const journeyRoutes = new Hono<JourneyBindings>();

journeyRoutes.get("/journeys", async (c) => {
  const projectId = c.get("project").projectId;
  const rows = await c.env.DB.prepare(
    `SELECT journey.*,
      (SELECT COUNT(*) FROM marketing_journey_enrollments enrollment
       WHERE enrollment.project_id = journey.project_id AND enrollment.journey_id = journey.id) AS enrollments_total,
      (SELECT COUNT(*) FROM marketing_journey_enrollments enrollment
       WHERE enrollment.project_id = journey.project_id AND enrollment.journey_id = journey.id
         AND enrollment.status IN ('active', 'waiting', 'processing')) AS enrollments_active,
      (SELECT COUNT(*) FROM marketing_journey_enrollments enrollment
       WHERE enrollment.project_id = journey.project_id AND enrollment.journey_id = journey.id
         AND enrollment.status = 'completed') AS enrollments_completed
     FROM marketing_journeys journey
     WHERE journey.project_id = ? ORDER BY journey.updated_at DESC, journey.id DESC`,
  )
    .bind(projectId)
    .all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(serializeJourney) });
});

journeyRoutes.get("/journeys/:journeyId", async (c) => {
  const projectId = c.get("project").projectId;
  const row = await getJourney(c.env.DB, projectId, c.req.param("journeyId"));
  const versions = await c.env.DB.prepare(
    `SELECT version, trigger_json, definition_json, published_by, published_at
     FROM marketing_journey_versions WHERE project_id = ? AND journey_id = ?
     ORDER BY version DESC`,
  )
    .bind(projectId, row.id)
    .all<Record<string, unknown>>();
  return c.json({
    data: {
      ...serializeJourney(row),
      versions: versions.results.map((version) => ({
        ...version,
        trigger: parseStoredJson(version.trigger_json, {}),
        definition: parseStoredJson(version.definition_json, {}),
        trigger_json: undefined,
        definition_json: undefined,
      })),
    },
  });
});

journeyRoutes.post("/journeys", async (c) => {
  const project = c.get("project");
  const body = await readJsonObject(c.req.raw);
  const trigger = validateTrigger(body.trigger);
  const definition = validateDefinition(body.definition);
  const id = crypto.randomUUID();
  const entrySegmentId = optionalText(
    body.entry_segment_id,
    "entry_segment_id",
    255,
  );
  if (entrySegmentId)
    await ensureSegment(c.env.DB, project.projectId, entrySegmentId);
  const reentryPolicy = choice(
    body.reentry_policy,
    "reentry_policy",
    ["once", "after_completion", "every_event"] as const,
    "once",
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO marketing_journeys
        (id, project_id, name, description, trigger_event_name, trigger_json,
         definition_json, reentry_policy, entry_segment_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      project.projectId,
      text(body.name, "name", 180),
      optionalText(body.description, "description", 2_000),
      trigger.event_name,
      JSON.stringify(trigger),
      JSON.stringify(definition),
      reentryPolicy,
      entrySegmentId,
      String(project.actorId),
    ),
    c.env.DB.prepare(
      `INSERT INTO marketing_journey_versions
        (project_id, journey_id, version, trigger_json, definition_json, published_by)
       VALUES (?, ?, 1, ?, ?, ?)`,
    ).bind(
      project.projectId,
      id,
      JSON.stringify(trigger),
      JSON.stringify(definition),
      String(project.actorId),
    ),
  ]);
  return c.json(
    {
      data: serializeJourney(await getJourney(c.env.DB, project.projectId, id)),
    },
    201,
  );
});

journeyRoutes.patch("/journeys/:journeyId", async (c) => {
  const project = c.get("project");
  const current = await getJourney(
    c.env.DB,
    project.projectId,
    c.req.param("journeyId"),
  );
  if (current.status === "archived") {
    throw failure(
      "journey_archived",
      "An archived journey cannot be edited",
      409,
    );
  }
  const body = await readJsonObject(c.req.raw);
  const trigger =
    body.trigger === undefined
      ? parseStoredJson<JourneyTrigger>(current.trigger_json, {
          event_name: current.trigger_event_name,
          conditions: [],
        })
      : validateTrigger(body.trigger);
  const definition =
    body.definition === undefined
      ? parseStoredJson<JourneyDefinition>(current.definition_json, {
          start_node_id: "",
          nodes: [],
          edges: [],
        })
      : validateDefinition(body.definition);
  const entrySegmentId =
    body.entry_segment_id === undefined
      ? current.entry_segment_id
      : optionalText(body.entry_segment_id, "entry_segment_id", 255);
  if (entrySegmentId)
    await ensureSegment(c.env.DB, project.projectId, entrySegmentId);
  const reentryPolicy =
    body.reentry_policy === undefined
      ? current.reentry_policy
      : choice(body.reentry_policy, "reentry_policy", [
          "once",
          "after_completion",
          "every_event",
        ] as const);
  const version = Number(current.current_version) + 1;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE marketing_journeys SET name = ?, description = ?, trigger_event_name = ?,
        trigger_json = ?, definition_json = ?, current_version = ?, reentry_policy = ?,
        entry_segment_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE project_id = ? AND id = ?`,
    ).bind(
      body.name === undefined ? current.name : text(body.name, "name", 180),
      body.description === undefined
        ? current.description
        : optionalText(body.description, "description", 2_000),
      trigger.event_name,
      JSON.stringify(trigger),
      JSON.stringify(definition),
      version,
      reentryPolicy,
      entrySegmentId,
      project.projectId,
      current.id,
    ),
    c.env.DB.prepare(
      `INSERT INTO marketing_journey_versions
        (project_id, journey_id, version, trigger_json, definition_json, published_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      project.projectId,
      current.id,
      version,
      JSON.stringify(trigger),
      JSON.stringify(definition),
      String(project.actorId),
    ),
  ]);
  return c.json({
    data: serializeJourney(
      await getJourney(c.env.DB, project.projectId, current.id),
    ),
  });
});

for (const [action, target] of [
  ["activate", "active"],
  ["resume", "active"],
  ["pause", "paused"],
  ["archive", "archived"],
] as const) {
  journeyRoutes.post(`/journeys/:journeyId/${action}`, async (c) => {
    const projectId = c.get("project").projectId;
    const current = await getJourney(
      c.env.DB,
      projectId,
      c.req.param("journeyId"),
    );
    assertJourneyTransition(current.status, target);
    if (target === "active")
      await validateJourneyDependencies(c.env.DB, current);
    const updated = await c.env.DB.prepare(
      `UPDATE marketing_journeys SET status = ?,
        activated_at = CASE WHEN ? = 'active' THEN COALESCE(activated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE activated_at END,
        paused_at = CASE WHEN ? = 'paused' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE paused_at END,
        archived_at = CASE WHEN ? = 'archived' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE archived_at END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE project_id = ? AND id = ? RETURNING *`,
    )
      .bind(target, target, target, target, projectId, current.id)
      .first<Record<string, unknown>>();
    return c.json({ data: serializeJourney(updated!) });
  });
}

journeyRoutes.get("/journeys/:journeyId/enrollments", async (c) => {
  const projectId = c.get("project").projectId;
  await getJourney(c.env.DB, projectId, c.req.param("journeyId"));
  const limit = Math.min(
    positiveInt(c.req.query("limit") || 100, "limit"),
    500,
  );
  const rows = await c.env.DB.prepare(
    `SELECT enrollment.*, subscriber.email, subscriber.name
     FROM marketing_journey_enrollments enrollment
     JOIN subscribers subscriber ON subscriber.id = enrollment.subscriber_id
     WHERE enrollment.project_id = ? AND enrollment.journey_id = ?
     ORDER BY enrollment.enrolled_at DESC, enrollment.id DESC LIMIT ?`,
  )
    .bind(projectId, c.req.param("journeyId"), limit)
    .all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(serializeEnrollment) });
});

journeyRoutes.post("/journeys/:journeyId/enrollments", async (c) => {
  const projectId = c.get("project").projectId;
  const journey = await getJourney(
    c.env.DB,
    projectId,
    c.req.param("journeyId"),
  );
  if (journey.status !== "active") {
    throw failure(
      "journey_not_active",
      "Journey must be active before enrollment",
      409,
    );
  }
  const body = await readJsonObject(c.req.raw);
  const subscriberIds = stringArray(body.subscriber_ids, "subscriber_ids", 500);
  if (!subscriberIds.length) {
    throw failure("subscriber_ids_invalid", "subscriber_ids must not be empty");
  }
  let enrolled = 0;
  for (const subscriberId of subscriberIds) {
    const subscriber = await c.env.DB.prepare(
      `SELECT id FROM subscribers WHERE project_id = ? AND id = ?`,
    )
      .bind(projectId, subscriberId)
      .first<{ id: string }>();
    if (!subscriber) continue;
    const result = await enrollSubscriber(c.env, journey, subscriber.id, null, {
      source: "manual",
      properties: jsonObject(body.context, "context"),
    });
    if (result.enrolled) enrolled += 1;
  }
  return c.json({ data: { requested: subscriberIds.length, enrolled } }, 202);
});

journeyRoutes.get("/journeys/:journeyId/statistics", async (c) => {
  const projectId = c.get("project").projectId;
  await getJourney(c.env.DB, projectId, c.req.param("journeyId"));
  const row = await c.env.DB.prepare(
    `SELECT
      COUNT(*) AS enrollments,
      SUM(CASE WHEN status IN ('active','waiting','processing') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      (SELECT COUNT(*) FROM marketing_journey_step_executions execution
       WHERE execution.project_id = ? AND execution.enrollment_id IN (
         SELECT id FROM marketing_journey_enrollments
         WHERE project_id = ? AND journey_id = ?
       ) AND execution.status = 'completed') AS steps_completed,
      (SELECT COUNT(*) FROM marketing_journey_deliveries delivery
       WHERE delivery.project_id = ? AND delivery.enrollment_id IN (
         SELECT id FROM marketing_journey_enrollments
         WHERE project_id = ? AND journey_id = ?
       ) AND delivery.status = 'sent') AS messages_sent
     FROM marketing_journey_enrollments
     WHERE project_id = ? AND journey_id = ?`,
  )
    .bind(
      projectId,
      projectId,
      c.req.param("journeyId"),
      projectId,
      projectId,
      c.req.param("journeyId"),
      projectId,
      c.req.param("journeyId"),
    )
    .first<Record<string, unknown>>();
  return c.json({ data: row ?? {} });
});

journeyRoutes.post("/signals", async (c) => {
  const project = c.get("project");
  if (project.role.toLowerCase() !== "system") {
    throw failure(
      "signal_role_forbidden",
      "Only Analytics may publish Marketing signals",
      403,
    );
  }
  const signal = validateSignal(await readJsonObject(c.req.raw, 1_048_576));
  const claimed = await c.env.DB.prepare(
    `INSERT INTO marketing_signal_receipts
      (project_id, event_id, event_name, application_id, subject_hash,
       properties_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, event_id) DO NOTHING RETURNING event_id`,
  )
    .bind(
      project.projectId,
      signal.event_id,
      signal.event_name,
      signal.application_id,
      signal.subject_hash,
      JSON.stringify(signal.properties),
      signal.occurred_at,
    )
    .first();
  if (!claimed) {
    return c.json({ data: { duplicate: true, matched_journeys: 0 } });
  }
  const subscriber = signal.subject_hash
    ? await c.env.DB.prepare(
        `SELECT subscriber.* FROM subscriber_identity_aliases identity
         JOIN subscribers subscriber ON subscriber.id = identity.subscriber_id
         WHERE identity.project_id = ? AND identity.identity_hash = ?
           AND identity.identity_kind IN ('user','anonymous','instance')
         LIMIT 1`,
      )
        .bind(project.projectId, signal.subject_hash)
        .first<SubscriberRow>()
    : null;
  if (!subscriber) {
    await completeSignal(
      c.env.DB,
      project.projectId,
      signal.event_id,
      0,
      "unmatched",
    );
    return c.json({ data: { duplicate: false, matched_journeys: 0 } }, 202);
  }
  const journeys = await c.env.DB.prepare(
    `SELECT * FROM marketing_journeys
     WHERE project_id = ? AND status = 'active'
       AND (trigger_event_name = ? OR trigger_event_name = '*')
     ORDER BY id`,
  )
    .bind(project.projectId, signal.event_name)
    .all<JourneyRow>();
  let matched = 0;
  for (const journey of journeys.results) {
    const trigger = parseStoredJson<JourneyTrigger>(journey.trigger_json, {
      event_name: journey.trigger_event_name,
      conditions: [],
    });
    if (
      !trigger.conditions.every((condition) =>
        conditionMatches(signal, condition),
      )
    ) {
      continue;
    }
    if (
      journey.entry_segment_id &&
      !(await segmentContains(
        c.env.DB,
        project.projectId,
        journey.entry_segment_id,
        subscriber.id,
      ))
    ) {
      continue;
    }
    const result = await enrollSubscriber(
      c.env,
      journey,
      subscriber.id,
      signal.event_id,
      { source: "analytics", signal },
    );
    if (result.enrolled) matched += 1;
  }
  await completeSignal(
    c.env.DB,
    project.projectId,
    signal.event_id,
    matched,
    matched ? "matched" : "unmatched",
  );
  return c.json({ data: { duplicate: false, matched_journeys: matched } }, 202);
});

journeyRoutes.get("/signals", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT event_id, event_name, application_id, subject_hash, properties_json,
      occurred_at, status, matched_journeys, received_at, completed_at
     FROM marketing_signal_receipts WHERE project_id = ?
     ORDER BY occurred_at DESC, event_id DESC LIMIT 250`,
  )
    .bind(c.get("project").projectId)
    .all<Record<string, unknown>>();
  return c.json({
    data: rows.results.map((row) => ({
      ...row,
      properties: parseStoredJson(row.properties_json, {}),
      properties_json: undefined,
    })),
  });
});

journeyRoutes.get("/channel-connectors", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, channel, endpoint_url, headers_json, enabled, created_at, updated_at
     FROM marketing_channel_connectors WHERE project_id = ? ORDER BY name`,
  )
    .bind(c.get("project").projectId)
    .all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(serializeConnector) });
});

journeyRoutes.post("/channel-connectors", async (c) => {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  const id = crypto.randomUUID();
  const endpointUrl = connectorUrl(body.endpoint_url, c.env.ENVIRONMENT);
  const secret = optionalText(body.secret, "secret", 4_096);
  const headers = connectorHeaders(body.headers);
  await c.env.DB.prepare(
    `INSERT INTO marketing_channel_connectors
      (id, project_id, name, channel, endpoint_url, encrypted_secret, headers_json, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      projectId,
      text(body.name, "name", 180),
      choice(body.channel, "channel", [
        "webhook",
        "sms",
        "push",
        "whatsapp",
        "slack",
      ] as const),
      endpointUrl,
      secret ? await encryptJson(c.env.SMTP_ENCRYPTION_KEY, { secret }) : null,
      JSON.stringify(headers),
      body.enabled === false ? 0 : 1,
    )
    .run();
  return c.json({ data: await connector(c.env.DB, projectId, id) }, 201);
});

journeyRoutes.patch("/channel-connectors/:connectorId", async (c) => {
  const projectId = c.get("project").projectId;
  const current = await connector(
    c.env.DB,
    projectId,
    c.req.param("connectorId"),
  );
  const body = await readJsonObject(c.req.raw);
  const suppliedSecret = optionalText(body.secret, "secret", 4_096);
  await c.env.DB.prepare(
    `UPDATE marketing_channel_connectors SET name = ?, channel = ?, endpoint_url = ?,
      encrypted_secret = ?, headers_json = ?, enabled = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE project_id = ? AND id = ?`,
  )
    .bind(
      body.name === undefined ? current.name : text(body.name, "name", 180),
      body.channel === undefined
        ? current.channel
        : choice(body.channel, "channel", [
            "webhook",
            "sms",
            "push",
            "whatsapp",
            "slack",
          ] as const),
      body.endpoint_url === undefined
        ? current.endpoint_url
        : connectorUrl(body.endpoint_url, c.env.ENVIRONMENT),
      suppliedSecret
        ? await encryptJson(c.env.SMTP_ENCRYPTION_KEY, {
            secret: suppliedSecret,
          })
        : current.encrypted_secret,
      body.headers === undefined
        ? current.headers_json
        : JSON.stringify(connectorHeaders(body.headers)),
      body.enabled === undefined
        ? current.enabled
        : body.enabled === true
          ? 1
          : 0,
      projectId,
      current.id,
    )
    .run();
  return c.json({
    data: serializeConnector(
      await connector(c.env.DB, projectId, String(current.id)),
    ),
  });
});

journeyRoutes.delete("/channel-connectors/:connectorId", async (c) => {
  const projectId = c.get("project").projectId;
  const result = await c.env.DB.prepare(
    `DELETE FROM marketing_channel_connectors WHERE project_id = ? AND id = ? RETURNING id`,
  )
    .bind(projectId, c.req.param("connectorId"))
    .first();
  if (!result)
    throw failure("connector_not_found", "Channel connector not found", 404);
  return c.json({ data: { deleted: true } });
});

export { journeyRoutes };

export async function dispatchDueJourneyEnrollments(
  env: Env,
  maximum = 100,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT enrollment.id, enrollment.project_id
     FROM marketing_journey_enrollments enrollment
     JOIN marketing_journeys journey
       ON journey.project_id = enrollment.project_id AND journey.id = enrollment.journey_id
     WHERE enrollment.status IN ('active', 'waiting', 'processing')
       AND enrollment.next_run_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       AND journey.status = 'active'
     ORDER BY enrollment.next_run_at, enrollment.id LIMIT ?`,
  )
    .bind(Math.max(1, Math.min(maximum, 250)))
    .all<{ id: string; project_id: number }>();
  for (const row of rows.results) {
    await env.MARKETING_QUEUE.send({
      type: "marketing.journey.advance",
      projectId: row.project_id,
      enrollmentId: row.id,
    } satisfies MarketingQueueJob);
  }
  return rows.results.length;
}

export async function advanceJourneyEnrollment(
  env: Env,
  job: Extract<MarketingQueueJob, { type: "marketing.journey.advance" }>,
): Promise<void> {
  const enrollment = await env.DB.prepare(
    `SELECT * FROM marketing_journey_enrollments
     WHERE project_id = ? AND id = ?`,
  )
    .bind(job.projectId, job.enrollmentId)
    .first<EnrollmentRow>();
  if (
    !enrollment ||
    !["active", "waiting", "processing"].includes(enrollment.status)
  )
    return;
  if (Date.parse(enrollment.next_run_at) > Date.now()) return;
  const journey = await getJourney(
    env.DB,
    job.projectId,
    enrollment.journey_id,
  );
  if (journey.status !== "active") {
    await env.DB.prepare(
      `UPDATE marketing_journey_enrollments SET status = 'waiting', next_run_at = datetime('now', '+1 minute'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    )
      .bind(enrollment.id)
      .run();
    return;
  }
  const version = await env.DB.prepare(
    `SELECT definition_json FROM marketing_journey_versions
     WHERE project_id = ? AND journey_id = ? AND version = ?`,
  )
    .bind(job.projectId, enrollment.journey_id, enrollment.journey_version)
    .first<{ definition_json: string }>();
  if (!version) throw new Error("Journey version is missing");
  const definition = validateDefinition(
    parseStoredJson(version.definition_json, {}),
  );
  const node = definition.nodes.find(
    (candidate) => candidate.id === enrollment.current_node_id,
  );
  if (!node) throw new Error("Journey enrollment points to an unknown node");
  const claimed = await env.DB.prepare(
    `INSERT INTO marketing_journey_step_executions
      (id, project_id, enrollment_id, node_id, node_type)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, enrollment_id, node_id) DO NOTHING RETURNING id`,
  )
    .bind(crypto.randomUUID(), job.projectId, enrollment.id, node.id, node.type)
    .first<{ id: string }>();
  const execution = await env.DB.prepare(
    `SELECT id, status, output_json FROM marketing_journey_step_executions
     WHERE project_id = ? AND enrollment_id = ? AND node_id = ?`,
  )
    .bind(job.projectId, enrollment.id, node.id)
    .first<{ id: string; status: string; output_json: string }>();
  if (!execution)
    throw new Error("Journey execution receipt could not be claimed");
  if (!claimed && execution.status === "completed") {
    await resumeCompletedExecution(env, enrollment, execution.output_json);
    return;
  }
  if (!claimed && execution.status === "processing") return;
  await env.DB.prepare(
    `UPDATE marketing_journey_enrollments SET status = 'processing',
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  )
    .bind(enrollment.id)
    .run();
  try {
    await executeNode(env, journey, enrollment, execution.id, node, definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE marketing_journey_step_executions SET status = 'failed',
         attempt_count = attempt_count + 1, last_error = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).bind(message.slice(0, 2_000), execution.id),
      env.DB.prepare(
        `UPDATE marketing_journey_enrollments SET status = 'active', last_error = ?,
         next_run_at = datetime('now', '+1 minute'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).bind(message.slice(0, 2_000), enrollment.id),
    ]);
    throw error;
  }
}

async function executeNode(
  env: Env,
  journey: JourneyRow,
  enrollment: EnrollmentRow,
  executionId: string,
  node: JourneyNode,
  definition: JourneyDefinition,
) {
  const subscriber = await env.DB.prepare(
    `SELECT id, email, name, status, consent_status, attributes_json
     FROM subscribers WHERE project_id = ? AND id = ?`,
  )
    .bind(enrollment.project_id, enrollment.subscriber_id)
    .first<SubscriberRow>();
  if (!subscriber) {
    await completeEnrollment(
      env.DB,
      enrollment.id,
      "cancelled",
      "subscriber_missing",
    );
    return;
  }
  const context = parseStoredJson<Record<string, unknown>>(
    enrollment.context_json,
    {},
  );
  let outcome: JourneyEdge["outcome"] = "default";
  let nextRunAt = new Date().toISOString();
  let terminal: "completed" | "exited" | null = null;
  let output: Record<string, unknown> = {};

  if (node.type === "delay") {
    nextRunAt = new Date(
      Date.now() + Number(node.delay_seconds) * 1_000,
    ).toISOString();
    output = { delayed_seconds: node.delay_seconds };
  } else if (node.type === "branch") {
    outcome = conditionMatches(
      { subscriber: subscriberContext(subscriber), ...context },
      node.condition!,
    )
      ? "true"
      : "false";
    output = { outcome };
  } else if (node.type === "update_attribute") {
    await env.DB.prepare(
      `UPDATE subscribers SET attributes_json = json_patch(attributes_json, ?),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE project_id = ? AND id = ?`,
    )
      .bind(
        JSON.stringify(node.attributes ?? {}),
        enrollment.project_id,
        subscriber.id,
      )
      .run();
    output = { updated_attributes: Object.keys(node.attributes ?? {}) };
  } else if (node.type === "email") {
    output = await deliverJourneyEmail(
      env,
      journey,
      enrollment,
      executionId,
      subscriber,
      node,
      context,
    );
  } else if (node.type === "channel") {
    output = await deliverJourneyChannel(
      env,
      journey,
      enrollment,
      executionId,
      subscriber,
      node,
      context,
    );
  } else {
    terminal = "completed";
    output = { reason: "exit_node" };
  }

  const next = terminal ? null : edgeDestination(definition, node.id, outcome);
  if (!terminal && !next) terminal = "completed";
  output = { ...output, next_node_id: next, terminal_status: terminal };
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE marketing_journey_step_executions SET status = 'completed', output_json = ?,
       last_error = NULL, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    ).bind(JSON.stringify(output), executionId),
    terminal
      ? env.DB.prepare(
          `UPDATE marketing_journey_enrollments SET status = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        ).bind(terminal, enrollment.id)
      : env.DB.prepare(
          `UPDATE marketing_journey_enrollments SET status = ?, current_node_id = ?, next_run_at = ?,
           last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        ).bind(
          node.type === "delay" ? "waiting" : "active",
          next,
          nextRunAt,
          enrollment.id,
        ),
  ]);
  if (!terminal && node.type !== "delay") {
    await env.MARKETING_QUEUE.send({
      type: "marketing.journey.advance",
      projectId: enrollment.project_id,
      enrollmentId: enrollment.id,
    } satisfies MarketingQueueJob);
  }
}

async function deliverJourneyEmail(
  env: Env,
  journey: JourneyRow,
  enrollment: EnrollmentRow,
  executionId: string,
  subscriber: SubscriberRow,
  node: JourneyNode,
  context: Record<string, unknown>,
) {
  const suppressed =
    subscriber.status !== "enabled" ||
    subscriber.consent_status !== "confirmed" ||
    Boolean(
      await env.DB.prepare(
        `SELECT 1 FROM suppressions WHERE project_id = ? AND email = ? LIMIT 1`,
      )
        .bind(enrollment.project_id, subscriber.email)
        .first(),
    );
  const deliveryId = crypto.randomUUID();
  if (suppressed) {
    await recordJourneyDelivery(env.DB, {
      id: deliveryId,
      projectId: enrollment.project_id,
      enrollmentId: enrollment.id,
      executionId,
      subscriberId: subscriber.id,
      channel: "email",
      recipient: subscriber.email,
      status: "suppressed",
      metadata: { reason: "subscriber_not_eligible" },
    });
    return { delivery_id: deliveryId, status: "suppressed" };
  }
  const template = await env.DB.prepare(
    `SELECT subject, content_html, content_text FROM email_templates
     WHERE project_id = ? AND id = ?`,
  )
    .bind(enrollment.project_id, node.template_id)
    .first<{
      subject: string | null;
      content_html: string | null;
      content_text: string | null;
    }>();
  if (!template) throw new Error("Journey email template is missing");
  const profile = node.smtp_profile_id
    ? await env.DB.prepare(
        `SELECT id, public_config_json, encrypted_config FROM smtp_profiles
         WHERE project_id = ? AND id = ? AND enabled = 1
           AND (? = 0 OR authentication_status = 'verified')`,
      )
        .bind(
          enrollment.project_id,
          node.smtp_profile_id,
          env.ENVIRONMENT === "production" ? 1 : 0,
        )
        .first<{
          id: string;
          public_config_json: string;
          encrypted_config: string;
        }>()
    : await env.DB.prepare(
        `SELECT id, public_config_json, encrypted_config FROM smtp_profiles
         WHERE project_id = ? AND enabled = 1
           AND (? = 0 OR authentication_status = 'verified')
         ORDER BY priority, created_at LIMIT 1`,
      )
        .bind(enrollment.project_id, env.ENVIRONMENT === "production" ? 1 : 0)
        .first<{
          id: string;
          public_config_json: string;
          encrypted_config: string;
        }>();
  if (!profile)
    throw new Error("No production-ready SMTP profile is configured");
  const replacements = {
    email: subscriber.email,
    name: subscriber.name ?? "",
    ...parseStoredJson<Record<string, unknown>>(subscriber.attributes_json, {}),
    ...flattenContext(context),
  };
  const trackingPayload = {
    projectId: enrollment.project_id,
    deliveryId,
    subscriberId: subscriber.id,
    campaignId: journey.id,
  };
  const unsubscribe = await unsubscribeUrl(env, trackingPayload);
  const personalizedHtml = template.content_html
    ? personalize(template.content_html, replacements)
    : null;
  const receipt = await sendSmtpMessage(env, {
    idempotencyKey: `marketing.journey:${enrollment.project_id}:${executionId}:${profile.id}`,
    projectId: enrollment.project_id,
    referenceId: executionId,
    profileId: profile.id,
    publicConfig: parseStoredJson<SmtpPublicConfig>(
      profile.public_config_json,
      {} as SmtpPublicConfig,
    ),
    secret: await decryptJson<SmtpSecretConfig>(
      env.SMTP_ENCRYPTION_KEY,
      profile.encrypted_config,
    ),
    message: {
      to: subscriber.email,
      subject: personalize(
        template.subject ?? String(journey.name),
        replacements,
      ),
      html: personalizedHtml
        ? await instrumentHtml(env, trackingPayload, personalizedHtml)
        : null,
      text: `${personalize(template.content_text ?? "", replacements)}\n\nUnsubscribe: ${unsubscribe}`,
      headers: {
        "X-SuperBoard-Journey": journey.id,
        "X-SuperBoard-Journey-Enrollment": enrollment.id,
        "List-Unsubscribe": `<${unsubscribe}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
  });
  await recordJourneyDelivery(env.DB, {
    id: deliveryId,
    projectId: enrollment.project_id,
    enrollmentId: enrollment.id,
    executionId,
    subscriberId: subscriber.id,
    channel: "email",
    recipient: subscriber.email,
    status: "sent",
    providerMessageId: receipt.messageId,
    metadata: { smtp_profile_id: profile.id, journey_id: journey.id },
  });
  await env.DB.prepare(
    `INSERT OR IGNORE INTO email_events
      (id, project_id, campaign_id, subscriber_id, delivery_id, event_type, metadata_json)
     VALUES (?, ?, ?, ?, ?, 'sent', ?)`,
  )
    .bind(
      `journey-sent:${executionId}`,
      enrollment.project_id,
      journey.id,
      subscriber.id,
      deliveryId,
      JSON.stringify({ journey_id: journey.id, enrollment_id: enrollment.id }),
    )
    .run();
  return {
    delivery_id: deliveryId,
    status: "sent",
    message_id: receipt.messageId,
  };
}

async function deliverJourneyChannel(
  env: Env,
  journey: JourneyRow,
  enrollment: EnrollmentRow,
  executionId: string,
  subscriber: SubscriberRow,
  node: JourneyNode,
  context: Record<string, unknown>,
) {
  const destination = await connector(
    env.DB,
    enrollment.project_id,
    node.connector_id!,
  );
  if (!Number(destination.enabled))
    throw new Error("Journey channel connector is disabled");
  const body = JSON.stringify({
    schema_version: 1,
    idempotency_key: executionId,
    channel: destination.channel,
    journey: { id: journey.id, enrollment_id: enrollment.id, node_id: node.id },
    subscriber: {
      id: subscriber.id,
      email: subscriber.email,
      name: subscriber.name,
      attributes: parseStoredJson(subscriber.attributes_json, {}),
    },
    context,
  });
  const encrypted = destination.encrypted_secret
    ? await decryptJson<{ secret: string }>(
        env.SMTP_ENCRYPTION_KEY,
        String(destination.encrypted_secret),
      )
    : null;
  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": executionId,
    "x-superboard-journey": journey.id,
    ...parseStoredJson<Record<string, string>>(destination.headers_json, {}),
  });
  if (encrypted?.secret) {
    headers.set(
      "x-superboard-signature",
      `sha256=${await hmacHex(encrypted.secret, body)}`,
    );
  }
  const response = await fetch(String(destination.endpoint_url), {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Channel connector returned HTTP ${response.status}`);
  const deliveryId = crypto.randomUUID();
  await recordJourneyDelivery(env.DB, {
    id: deliveryId,
    projectId: enrollment.project_id,
    enrollmentId: enrollment.id,
    executionId,
    subscriberId: subscriber.id,
    channel: String(destination.channel),
    connectorId: String(destination.id),
    recipient: subscriber.email,
    status: "sent",
    providerMessageId: response.headers.get("x-message-id"),
    metadata: { http_status: response.status },
  });
  return {
    delivery_id: deliveryId,
    status: "sent",
    http_status: response.status,
  };
}

async function recordJourneyDelivery(
  db: D1Database,
  value: {
    id: string;
    projectId: number;
    enrollmentId: string;
    executionId: string;
    subscriberId: string;
    channel: string;
    connectorId?: string;
    recipient: string;
    providerMessageId?: string | null;
    status: "sent" | "suppressed" | "failed";
    metadata: Record<string, unknown>;
  },
) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO marketing_journey_deliveries
      (id, project_id, enrollment_id, execution_id, subscriber_id, channel,
       connector_id, recipient, provider_message_id, status, metadata_json, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       CASE WHEN ? = 'sent' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END)`,
    )
    .bind(
      value.id,
      value.projectId,
      value.enrollmentId,
      value.executionId,
      value.subscriberId,
      value.channel,
      value.connectorId ?? null,
      value.recipient,
      value.providerMessageId ?? null,
      value.status,
      JSON.stringify(value.metadata),
      value.status,
    )
    .run();
}

async function enrollSubscriber(
  env: Env,
  journey: JourneyRow,
  subscriberId: string,
  eventId: string | null,
  context: Record<string, unknown>,
) {
  if (journey.reentry_policy === "after_completion") {
    const active = await env.DB.prepare(
      `SELECT 1 FROM marketing_journey_enrollments
       WHERE project_id = ? AND journey_id = ? AND subscriber_id = ?
         AND status IN ('active','waiting','processing') LIMIT 1`,
    )
      .bind(journey.project_id, journey.id, subscriberId)
      .first();
    if (active) return { enrolled: false, reason: "already_active" };
  }
  const definition = parseStoredJson<JourneyDefinition>(
    journey.definition_json,
    {
      start_node_id: "",
      nodes: [],
      edges: [],
    },
  );
  const deduplicationKey =
    journey.reentry_policy === "once"
      ? subscriberId
      : journey.reentry_policy === "every_event"
        ? (eventId ?? `manual:${crypto.randomUUID()}`)
        : `${subscriberId}:${eventId ?? crypto.randomUUID()}`;
  const id = crypto.randomUUID();
  const inserted = await env.DB.prepare(
    `INSERT INTO marketing_journey_enrollments
      (id, project_id, journey_id, journey_version, subscriber_id, entry_event_id,
       deduplication_key, current_node_id, context_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, journey_id, deduplication_key) DO NOTHING RETURNING id`,
  )
    .bind(
      id,
      journey.project_id,
      journey.id,
      journey.current_version,
      subscriberId,
      eventId,
      deduplicationKey,
      definition.start_node_id,
      JSON.stringify(context),
    )
    .first<{ id: string }>();
  if (!inserted) return { enrolled: false, reason: "duplicate" };
  await env.MARKETING_QUEUE.send({
    type: "marketing.journey.advance",
    projectId: journey.project_id,
    enrollmentId: id,
  } satisfies MarketingQueueJob);
  return { enrolled: true, enrollmentId: id };
}

async function resumeCompletedExecution(
  env: Env,
  enrollment: EnrollmentRow,
  outputJson: string,
) {
  const output = parseStoredJson<Record<string, unknown>>(outputJson, {});
  const terminal = output.terminal_status;
  if (terminal === "completed" || terminal === "exited") {
    await completeEnrollment(env.DB, enrollment.id, terminal, null);
    return;
  }
  const next =
    typeof output.next_node_id === "string" ? output.next_node_id : null;
  if (!next) {
    await completeEnrollment(env.DB, enrollment.id, "completed", null);
    return;
  }
  await env.DB.prepare(
    `UPDATE marketing_journey_enrollments SET status = 'active', current_node_id = ?,
     next_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = NULL,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  )
    .bind(next, enrollment.id)
    .run();
  await env.MARKETING_QUEUE.send({
    type: "marketing.journey.advance",
    projectId: enrollment.project_id,
    enrollmentId: enrollment.id,
  } satisfies MarketingQueueJob);
}

async function completeEnrollment(
  db: D1Database,
  enrollmentId: string,
  status: "completed" | "exited" | "cancelled",
  error: string | null,
) {
  await db
    .prepare(
      `UPDATE marketing_journey_enrollments SET status = ?, last_error = ?,
     completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    )
    .bind(status, error, enrollmentId)
    .run();
}

async function completeSignal(
  db: D1Database,
  projectId: number,
  eventId: string,
  matched: number,
  status: "matched" | "unmatched",
) {
  await db
    .prepare(
      `UPDATE marketing_signal_receipts SET status = ?, matched_journeys = ?,
     completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE project_id = ? AND event_id = ?`,
    )
    .bind(status, matched, projectId, eventId)
    .run();
}

function validateSignal(body: Record<string, unknown>): MarketingSignalV1 {
  try {
    const signal = parseMarketingSignalV1(body);
    if (signal.event_name === "*") {
      throw failure("event_name_invalid", "event_name is invalid");
    }
    return signal;
  } catch (error) {
    if (error instanceof AnalyticsContractError) {
      throw failure(error.code, error.message);
    }
    throw error;
  }
}

function validateTrigger(value: unknown): JourneyTrigger {
  const source = jsonObject(value, "trigger", 64_000);
  const eventName = text(source.event_name, "event_name", 255);
  if (!EVENT_NAME.test(eventName)) {
    throw failure("event_name_invalid", "event_name is invalid");
  }
  const rawConditions = source.conditions ?? [];
  if (!Array.isArray(rawConditions) || rawConditions.length > 25) {
    throw failure(
      "trigger_conditions_invalid",
      "trigger conditions are limited to 25",
    );
  }
  return {
    event_name: eventName,
    conditions: rawConditions.map(validateCondition),
  };
}

function validateDefinition(value: unknown): JourneyDefinition {
  const source = jsonObject(value, "definition", 256_000);
  if (
    !Array.isArray(source.nodes) ||
    source.nodes.length < 1 ||
    source.nodes.length > 100
  ) {
    throw failure(
      "journey_nodes_invalid",
      "A journey requires between 1 and 100 nodes",
    );
  }
  if (!Array.isArray(source.edges) || source.edges.length > 200) {
    throw failure("journey_edges_invalid", "Journey edges are limited to 200");
  }
  const nodes = source.nodes.map((raw) => validateNode(raw));
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length)
    throw failure("journey_nodes_invalid", "Node ids must be unique");
  const startNodeId = text(source.start_node_id, "start_node_id", 64);
  if (!ids.has(startNodeId))
    throw failure("journey_start_invalid", "start_node_id is unknown");
  const edges = source.edges.map((raw) => validateEdge(raw, ids));
  for (const node of nodes) {
    const outgoing = edges.filter((edge) => edge.from === node.id);
    if (node.type === "exit" && outgoing.length) {
      throw failure(
        "journey_graph_invalid",
        "Exit nodes cannot have outgoing edges",
      );
    }
    if (node.type === "branch") {
      if (
        outgoing.filter((edge) => edge.outcome === "true").length !== 1 ||
        outgoing.filter((edge) => edge.outcome === "false").length !== 1
      ) {
        throw failure(
          "journey_graph_invalid",
          "Branch nodes require true and false edges",
        );
      }
    } else if (node.type !== "exit" && outgoing.length > 1) {
      throw failure(
        "journey_graph_invalid",
        "Non-branch nodes allow at most one edge",
      );
    }
  }
  assertAcyclic(startNodeId, edges);
  return { start_node_id: startNodeId, nodes, edges };
}

function validateNode(value: unknown): JourneyNode {
  const source = jsonObject(value, "node", 64_000);
  const id = text(source.id, "node.id", 64);
  if (!NODE_ID.test(id)) throw failure("node_id_invalid", "Node id is invalid");
  const type = choice(source.type, "node.type", [
    "email",
    "channel",
    "delay",
    "branch",
    "update_attribute",
    "exit",
  ] as const);
  if (type === "email") {
    return {
      id,
      type,
      template_id: text(source.template_id, "template_id", 255),
      smtp_profile_id:
        optionalText(source.smtp_profile_id, "smtp_profile_id", 255) ??
        undefined,
    };
  }
  if (type === "channel") {
    return {
      id,
      type,
      connector_id: text(source.connector_id, "connector_id", 255),
    };
  }
  if (type === "delay") {
    const delaySeconds = positiveInt(source.delay_seconds, "delay_seconds");
    if (delaySeconds > 31_536_000) {
      throw failure(
        "delay_seconds_invalid",
        "A journey delay is limited to one year",
      );
    }
    return { id, type, delay_seconds: delaySeconds };
  }
  if (type === "branch")
    return { id, type, condition: validateCondition(source.condition) };
  if (type === "update_attribute") {
    return {
      id,
      type,
      attributes: jsonObject(source.attributes, "attributes", 32_000),
    };
  }
  return { id, type };
}

function validateCondition(value: unknown): JourneyCondition {
  const source = jsonObject(value, "condition", 8_000);
  return {
    field: text(source.field, "condition.field", 180),
    operator: choice(source.operator, "condition.operator", [
      "equals",
      "not_equals",
      "contains",
      "starts_with",
      "exists",
      "in",
      "greater_than",
      "greater_or_equal",
      "less_than",
      "less_or_equal",
    ] as const),
    ...(source.value === undefined ? {} : { value: source.value }),
  };
}

function validateEdge(value: unknown, ids: Set<string>): JourneyEdge {
  const source = jsonObject(value, "edge", 4_000);
  const from = text(source.from, "edge.from", 64);
  const to = text(source.to, "edge.to", 64);
  if (!ids.has(from) || !ids.has(to)) {
    throw failure(
      "journey_edge_invalid",
      "Journey edge references an unknown node",
    );
  }
  return {
    from,
    to,
    outcome: choice(
      source.outcome,
      "edge.outcome",
      ["default", "true", "false"] as const,
      "default",
    ),
  };
}

function assertAcyclic(start: string, edges: JourneyEdge[]) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (node: string) => {
    if (visiting.has(node))
      throw failure("journey_cycle_invalid", "Journey cycles are not allowed");
    if (visited.has(node)) return;
    visiting.add(node);
    for (const edge of edges.filter((candidate) => candidate.from === node))
      walk(edge.to);
    visiting.delete(node);
    visited.add(node);
  };
  walk(start);
}

function conditionMatches(value: unknown, condition: JourneyCondition) {
  const actual = condition.field.split(".").reduce<unknown>((current, key) => {
    return current && typeof current === "object"
      ? (current as Record<string, unknown>)[key]
      : undefined;
  }, value);
  const expected = condition.value;
  switch (condition.operator) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "equals":
      return String(actual ?? "") === String(expected ?? "");
    case "not_equals":
      return String(actual ?? "") !== String(expected ?? "");
    case "contains":
      return String(actual ?? "")
        .toLowerCase()
        .includes(String(expected ?? "").toLowerCase());
    case "starts_with":
      return String(actual ?? "")
        .toLowerCase()
        .startsWith(String(expected ?? "").toLowerCase());
    case "in":
      return (
        Array.isArray(expected) &&
        expected.map(String).includes(String(actual ?? ""))
      );
    case "greater_than":
      return Number(actual) > Number(expected);
    case "greater_or_equal":
      return Number(actual) >= Number(expected);
    case "less_than":
      return Number(actual) < Number(expected);
    case "less_or_equal":
      return Number(actual) <= Number(expected);
  }
}

function edgeDestination(
  definition: JourneyDefinition,
  nodeId: string,
  outcome: JourneyEdge["outcome"],
) {
  return (
    definition.edges.find(
      (edge) => edge.from === nodeId && edge.outcome === outcome,
    )?.to ??
    definition.edges.find(
      (edge) => edge.from === nodeId && edge.outcome === "default",
    )?.to ??
    null
  );
}

async function getJourney(
  db: D1Database,
  projectId: number,
  journeyId: string,
) {
  const row = await db
    .prepare(`SELECT * FROM marketing_journeys WHERE project_id = ? AND id = ?`)
    .bind(projectId, journeyId)
    .first<JourneyRow>();
  if (!row) throw failure("journey_not_found", "Journey not found", 404);
  return row;
}

async function connector(
  db: D1Database,
  projectId: number,
  connectorId: string,
) {
  const row = await db
    .prepare(
      `SELECT * FROM marketing_channel_connectors WHERE project_id = ? AND id = ?`,
    )
    .bind(projectId, connectorId)
    .first<Record<string, unknown>>();
  if (!row)
    throw failure("connector_not_found", "Channel connector not found", 404);
  return row;
}

async function ensureSegment(
  db: D1Database,
  projectId: number,
  segmentId: string,
) {
  const row = await db
    .prepare(
      `SELECT 1 FROM subscriber_segments WHERE project_id = ? AND id = ?`,
    )
    .bind(projectId, segmentId)
    .first();
  if (!row) throw failure("segment_not_found", "Entry segment not found", 404);
}

async function segmentContains(
  db: D1Database,
  projectId: number,
  segmentId: string,
  subscriberId: string,
) {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM segment_memberships
       WHERE project_id = ? AND segment_id = ? AND subscriber_id = ?`,
      )
      .bind(projectId, segmentId, subscriberId)
      .first(),
  );
}

async function validateJourneyDependencies(
  db: D1Database,
  journey: JourneyRow,
) {
  const definition = validateDefinition(
    parseStoredJson(journey.definition_json, {}),
  );
  for (const node of definition.nodes) {
    if (node.type === "email") {
      const template = await db
        .prepare(
          `SELECT 1 FROM email_templates WHERE project_id = ? AND id = ?`,
        )
        .bind(journey.project_id, node.template_id)
        .first();
      if (!template)
        throw failure(
          "journey_template_missing",
          `Template ${node.template_id} is missing`,
          409,
        );
    }
    if (node.type === "channel") {
      const destination = await db
        .prepare(
          `SELECT 1 FROM marketing_channel_connectors
         WHERE project_id = ? AND id = ? AND enabled = 1`,
        )
        .bind(journey.project_id, node.connector_id)
        .first();
      if (!destination)
        throw failure(
          "journey_connector_missing",
          `Connector ${node.connector_id} is missing or disabled`,
          409,
        );
    }
  }
}

function assertJourneyTransition(from: JourneyStatus, to: JourneyStatus) {
  const allowed: Record<JourneyStatus, JourneyStatus[]> = {
    draft: ["active", "archived"],
    active: ["paused", "archived"],
    paused: ["active", "archived"],
    archived: [],
  };
  if (!allowed[from].includes(to)) {
    throw failure(
      "journey_transition_invalid",
      `Journey cannot transition from ${from} to ${to}`,
      409,
    );
  }
}

function serializeJourney(row: Record<string, unknown>) {
  return {
    ...row,
    trigger: parseStoredJson(row.trigger_json, {}),
    definition: parseStoredJson(row.definition_json, {}),
    trigger_json: undefined,
    definition_json: undefined,
  };
}

function serializeEnrollment(row: Record<string, unknown>) {
  return {
    ...row,
    context: parseStoredJson(row.context_json, {}),
    context_json: undefined,
  };
}

function serializeConnector(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    endpoint_url: row.endpoint_url,
    headers: parseStoredJson(row.headers_json, {}),
    enabled: Boolean(row.enabled),
    secret_configured: Boolean(row.encrypted_secret),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function connectorUrl(value: unknown, environment: string) {
  let url: URL;
  try {
    url = new URL(text(value, "endpoint_url", 2_048));
  } catch {
    throw failure(
      "endpoint_url_invalid",
      "endpoint_url must be an absolute URL",
    );
  }
  const localTest =
    environment !== "production" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localTest && url.protocol === "http:")) {
    throw failure("endpoint_url_invalid", "Channel connectors require HTTPS");
  }
  if (url.username || url.password) {
    throw failure(
      "endpoint_url_invalid",
      "endpoint_url must not contain credentials",
    );
  }
  return url.toString();
}

function connectorHeaders(value: unknown) {
  const headers = jsonObject(value, "headers", 16_000);
  const output: Record<string, string> = {};
  for (const [name, raw] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(normalized)) {
      throw failure("headers_invalid", "Connector header name is invalid");
    }
    if (
      ["authorization", "cookie", "host", "content-length"].includes(normalized)
    ) {
      throw failure(
        "headers_invalid",
        `${name} must be supplied through the encrypted secret contract`,
      );
    }
    output[normalized] = text(raw, `headers.${name}`, 2_000);
  }
  return output;
}

function subscriberContext(subscriber: SubscriberRow) {
  return {
    id: subscriber.id,
    email: subscriber.email,
    name: subscriber.name,
    status: subscriber.status,
    consent_status: subscriber.consent_status,
    attributes: parseStoredJson(subscriber.attributes_json, {}),
  };
}

function flattenContext(context: Record<string, unknown>) {
  const signal = context.signal;
  if (!signal || typeof signal !== "object" || Array.isArray(signal)) return {};
  const properties = (signal as Record<string, unknown>).properties;
  return properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
    ? (properties as Record<string, unknown>)
    : {};
}

function personalize(content: string, values: Record<string, unknown>) {
  return content.replace(
    /{{\s*([A-Za-z0-9_.-]+)\s*}}/g,
    (_match, key: string) => {
      const value = key
        .split(".")
        .reduce<unknown>(
          (current, part) =>
            current && typeof current === "object"
              ? (current as Record<string, unknown>)[part]
              : undefined,
          values,
        );
      return value == null ? "" : String(value);
    },
  );
}

function choice<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const parsed =
    value == null || value === "" ? fallback : (String(value) as T);
  if (!parsed || !allowed.includes(parsed)) {
    throw failure(
      `${field}_invalid`,
      `${field} must be one of ${allowed.join(", ")}`,
    );
  }
  return parsed;
}

async function hmacHex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
