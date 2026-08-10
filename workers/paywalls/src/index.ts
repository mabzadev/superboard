import { Hono } from "hono";
import { inspectSqlDatabaseAndSchemaHealth } from "@opengrow/contracts/health";
import {
  parseEvents,
  parseExperience,
  parsePaywall,
  parsePlacement,
  parsePlacementAdmin,
  parseStatistics,
  parseTargeting,
  parseVersion,
} from "./contracts";
import {
  commitMutation,
  errorResponse,
  httpError,
  internalAuth,
  json,
  readJson,
  type WorkerBindings,
  type WorkerContext,
  type WorkerVariables,
} from "./http";

type AppShape = { Bindings: WorkerBindings; Variables: WorkerVariables };
type Row = Record<string, unknown> & { id: string };
type VersionRow = Row & {
  paywall_id: string;
  version: number;
  status: string;
  definition_json: string;
};
type PlacementRow = Row & {
  key: string;
  paywall_id: string;
  active_version_id: string | null;
  experience_id: string | null;
  targeting_json: string;
  priority: number;
  active: number;
};

const app = new Hono<AppShape>();
const auth = internalAuth();
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
          service: "paywalls",
          version: "v1",
          status: current ? "ok" : "degraded",
          storage: "d1",
          schema,
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
          service: "paywalls",
          version: "v1",
          status: "degraded",
          storage: "d1",
          reason: "database_health_unavailable",
        },
      },
      503,
      { "cache-control": "no-store" },
    );
  }
});
app.use("/internal/v1", auth);
app.use("/internal/v1/*", auth);
app.onError((error, c) => errorResponse(error, c));

app.get("/internal/v1", async (c) => c.json({ data: await listPaywalls(c) }));
app.post("/internal/v1", createPaywall);
app.get("/internal/v1/paywalls", async (c) =>
  c.json({ data: await listPaywalls(c) }),
);
app.post("/internal/v1/paywalls", createPaywall);

app.get("/internal/v1/statistics", statistics);
app.post("/internal/v1/resolve", resolvePlacement);
app.post("/internal/v1/placements/resolve", resolvePlacement);
app.post("/internal/v1/events", recordEvents);

