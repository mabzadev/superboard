import { Hono } from "hono";
import {
  AnalyticsContractError,
  parseAnalyticsEventsV1,
} from "@superboard/contracts/analytics";
import { inspectSqlDatabaseAndSchemaHealth } from "@superboard/contracts/health";
import {
  errorResponse,
  httpError,
  internalAuth,
  json,
  readJson,
  type AnalyticsBindings,
  type AnalyticsVariables,
} from "./http";
import {
  drainAnalyticsOutbox,
  handleAnalyticsQueue,
  ingestAnalyticsEvents,
} from "./ingestion";
import { drainMarketingSignals } from "./marketing-signals";
import {
  AnalyticsOperationsWorkflow,
  createAnalyticsOperation,
  eraseAnalyticsSubject,
  getAnalyticsOperation,
  listAnalyticsOperations,
  resumeQueuedOperations,
} from "./operations";
import { purgeExpiredHotEvents } from "./projections";
import {
  analyticsOverview,
  analyticsQueryFromUrl,
  listAnalyticsEvents,
  listInstallations,
  listPurchaseFacts,
  queryFunnel,
  queryRetention,
} from "./queries";
import {
  createSavedReport,
  deleteSavedReport,
  getSavedReport,
  listSavedReports,
  updateSavedReport,
} from "./reports";
import type { Env } from "./types";

export { AnalyticsOperationsWorkflow };

const app = new Hono<{
  Bindings: AnalyticsBindings;
  Variables: AnalyticsVariables;
}>();

app.get("/internal/v1/health", async (c) => {
  try {
    const schema = await inspectSqlDatabaseAndSchemaHealth(
      c.env.DB,
      c.env.D1_EXPECTED_MIGRATION,
    );
    const current = schema.status === "current";
    return c.json(
      {
        data: {
          service: "analytics",
          version: "v1",
          status: current ? "ok" : "degraded",
          storage: { hot: "d1", archive: "r2", pipeline: "queue" },
          schema,
          metrics: await analyticsHealth(c.env.DB),
          ...(current ? {} : { reason: "database_schema_not_current" }),
        },
      },
      current ? 200 : 503,
      { "cache-control": "no-store" },
    );
  } catch {
    return c.json(
      {
        data: {
          service: "analytics",
          version: "v1",
          status: "degraded",
          storage: { hot: "d1", archive: "r2", pipeline: "queue" },
          reason: "database_health_unavailable",
        },
      },
      503,
      { "cache-control": "no-store" },
    );
  }
});

app.use("/internal/v1/*", internalAuth());

app.get("/internal/v1", (c) =>
  c.json({
    data: {
      service: "analytics",
      version: "v1",
      capabilities: [
        "event-ingestion",
        "installations",
        "verified-purchases",
        "sessions",
        "profiles",
        "funnels",
        "retention",
        "saved-reports",
        "exports",
        "erasure",
      ],
    },
  }),
);

app.post("/internal/v1/events", async (c) => {
  let events;
  try {
    events = parseAnalyticsEventsV1(await readJson(c.req.raw), {
      allowReserved: c.get("project").role === "system",
    });
  } catch (error) {
    if (error instanceof AnalyticsContractError) {
      throw httpError(error.code, error.message, 400);
    }
    throw error;
  }
  const results = await ingestAnalyticsEvents(
    c.env,
    c.get("project"),
    events,
  );
  const rejected = results.some((result) => result.status === "rejected");
  const accepted = results.some((result) => result.status === "accepted");
  return c.json(
    {
      data: {
        accepted: results.filter((result) => result.status === "accepted").length,
        duplicates: results.filter((result) => result.status === "duplicate").length,
        rejected: results.filter((result) => result.status === "rejected").length,
        results,
      },
    },
    rejected ? 207 : accepted ? 202 : 200,
    { "cache-control": "no-store" },
  );
});

app.get("/internal/v1/overview", async (c) =>
  c.json({
    data: await analyticsOverview(
      c.env.DB,
      String(c.get("project").projectId),
      analyticsQueryFromUrl(new URL(c.req.url)),
    ),
  }),
);