app.get("/internal/v1/placements", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.*, w.identifier AS paywall_identifier, w.name AS paywall_name, e.name AS experience_name FROM placements p JOIN paywalls w ON w.id=p.paywall_id AND w.project_id=p.project_id LEFT JOIN experiences e ON e.id=p.experience_id AND e.project_id=p.project_id WHERE p.project_id=? ORDER BY p.key, p.priority DESC`,
  )
    .bind(project(c))
    .all<PlacementRow>();
  return c.json({ data: rows.results.map(placementView) });
});

app.post("/internal/v1/placements", async (c) => {
  const body = await readJson(c.req.raw);
  const input = parsePlacementAdmin(body);
  await validatePlacementRelations(c, input);
  const timestamp = now();
  const row = {
    id: crypto.randomUUID(),
    ...input,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return commitMutation(c, {
    action: "placement.created",
    entityType: "placement",
    entityId: row.id,
    requestBody: body,
    status: 201,
    data: row,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO placements (id,project_id,key,paywall_id,active_version_id,experience_id,targeting_json,priority,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        row.id,
        project(c),
        row.key,
        row.paywall_id,
        row.active_version_id,
        row.experience_id,
        JSON.stringify(row.targeting),
        row.priority,
        flag(row.active),
        timestamp,
        timestamp,
      ),
    ],
  });
});

app.get("/internal/v1/placements/:id", async (c) =>
  c.json({
    data: placementView(
      (await owned(
        c,
        "placements",
        c.req.param("id"),
        "placement",
      )) as PlacementRow,
    ),
  }),
);
app.put("/internal/v1/placements/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "placements", id, "placement");
  const body = await readJson(c.req.raw);
  const input = parsePlacementAdmin(body);
  await validatePlacementRelations(c, input);
  const row = { id, ...input, updated_at: now() };
  return commitMutation(c, {
    action: "placement.updated",
    entityType: "placement",
    entityId: id,
    requestBody: body,
    data: row,
    statements: [
      c.env.DB.prepare(
        `UPDATE placements SET key=?,paywall_id=?,active_version_id=?,experience_id=?,targeting_json=?,priority=?,active=?,updated_at=? WHERE id=? AND project_id=?`,
      ).bind(
        input.key,
        input.paywall_id,
        input.active_version_id,
        input.experience_id,
        JSON.stringify(input.targeting),
        input.priority,
        flag(input.active),
        row.updated_at,
        id,
        project(c),
      ),
    ],
  });
});
app.delete("/internal/v1/placements/:id", async (c) =>
  deactivate(c, "placements", "placement"),
);

app.get("/internal/v1/experiences", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM experiences WHERE project_id=? ORDER BY updated_at DESC",
  )
    .bind(project(c))
    .all<Row>();
  return c.json({ data: await attachVariants(c, rows.results) });
});
app.post("/internal/v1/experiences", async (c) => {
  const body = await readJson(c.req.raw);
  const input = parseExperience(body);
  await validateExperience(
    c,
    input.paywall_id,
    input.variants.map((variant) => variant.version_id),
  );
  const id = crypto.randomUUID();
  const timestamp = now();
  const row = { id, ...input, created_at: timestamp, updated_at: timestamp };
  return commitMutation(c, {
    action: "experience.created",
    entityType: "experience",
    entityId: id,
    requestBody: body,
    status: 201,
    data: row,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO experiences (id,project_id,paywall_id,name,status,traffic_percent,starts_at,ends_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        id,
        project(c),
        input.paywall_id,
        input.name,
        input.status,
        input.traffic_percent,
        input.starts_at,
        input.ends_at,
        timestamp,
        timestamp,
      ),
      ...input.variants.map((variant) =>
        c.env.DB.prepare(
          `INSERT INTO variants (id,project_id,experience_id,version_id,key,weight,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        ).bind(
          variant.id,
          project(c),
          id,
          variant.version_id,
          variant.key,
          variant.weight,
          flag(variant.active),
          timestamp,
          timestamp,
        ),
      ),
    ],
  });
});
app.get("/internal/v1/experiences/:id", async (c) => {
  const row = await owned(c, "experiences", c.req.param("id"), "experience");
  return c.json({ data: (await attachVariants(c, [row]))[0] });
});
app.put("/internal/v1/experiences/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "experiences", id, "experience");
  const body = await readJson(c.req.raw);
  const input = parseExperience(body);
  await validateExperience(
    c,
    input.paywall_id,
    input.variants.map((variant) => variant.version_id),
  );
  const timestamp = now();
  const row = { id, ...input, updated_at: timestamp };
  return commitMutation(c, {
    action: "experience.updated",
    entityType: "experience",
    entityId: id,
    requestBody: body,
    data: row,
    statements: [
      c.env.DB.prepare(
        `UPDATE experiences SET paywall_id=?,name=?,status=?,traffic_percent=?,starts_at=?,ends_at=?,updated_at=? WHERE id=? AND project_id=?`,
      ).bind(
        input.paywall_id,
        input.name,
        input.status,
        input.traffic_percent,
        input.starts_at,
        input.ends_at,
        timestamp,
        id,
        project(c),
      ),
      c.env.DB.prepare(
        "DELETE FROM variants WHERE experience_id=? AND project_id=?",
      ).bind(id, project(c)),
      ...input.variants.map((variant) =>
        c.env.DB.prepare(
          `INSERT INTO variants (id,project_id,experience_id,version_id,key,weight,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        ).bind(
          variant.id,
          project(c),
          id,
          variant.version_id,
          variant.key,
          variant.weight,
          flag(variant.active),
          timestamp,
          timestamp,
        ),
      ),
    ],
  });
});
app.delete("/internal/v1/experiences/:id", async (c) => archiveExperience(c));

app.get("/internal/v1/paywalls/:id/versions", async (c) => {
  const id = c.req.param("id");
  await owned(c, "paywalls", id, "paywall");
  const rows = await c.env.DB.prepare(
    "SELECT id,paywall_id,version,status,definition_json,schema_version,changelog,created_by,published_at,created_at FROM paywall_versions WHERE project_id=? AND paywall_id=? ORDER BY version DESC",
  )
    .bind(project(c), id)
    .all<VersionRow>();
  return c.json({ data: rows.results.map(versionView) });
});

app.post("/internal/v1/paywalls/:id/versions", async (c) => {
  const paywallId = c.req.param("id");
  await owned(c, "paywalls", paywallId, "paywall");
  const body = await readJson(c.req.raw, 2_359_296);
  const input = parseVersion(body);
  const next = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(version),0)+1 AS version FROM paywall_versions WHERE project_id=? AND paywall_id=?",
  )
    .bind(project(c), paywallId)
    .first<{ version: number }>();
  const row = {
    id: crypto.randomUUID(),
    paywall_id: paywallId,
    version: next?.version ?? 1,
    status: "draft",
    definition: input.definition,
    schema_version: 1,
    changelog: input.changelog,
    created_by: c.get("project").actorId,
    published_at: null,
    created_at: now(),
  };
  return commitMutation(c, {
    action: "paywall_version.created",
    entityType: "paywall_version",
    entityId: row.id,
    requestBody: body,
    status: 201,
    data: row,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO paywall_versions (id,paywall_id,version,status,definition_json,created_at,project_id,schema_version,changelog,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        row.id,
        paywallId,
        row.version,
        row.status,
        JSON.stringify(row.definition),
        row.created_at,
        project(c),
        1,
        row.changelog,
        row.created_by,
      ),
    ],
  });
});

app.post("/internal/v1/paywalls/:id/versions/:versionId/publish", async (c) => {
  const paywallId = c.req.param("id");
  const versionId = c.req.param("versionId");
  await owned(c, "paywalls", paywallId, "paywall");
  const version = await c.env.DB.prepare(
    "SELECT * FROM paywall_versions WHERE id=? AND paywall_id=? AND project_id=?",
  )
    .bind(versionId, paywallId, project(c))
    .first<VersionRow>();
  if (!version)
    throw httpError("version_not_found", "Paywall version was not found", 404);
  const body = await readJson(c.req.raw);
  const timestamp = now();
  const data = {
    ...versionView(version),
    status: "published",
    published_at: timestamp,
  };
  return commitMutation(c, {
    action: "paywall_version.published",
    entityType: "paywall_version",
    entityId: versionId,
    requestBody: body,
    data,
    statements: [
      c.env.DB.prepare(
        `UPDATE paywall_versions SET status='published',published_at=? WHERE id=? AND project_id=? AND paywall_id=?`,
      ).bind(timestamp, versionId, project(c), paywallId),
    ],
  });
});

app.post("/internal/v1/paywalls/:id/versions/:versionId/archive", async (c) => {
  const paywallId = c.req.param("id");
  const versionId = c.req.param("versionId");
  await owned(c, "paywalls", paywallId, "paywall");
  const version = await c.env.DB.prepare(
    "SELECT id FROM paywall_versions WHERE id=? AND paywall_id=? AND project_id=?",
  )
    .bind(versionId, paywallId, project(c))
    .first();
  if (!version)
    throw httpError("version_not_found", "Paywall version was not found", 404);
  const usage = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM placements WHERE project_id=? AND active_version_id=? AND active=1) +
       (SELECT COUNT(*) FROM variants WHERE project_id=? AND version_id=? AND active=1) AS count`,
  )
    .bind(project(c), versionId, project(c), versionId)
    .first<{ count: number }>();
  if ((usage?.count ?? 0) > 0)
    throw httpError(
      "version_in_use",
      "A version used by an active placement or variant cannot be archived",
      409,
    );
  const body = await readJson(c.req.raw);
  return commitMutation(c, {
    action: "paywall_version.archived",
    entityType: "paywall_version",
    entityId: versionId,
    requestBody: body,
    data: { id: versionId, status: "archived" },
    statements: [
      c.env.DB.prepare(
        `UPDATE paywall_versions SET status='archived' WHERE id=? AND project_id=? AND paywall_id=?`,
      ).bind(versionId, project(c), paywallId),
    ],
  });
});

app.get("/internal/v1/paywalls/:id", async (c) => {
  const row = await owned(c, "paywalls", c.req.param("id"), "paywall");
  const versions = await c.env.DB.prepare(
    "SELECT id,version,status,schema_version,changelog,published_at,created_at FROM paywall_versions WHERE project_id=? AND paywall_id=? ORDER BY version DESC",
  )
    .bind(project(c), row.id)
    .all();
  return c.json({ data: { ...row, versions: versions.results } });
});
app.put("/internal/v1/paywalls/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "paywalls", id, "paywall");
  const body = await readJson(c.req.raw);
  const input = parsePaywall(body);
  const updated = now();
  const row = { id, ...input, updated_at: updated };
  return commitMutation(c, {
    action: "paywall.updated",
    entityType: "paywall",
    entityId: id,
    requestBody: body,
    data: row,
    statements: [
      c.env.DB.prepare(
        "UPDATE paywalls SET identifier=?,name=?,description=?,updated_at=? WHERE id=? AND project_id=?",
      ).bind(
        input.identifier,
        input.display_name,
        input.description,
        updated,
        id,
        project(c),
      ),
    ],
  });
});
app.delete("/internal/v1/paywalls/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "paywalls", id, "paywall");
  const timestamp = now();
  return commitMutation(c, {
    action: "paywall.archived",
    entityType: "paywall",
    entityId: id,
    requestBody: {},
    data: { id, archived: true },
    statements: [
      c.env.DB.prepare(
        "UPDATE paywalls SET archived_at=?,updated_at=? WHERE id=? AND project_id=?",
      ).bind(timestamp, timestamp, id, project(c)),
      c.env.DB.prepare(
        "UPDATE placements SET active=0,updated_at=? WHERE project_id=? AND paywall_id=?",
      ).bind(timestamp, project(c), id),
    ],
  });
});

app.notFound((c) =>
  json(
    {
      error: {
        code: "paywalls_route_not_found",
        message: "Paywalls route was not found",
        status: 404,
        request_id: c.req.header("x-request-id") ?? null,
      },
    },
    404,
  ),
);

async function createPaywall(c: WorkerContext): Promise<Response> {
  const body = await readJson(c.req.raw);
  const input = parsePaywall(body);
  const timestamp = now();
  const row = {
    id: crypto.randomUUID(),
    ...input,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return commitMutation(c, {
    action: "paywall.created",
    entityType: "paywall",
    entityId: row.id,
    requestBody: body,
    status: 201,
    data: row,
    statements: [
      c.env.DB.prepare(
        "INSERT INTO paywalls (id,project_id,name,identifier,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ).bind(
        row.id,
        project(c),
        row.display_name,
        row.identifier,
        row.description,
        timestamp,
        timestamp,
      ),
    ],
  });
}

async function listPaywalls(c: WorkerContext): Promise<Row[]> {
  const rows = await c.env.DB.prepare(
    `SELECT w.*, (SELECT COUNT(*) FROM paywall_versions v WHERE v.paywall_id=w.id AND v.project_id=w.project_id) AS version_count, (SELECT MAX(version) FROM paywall_versions v WHERE v.paywall_id=w.id AND v.project_id=w.project_id AND v.status='published') AS published_version FROM paywalls w WHERE w.project_id=? AND w.archived_at IS NULL ORDER BY w.updated_at DESC`,
  )
    .bind(project(c))
    .all<Row>();
  return rows.results;
}

async function resolvePlacement(c: WorkerContext): Promise<Response> {
  const input = parsePlacement(await readJson(c.req.raw));
  guardProject(c, input.project_id);
  const candidates = await c.env.DB.prepare(
    `SELECT p.*, w.identifier AS paywall_identifier FROM placements p JOIN paywalls w ON w.id=p.paywall_id AND w.project_id=p.project_id WHERE p.project_id=? AND p.key=? AND p.active=1 AND w.archived_at IS NULL ORDER BY p.priority DESC,p.updated_at DESC`,
  )
    .bind(project(c), input.placement)
    .all<PlacementRow>();
  for (const placement of candidates.results) {
    let targeting: ReturnType<typeof parseTargeting>;
    try {
      targeting = parseTargeting(JSON.parse(placement.targeting_json));
    } catch {
      continue;
    }
    if (!matchesTargeting(targeting, input)) continue;
    const resolved = await resolveVersion(
      c,
      placement,
      input.subject_id ?? `${input.placement}:anonymous`,
    );
    if (resolved)
      return c.json({
        data: {
          placement_id: placement.id,
          placement: placement.key,
          paywall_id: placement.paywall_id,
          ...resolved,
        },
        meta: { resolved_at: now() },
      });
  }
  return c.json({
    data: null,
    meta: { placement: input.placement, reason: "no_active_match" },
  });
}

async function resolveVersion(
  c: WorkerContext,
  placement: PlacementRow,
  subject: string,
): Promise<Record<string, unknown> | null> {
  if (placement.experience_id) {
    const experience = await c.env.DB.prepare(
      `SELECT * FROM experiences WHERE id=? AND project_id=? AND paywall_id=? AND status='running' AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?)`,
    )
      .bind(
        placement.experience_id,
        project(c),
        placement.paywall_id,
        now(),
        now(),
      )
      .first<Row & { traffic_percent: number }>();
    if (
      experience &&
      (await bucket(`${project(c)}:${placement.id}:${subject}`)) <
        experience.traffic_percent
    ) {
      const variants = await c.env.DB.prepare(
        `SELECT v.id,v.key,v.weight,pv.id AS version_id,pv.version,pv.definition_json FROM variants v JOIN paywall_versions pv ON pv.id=v.version_id AND pv.project_id=v.project_id WHERE v.project_id=? AND v.experience_id=? AND v.active=1 AND pv.paywall_id=? AND pv.status='published' ORDER BY v.key`,
      )
        .bind(project(c), experience.id, placement.paywall_id)
        .all<
          Record<string, unknown> & {
            id: string;
            key: string;
            weight: number;
            version_id: string;
            version: number;
            definition_json: string;
          }
        >();
      const selected = chooseVariant(
        variants.results,
        await bucket(
          `${project(c)}:${experience.id}:${subject}`,
          variants.results.reduce((sum, variant) => sum + variant.weight, 0),
        ),
      );
      if (selected)
        return {
          version_id: selected.version_id,
          version: selected.version,
          experience_id: experience.id,
          variant_id: selected.id,
          variant: selected.key,
          definition: JSON.parse(selected.definition_json),
        };
    }
  }
  if (!placement.active_version_id) return null;
  const version = await c.env.DB.prepare(
    `SELECT id,version,definition_json FROM paywall_versions WHERE id=? AND project_id=? AND paywall_id=? AND status='published'`,
  )
    .bind(placement.active_version_id, project(c), placement.paywall_id)
    .first<{ id: string; version: number; definition_json: string }>();
  return version
    ? {
        version_id: version.id,
        version: version.version,
        experience_id: null,
        variant_id: null,
        variant: null,
        definition: JSON.parse(version.definition_json),
      }
    : null;
}

async function recordEvents(c: WorkerContext): Promise<Response> {
  const body = await readJson(c.req.raw, 2_359_296);
  const input = parseEvents(body);
  guardProject(c, input.project_id);
  await validateEventRelations(c, input.events);
  const ids = input.events.map((event) => event.id);
  const existing = await c.env.DB.prepare(
    `SELECT id FROM events WHERE project_id=? AND id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(project(c), ...ids)
    .all<{ id: string }>();
  const duplicates = new Set(existing.results.map((row) => row.id));
  const statements = input.events.map((event) =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO events (id,project_id,placement,event_type,occurred_at,payload_json,paywall_id,version_id,experience_id,variant_id,platform,customer_id,session_id,revenue_micros,currency) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      event.id,
      project(c),
      event.placement,
      event.type,
      event.occurred_at,
      JSON.stringify(event.payload),
      event.paywall_id,
      event.version_id,
      event.experience_id,
      event.variant_id,
      event.platform,
      event.customer_id,
      event.session_id,
      event.revenue_micros,
      event.currency,
    ),
  );
  return commitMutation(c, {
    action: "paywall_events.recorded",
    entityType: "paywall_event_batch",
    entityId: c.req.header("idempotency-key") ?? crypto.randomUUID(),
    requestBody: body,
    status: 202,
    data: {
      accepted: input.events.length - duplicates.size,
      duplicates: duplicates.size,
    },
    statements,
  });
}

async function statistics(c: WorkerContext): Promise<Response> {
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  const filters = parseStatistics(query);
  const placement = filters.placement
    ? await statisticsPlacementKey(c, filters.placement)
    : null;
  const clauses = ["project_id=?", "occurred_at>=?", "occurred_at<?"];
  const values: unknown[] = [project(c), filters.from, filters.to];
  for (const [value, column] of [
    [filters.platform, "platform"],
    [placement, "placement"],
    [filters.version_id, "version_id"],
    [filters.experience_id, "experience_id"],
    [filters.variant_id, "variant_id"],
  ] as const) {
    if (value) {
      clauses.push(`${column}=?`);
      values.push(value);
    }
  }
  const where = clauses.join(" AND ");
  const [totals, hourly, currencies] = await Promise.all([
    c.env.DB.prepare(
      `SELECT event_type,COUNT(*) AS count,COALESCE(SUM(revenue_micros),0) AS revenue_micros FROM events WHERE ${where} GROUP BY event_type`,
    )
      .bind(...values)
      .all<{ event_type: string; count: number; revenue_micros: number }>(),
    c.env.DB.prepare(
      `SELECT substr(occurred_at,1,13)||':00:00.000Z' AS hour,event_type,currency,COUNT(*) AS count,COALESCE(SUM(revenue_micros),0) AS revenue_micros FROM events WHERE ${where} GROUP BY hour,event_type,currency ORDER BY hour`,
    )
      .bind(...values)
      .all<{
        hour: string;
        event_type: string;
        currency: string | null;
        count: number;
        revenue_micros: number;
      }>(),
    c.env.DB.prepare(
      `SELECT currency,COALESCE(SUM(revenue_micros),0) AS revenue_micros FROM events WHERE ${where} AND revenue_micros>0 AND currency IS NOT NULL GROUP BY currency ORDER BY currency`,
    )
      .bind(...values)
      .all<{ currency: string; revenue_micros: number }>(),
  ]);
  const totalsMap: Record<string, number> = {};
  let revenue = 0;
  for (const row of totals.results) {
    totalsMap[row.event_type] = row.count;
    revenue += row.revenue_micros;
  }
  const grouped = new Map<
    string,
    {
      bucket: string;
      event_type: string;
      currency: string | null;
      count: number;
      revenue_micros: number;
    }
  >();
  for (const row of hourly.results) {
    const localBucket = timeBucket(
      new Date(row.hour),
      filters.interval,
      filters.timezone,
    );
    const key = `${localBucket}|${row.event_type}|${row.currency ?? ""}`;
    const current = grouped.get(key) ?? {
      bucket: localBucket,
      event_type: row.event_type,
      currency: row.currency,
      count: 0,
      revenue_micros: 0,
    };
    current.count += row.count;
    current.revenue_micros += row.revenue_micros;
    grouped.set(key, current);
  }
  const views = totalsMap.view ?? totalsMap.impression ?? 0;
  const purchases = totalsMap.purchase ?? 0;
  const revenueByCurrency = Object.fromEntries(
    currencies.results.map((row) => [row.currency, row.revenue_micros]),
  );
  return c.json({
    data: {
      filters,
      totals: {
        ...totalsMap,
        revenue_micros: currencies.results.length <= 1 ? revenue : null,
        revenue_by_currency: revenueByCurrency,
        conversion_rate: views ? purchases / views : 0,
      },
      series: [...grouped.values()].sort(
        (a, b) =>
          a.bucket.localeCompare(b.bucket) ||
          a.event_type.localeCompare(b.event_type),
      ),
    },
  });
}

async function statisticsPlacementKey(
  c: WorkerContext,
  placementIdOrKey: string,
): Promise<string> {
  const placement = await c.env.DB.prepare(
    "SELECT key FROM placements WHERE project_id=? AND (id=? OR key=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1",
  )
    .bind(project(c), placementIdOrKey, placementIdOrKey, placementIdOrKey)
    .first<{ key: string }>();
  return placement?.key ?? placementIdOrKey;
}

async function validatePlacementRelations(
  c: WorkerContext,
  input: ReturnType<typeof parsePlacementAdmin>,
): Promise<void> {
  await owned(c, "paywalls", input.paywall_id, "paywall");
  if (input.active_version_id) {
    const row = await c.env.DB.prepare(
      "SELECT id FROM paywall_versions WHERE id=? AND project_id=? AND paywall_id=? AND status=?",
    )
      .bind(input.active_version_id, project(c), input.paywall_id, "published")
      .first();
    if (!row)
      throw httpError(
        "published_version_not_found",
        "Active version must be a published version of the selected paywall",
        422,
      );
  }
  if (input.experience_id) {
    const row = await c.env.DB.prepare(
      "SELECT id FROM experiences WHERE id=? AND project_id=? AND paywall_id=?",
    )
      .bind(input.experience_id, project(c), input.paywall_id)
      .first();
    if (!row)
      throw httpError(
        "experience_not_found",
        "Experience does not belong to the selected paywall",
        422,
      );
  }
  if (!input.active_version_id && !input.experience_id)
    throw httpError(
      "placement_content_required",
      "A placement requires an active version or experience",
      422,
    );
}

async function validateEventRelations(
  c: WorkerContext,
  events: ReturnType<typeof parseEvents>["events"],
): Promise<void> {
  await Promise.all([
    assertOwnedEventIds(
      c,
      "paywalls",
      events.map((event) => event.paywall_id),
      "paywall",
    ),
    assertOwnedEventIds(
      c,
      "paywall_versions",
      events.map((event) => event.version_id),
      "version",
    ),
    assertOwnedEventIds(
      c,
      "experiences",
      events.map((event) => event.experience_id),
      "experience",
    ),
    assertOwnedEventIds(
      c,
      "variants",
      events.map((event) => event.variant_id),
      "variant",
    ),
  ]);
}

async function assertOwnedEventIds(
  c: WorkerContext,
  table: "paywalls" | "paywall_versions" | "experiences" | "variants",
  values: Array<string | null>,
  label: string,
): Promise<void> {
  const ids = [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
  if (!ids.length) return;
  const rows = await c.env.DB.prepare(
    `SELECT id FROM ${table} WHERE project_id=? AND id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(project(c), ...ids)
    .all();
  if (rows.results.length !== ids.length)
    throw httpError(
      `${label}_context_invalid`,
      `One or more event ${label} identifiers do not belong to this project`,
      422,
    );
}

async function validateExperience(
  c: WorkerContext,
  paywallId: string,
  versionIds: string[],
): Promise<void> {
  await owned(c, "paywalls", paywallId, "paywall");
  const unique = [...new Set(versionIds)];
  const rows = await c.env.DB.prepare(
    `SELECT id FROM paywall_versions WHERE project_id=? AND paywall_id=? AND id IN (${unique.map(() => "?").join(",")}) AND status='published'`,
  )
    .bind(project(c), paywallId, ...unique)
    .all();
  if (rows.results.length !== unique.length)
    throw httpError(
      "variant_version_invalid",
      "Every variant must reference a published version of this paywall",
      422,
    );
}
async function attachVariants(
  c: WorkerContext,
  experiences: Row[],
): Promise<Row[]> {
  if (!experiences.length) return [];
  const ids = experiences.map((row) => row.id);
  const variants = await c.env.DB.prepare(
    `SELECT * FROM variants WHERE project_id=? AND experience_id IN (${ids.map(() => "?").join(",")}) ORDER BY key`,
  )
    .bind(project(c), ...ids)
    .all<Record<string, unknown> & { experience_id: string }>();
  return experiences.map((experience) => ({
    ...experience,
    variants: variants.results
      .filter((variant) => variant.experience_id === experience.id)
      .map((variant) => ({ ...variant, active: Boolean(variant.active) })),
  }));
}
async function archiveExperience(c: WorkerContext): Promise<Response> {
  const id = c.req.param("id")!;
  await owned(c, "experiences", id, "experience");
  return commitMutation(c, {
    action: "experience.archived",
    entityType: "experience",
    entityId: id,
    requestBody: {},
    data: { id, archived: true },
    statements: [
      c.env.DB.prepare(
        `UPDATE experiences SET status='archived',updated_at=? WHERE id=? AND project_id=?`,
      ).bind(now(), id, project(c)),
      c.env.DB.prepare(
        "UPDATE placements SET experience_id=NULL,active=CASE WHEN active_version_id IS NULL THEN 0 ELSE active END,updated_at=? WHERE experience_id=? AND project_id=?",
      ).bind(now(), id, project(c)),
      c.env.DB.prepare(
        "UPDATE variants SET active=0,updated_at=? WHERE experience_id=? AND project_id=?",
      ).bind(now(), id, project(c)),
    ],
  });
}
async function deactivate(
  c: WorkerContext,
  table: "placements",
  label: string,
): Promise<Response> {
  const id = c.req.param("id")!;
  await owned(c, table, id, label);
  return commitMutation(c, {
    action: `${label}.deactivated`,
    entityType: label,
    entityId: id,
    requestBody: {},
    data: { id, active: false },
    statements: [
      c.env.DB.prepare(
        `UPDATE ${table} SET active=0,updated_at=? WHERE id=? AND project_id=?`,
      ).bind(now(), id, project(c)),
    ],
  });
}
async function owned(
  c: WorkerContext,
  table: "paywalls" | "placements" | "experiences",
  id: string,
  label: string,
): Promise<Row> {
  const row = await c.env.DB.prepare(
    `SELECT * FROM ${table} WHERE id=? AND project_id=?`,
  )
    .bind(id, project(c))
    .first<Row>();
  if (!row)
    throw httpError(`${label}_not_found`, `${label} was not found`, 404);
  return row;
}
function matchesTargeting(
  targeting: ReturnType<typeof parseTargeting>,
  input: ReturnType<typeof parsePlacement>,
): boolean {
  if (
    targeting.platforms.length &&
    (!input.platform || !targeting.platforms.includes(input.platform))
  )
    return false;
  if (targeting.locales.length) {
    const inputLocale = input.locale?.toLowerCase();
    if (
      !inputLocale ||
      !targeting.locales.some((locale) => {
        const expected = locale.toLowerCase();
        return (
          inputLocale === expected || inputLocale.startsWith(`${expected}-`)
        );
      })
    )
      return false;
  }
  if (
    targeting.countries.length &&
    (!input.country ||
      !targeting.countries.includes(input.country.toUpperCase()))
  )
    return false;
  for (const [key, expected] of Object.entries(targeting.attributes)) {
    const actual = input.attributes[key];
    if (
      Array.isArray(expected)
        ? !isTargetScalar(actual) || !expected.includes(actual)
        : expected !== actual
    )
      return false;
  }
  return true;
}
function isTargetScalar(value: unknown): value is string | number | boolean {
  return ["string", "number", "boolean"].includes(typeof value);
}
function chooseVariant<T extends { weight: number }>(
  variants: T[],
  value: number,
): T | null {
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (!total) return null;
  let cursor = value % total;
  for (const variant of variants) {
    if (cursor < variant.weight) return variant;
    cursor -= variant.weight;
  }
  return variants.at(-1) ?? null;
}
async function bucket(value: string, modulo = 100): Promise<number> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return (
    (((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>>
      0) %
    modulo
  );
}
function timeBucket(
  date: Date,
  interval: "hour" | "day" | "week" | "month",
  timezone: string,
): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (interval === "hour") return `${day}T${parts.hour}:00`;
  if (interval === "month") return `${parts.year}-${parts.month}`;
  if (interval === "week") {
    const local = new Date(`${day}T00:00:00Z`);
    const offset = (local.getUTCDay() + 6) % 7;
    local.setUTCDate(local.getUTCDate() - offset);
    return local.toISOString().slice(0, 10);
  }
  return day;
}
function placementView(row: PlacementRow): Record<string, unknown> {
  return {
    ...row,
    active: Boolean(row.active),
    targeting: JSON.parse(row.targeting_json),
    targeting_json: undefined,
  };
}
function versionView(row: VersionRow): Record<string, unknown> {
  return {
    ...row,
    definition: JSON.parse(row.definition_json),
    definition_json: undefined,
  };
}
function guardProject(c: WorkerContext, bodyProjectId: string | null): void {
  if (bodyProjectId && bodyProjectId !== project(c))
    throw httpError(
      "project_mismatch",
      "Project context does not match request body",
      403,
    );
}
function project(c: WorkerContext): string {
  return c.get("project").projectId;
}
function flag(value: boolean): number {
  return value ? 1 : 0;
}
function now(): string {
  return new Date().toISOString();
}

export default app;