app.get("/internal/v1/events", async (c) =>
  c.json({
    data: await listAnalyticsEvents(
      c.env.DB,
      String(c.get("project").projectId),
      new URL(c.req.url),
    ),
  }),
);

app.get("/internal/v1/installations", async (c) =>
  c.json({
    data: await listInstallations(
      c.env.DB,
      String(c.get("project").projectId),
      new URL(c.req.url),
    ),
  }),
);

app.get("/internal/v1/purchases", async (c) =>
  c.json({
    data: await listPurchaseFacts(
      c.env.DB,
      String(c.get("project").projectId),
      new URL(c.req.url),
    ),
  }),
);

app.get("/internal/v1/sessions", async (c) => {
  const query = analyticsQueryFromUrl(new URL(c.req.url));
  const conditions = ["project_id = ?", "started_at >= ?", "started_at <= ?"];
  const bindings: unknown[] = [
    String(c.get("project").projectId),
    query.from,
    query.to,
  ];
  if (query.applicationId) {
    conditions.push("application_id = ?");
    bindings.push(query.applicationId);
  }
  bindings.push(250);
  const rows = await c.env.DB.prepare(
    `SELECT id, application_id, session_id_hash, profile_id, app_instance_id_hash,
      first_event_id, last_event_id, started_at, ended_at, event_count,
      duration_seconds, platform, app_version
     FROM analytics_sessions WHERE ${conditions.join(" AND ")}
     ORDER BY started_at DESC, id DESC LIMIT ?`,
  )
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return c.json({ data: { items: rows.results } });
});

app.get("/internal/v1/profiles", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, application_id, canonical_subject_hash, properties_json,
      first_seen_at, last_seen_at, created_at, updated_at
     FROM analytics_profiles WHERE project_id = ?
     ORDER BY last_seen_at DESC, id DESC LIMIT 250`,
  )
    .bind(String(c.get("project").projectId))
    .all<Record<string, unknown>>();
  return c.json({
    data: {
      items: rows.results.map((row) => ({
        ...row,
        properties: safeObject(row.properties_json),
        properties_json: undefined,
      })),
    },
  });
});

app.get("/internal/v1/event-definitions", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT event_name, event_source, COUNT(*) AS event_count,
      MIN(occurred_at) AS first_seen_at, MAX(occurred_at) AS last_seen_at
     FROM analytics_events_hot WHERE project_id = ?
     GROUP BY event_name, event_source ORDER BY last_seen_at DESC LIMIT 500`,
  )
    .bind(String(c.get("project").projectId))
    .all<Record<string, unknown>>();
  return c.json({ data: { items: rows.results } });
});

app.delete("/internal/v1/application/users/:id", async (c) => {
  if (!["application", "system", "owner", "admin"].includes(c.get("project").role)) {
    throw httpError(
      "analytics_erasure_forbidden",
      "Analytics subject erasure is not permitted for this role",
      403,
    );
  }
  return c.json({
    data: {
      erased: true,
      ...(await eraseAnalyticsSubject(
        c.env,
        String(c.get("project").projectId),
        "user",
        c.req.param("id"),
      )),
    },
  });
});

app.post("/internal/v1/funnels/query", async (c) =>
  c.json({
    data: await queryFunnel(
      c.env.DB,
      String(c.get("project").projectId),
      await readJson(c.req.raw),
    ),
  }),
);

app.get("/internal/v1/retention", async (c) =>
  c.json({
    data: await queryRetention(
      c.env.DB,
      String(c.get("project").projectId),
      new URL(c.req.url),
    ),
  }),
);

app.get("/internal/v1/reports", async (c) =>
  c.json({ data: await listSavedReports(c) }),
);
app.post("/internal/v1/reports", async (c) => mutationResponse(await createSavedReport(c)));
app.get("/internal/v1/reports/:id", async (c) =>
  c.json({ data: await getSavedReport(c, c.req.param("id")) }),
);
app.put("/internal/v1/reports/:id", async (c) =>
  mutationResponse(await updateSavedReport(c, c.req.param("id"))),
);
app.delete("/internal/v1/reports/:id", async (c) =>
  mutationResponse(await deleteSavedReport(c, c.req.param("id"))),
);

app.get("/internal/v1/operations", async (c) =>
  c.json({ data: await listAnalyticsOperations(c) }),
);
app.post("/internal/v1/operations", async (c) =>
  mutationResponse(await createAnalyticsOperation(c)),
);
app.get("/internal/v1/operations/:id", async (c) =>
  c.json({ data: await getAnalyticsOperation(c, c.req.param("id")) }),
);

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "route_not_found",
        message: "Analytics route not found",
        status: 404,
        retryable: false,
        request_id:
          c.get("project")?.requestId ??
          c.req.header("x-request-id") ??
          crypto.randomUUID(),
      },
    },
    404,
  ),
);

app.onError((error, c) => errorResponse(error, c));

export async function analyticsHealth(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM analytics_event_receipts) AS receipts_total,
        (SELECT COUNT(*) FROM analytics_event_receipts WHERE status = 'projected') AS receipts_projected,
        (SELECT COUNT(*) FROM analytics_ingest_outbox WHERE status IN ('pending', 'dispatched', 'processing')) AS outbox_pending,
        (SELECT COUNT(*) FROM analytics_ingest_outbox WHERE status = 'dead_letter') AS outbox_dead_letter,
        (SELECT COUNT(*) FROM analytics_marketing_signal_outbox WHERE status = 'pending') AS marketing_signals_pending,
        (SELECT COUNT(*) FROM analytics_marketing_signal_outbox WHERE status = 'dead_letter') AS marketing_signals_dead_letter,
        (SELECT COUNT(*) FROM analytics_installations) AS installations_total,
        (SELECT COUNT(*) FROM analytics_purchase_facts) AS purchases_total,
        (SELECT COUNT(*) FROM analytics_sessions) AS sessions_total,
        (SELECT COUNT(*) FROM analytics_dead_letters WHERE status = 'quarantined') AS dead_letters_quarantined,
        (SELECT COUNT(*) FROM analytics_operation_jobs WHERE status IN ('queued', 'running')) AS operations_active`,
    )
    .first<Record<string, number | null>>();
  if (!row) throw new Error("Analytics health query returned no row");
  const count = (key: string) => Number(row[key] ?? 0);
  return {
    ingestion: {
      receipts: count("receipts_total"),
      projected: count("receipts_projected"),
      pending: count("outbox_pending"),
      deadLetter: count("outbox_dead_letter"),
    },
    facts: {
      installations: count("installations_total"),
      purchases: count("purchases_total"),
      sessions: count("sessions_total"),
    },
    operations: {
      active: count("operations_active"),
      quarantined: count("dead_letters_quarantined"),
    },
    marketingSignals: {
      pending: count("marketing_signals_pending"),
      deadLetter: count("marketing_signals_dead_letter"),
    },
  };
}

function mutationResponse(result: {
  data: unknown;
  status: number;
  replayed: boolean;
}): Response {
  const response = json({ data: result.data }, result.status);
  if (result.replayed) response.headers.set("idempotency-replayed", "true");
  return response;
}

function safeObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      Promise.all([
        drainAnalyticsOutbox(env),
        drainMarketingSignals(env),
        purgeExpiredHotEvents(env.DB),
        resumeQueuedOperations(env),
        env.DB.prepare(
          `DELETE FROM analytics_idempotency_keys
           WHERE created_at < datetime('now', '-7 days')`,
        ).run(),
        env.DB.prepare(
          `DELETE FROM analytics_ingest_outbox
           WHERE status = 'completed' AND completed_at < datetime('now', '-7 days')`,
        ).run(),
      ]).then(() => undefined),
    );
  },
  async queue(
    batch: MessageBatch<unknown>,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    await handleAnalyticsQueue(batch, env);
  },
};
