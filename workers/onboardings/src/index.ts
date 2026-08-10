import { Hono, type Context, type Next } from "hono";
import { inspectSqlDatabaseAndSchemaHealth } from "@opengrow/contracts/health";
import {
  verifyInternalProjectContextRequest,
  type InternalProjectContext,
} from "@opengrow/contracts";
import {
  RequestBodyError,
  readJsonObjectLimited,
} from "@opengrow/contracts/request-body";
import { configuredSecrets } from "@opengrow/contracts/secret";
import { parseEvents, parsePlacement, validateDefinition } from "./contracts";

type Variables = { projectId: string; projectContext: InternalProjectContext };
type OnboardingContext = Context<{ Bindings: Env; Variables: Variables }>;
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500;
class OnboardingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: ErrorStatus,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const fail = (
  code: string,
  message: string,
  status: ErrorStatus,
  details?: unknown,
) => new OnboardingError(code, message, status, details);
app.onError((cause, c) => {
  const error =
    cause instanceof OnboardingError
      ? cause
      : fail(
          "invalid_request",
          cause instanceof Error ? cause.message : "Invalid request",
          cause instanceof Error && cause.message.includes("Internal")
            ? 500
            : 422,
        );
  if (error.status === 500)
    console.error(
      JSON.stringify({
        event: "onboarding_error",
        request_id: c.req.header("x-request-id") || null,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        status: error.status,
        request_id: c.req.header("x-request-id") || null,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
    error.status,
  );
});
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
          service: "onboardings",
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
          service: "onboardings",
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
async function authenticate(c: OnboardingContext, next: Next) {
  const result = await verifyInternalProjectContextRequest(
    c.req.raw,
    configuredSecrets(
      c.env.INTERNAL_API_TOKEN,
      c.env.INTERNAL_API_TOKEN_PREVIOUS,
    ),
    "onboardings",
  );
  if (!result.ok)
    throw fail(
      result.code,
      result.message,
      result.code === "internal_auth_invalid" ? 401 : 403,
    );
  c.set("projectId", String(result.context.projectId));
  c.set("projectContext", result.context);
  await next();
}
app.use("/internal/v1", authenticate);
app.use("/internal/v1/*", authenticate);

app.get("/internal/v1", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT id,identifier,display_name,description,active_version,active_version_id,created_at,updated_at FROM onboardings WHERE project_id=? ORDER BY created_at DESC",
      )
        .bind(c.get("projectId"))
        .all()
    ).results,
  }),
);
app.post("/internal/v1", async (c) =>
  mutation(
    c,
    "onboarding.create",
    async () => {
      const body = await objectBody(c.req.raw);
      const identifier = slug(body.identifier, "identifier");
      const displayName = required(body.display_name, "display_name", 255);
      const id = crypto.randomUUID();
      await c.env.DB.prepare(
        "INSERT INTO onboardings (id,project_id,name,identifier,display_name,description,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)",
      )
        .bind(
          id,
          c.get("projectId"),
          displayName,
          identifier,
          displayName,
          optional(body.description, 1000),
        )
        .run();
      let version = null;
      if (body.configuration)
        version = await createVersion(
          c.env.DB,
          c.get("projectId"),
          id,
          body.configuration,
        );
      return {
        id,
        identifier,
        display_name: displayName,
        active_version: null,
        active_version_id: null,
        draft_version: version,
      };
    },
    201,
  ),
);
app.get("/internal/v1/:id{[0-9a-fA-F-]{36}}", async (c) => {
  await own(c.env.DB, c.get("projectId"), c.req.param("id"));
  const row = await c.env.DB.prepare(
    "SELECT id,identifier,display_name,description,active_version,active_version_id,created_at,updated_at FROM onboardings WHERE project_id=? AND id=?",
  )
    .bind(c.get("projectId"), c.req.param("id"))
    .first();
  return c.json({ data: row });
});
app.put("/internal/v1/:id{[0-9a-fA-F-]{36}}", async (c) =>
  mutation(c, "onboarding.update", async () => {
    await own(c.env.DB, c.get("projectId"), c.req.param("id"));
    const body = await objectBody(c.req.raw);
    await c.env.DB.prepare(
      "UPDATE onboardings SET display_name=?,name=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND id=?",
    )
      .bind(
        required(body.display_name, "display_name", 255),
        required(body.display_name, "display_name", 255),
        optional(body.description, 1000),
        c.get("projectId"),
        c.req.param("id"),
      )
      .run();
    return { id: c.req.param("id") };
  }),
);
app.delete("/internal/v1/:id{[0-9a-fA-F-]{36}}", async (c) =>
  mutation(c, "onboarding.delete", async () => {
    await own(c.env.DB, c.get("projectId"), c.req.param("id"));
    await c.env.DB.prepare(
      "DELETE FROM onboardings WHERE project_id=? AND id=?",
    )
      .bind(c.get("projectId"), c.req.param("id"))
      .run();
    return { deleted: true };
  }),
);

app.get("/internal/v1/:id{[0-9a-fA-F-]{36}}/versions", async (c) => {
  await own(c.env.DB, c.get("projectId"), c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT id,version,status state,definition_json,created_at,published_at FROM onboarding_versions WHERE project_id=? AND onboarding_id=? ORDER BY version DESC",
  )
    .bind(c.get("projectId"), c.req.param("id"))
    .all<VersionRow>();
  return c.json({ data: rows.results.map(versionJson) });
});
app.post("/internal/v1/:id{[0-9a-fA-F-]{36}}/versions", async (c) =>
  mutation(
    c,
    "onboarding.version.create",
    async () => {
      await own(c.env.DB, c.get("projectId"), c.req.param("id"));
      const body = await objectBody(c.req.raw);
      if (!body.configuration)
        throw fail("configuration_required", "configuration is required", 422);
      return createVersion(
        c.env.DB,
        c.get("projectId"),
        c.req.param("id"),
        body.configuration,
      );
    },
    201,
  ),
);
app.post("/internal/v1/:id{[0-9a-fA-F-]{36}}/publish", async (c) =>
  mutation(c, "onboarding.publish", async () => {
    await own(c.env.DB, c.get("projectId"), c.req.param("id"));
    const body = await objectBody(c.req.raw);
    const versionId = required(body.version_id, "version_id", 64);
    const version = await c.env.DB.prepare(
      "SELECT id,version,definition_json FROM onboarding_versions WHERE id=? AND onboarding_id=? AND project_id=?",
    )
      .bind(versionId, c.req.param("id"), c.get("projectId"))
      .first<{ id: string; version: number; definition_json: string }>();
    if (!version)
      throw fail("version_not_found", "Onboarding version was not found", 404);
    validateDefinition(JSON.parse(version.definition_json));
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE onboarding_versions SET status=CASE WHEN id=? THEN 'published' ELSE status END,published_at=CASE WHEN id=? THEN COALESCE(published_at,CURRENT_TIMESTAMP) ELSE published_at END WHERE onboarding_id=? AND project_id=?",
      ).bind(versionId, versionId, c.req.param("id"), c.get("projectId")),
      c.env.DB.prepare(
        "UPDATE onboardings SET active_version=?,active_version_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?",
      ).bind(version.version, versionId, c.req.param("id"), c.get("projectId")),
    ]);
    return {
      id: c.req.param("id"),
      active_version: version.version,
      active_version_id: versionId,
    };
  }),
);

app.get("/internal/v1/placements", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT id,key,name,onboarding_id,active_version_id,priority,active,created_at,updated_at FROM placements WHERE project_id=? ORDER BY priority DESC,key",
      )
        .bind(c.get("projectId"))
        .all()
    ).results,
  }),
);
app.post("/internal/v1/placements", async (c) =>
  mutation(
    c,
    "placement.create",
    async () => {
      const body = await objectBody(c.req.raw);
      const onboardingId = required(body.onboarding_id, "onboarding_id", 64);
      await own(c.env.DB, c.get("projectId"), onboardingId);
      const id = crypto.randomUUID();
      await c.env.DB.prepare(
        "INSERT INTO placements (id,project_id,key,name,onboarding_id,active_version_id,priority,active,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",
      )
        .bind(
          id,
          c.get("projectId"),
          slug(body.key, "key"),
          required(body.name || body.key, "name", 255),
          onboardingId,
          optional(body.active_version_id, 64),
          integer(body.priority, 100, 0, 10000),
          boolean(body.active, true) ? 1 : 0,
        )
        .run();
      return { id };
    },
    201,
  ),
);
app.put("/internal/v1/placements/:id", async (c) =>
  mutation(c, "placement.update", async () => {
    await owned(
      c.env.DB,
      "placements",
      c.get("projectId"),
      c.req.param("id"),
      "placement",
    );
    const body = await objectBody(c.req.raw);
    const onboardingId = required(body.onboarding_id, "onboarding_id", 64);
    await own(c.env.DB, c.get("projectId"), onboardingId);
    const activeVersion = optional(body.active_version_id, 64);
    if (
      activeVersion &&
      !(await c.env.DB.prepare(
        "SELECT id FROM onboarding_versions WHERE project_id=? AND onboarding_id=? AND id=? AND status='published'",
      )
        .bind(c.get("projectId"), onboardingId, activeVersion)
        .first())
    )
      throw fail(
        "version_not_published",
        "Placement version must be published",
        409,
      );
    await c.env.DB.prepare(
      "UPDATE placements SET key=?,name=?,onboarding_id=?,active_version_id=?,priority=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?",
    )
      .bind(
        slug(body.key, "key"),
        required(body.name || body.key, "name", 255),
        onboardingId,
        activeVersion,
        integer(body.priority, 100, 0, 10000),
        boolean(body.active, true) ? 1 : 0,
        c.req.param("id"),
        c.get("projectId"),
      )
      .run();
    return { id: c.req.param("id") };
  }),
);
app.delete("/internal/v1/placements/:id", async (c) =>
  mutation(c, "placement.delete", async () => {
    await owned(
      c.env.DB,
      "placements",
      c.get("projectId"),
      c.req.param("id"),
      "placement",
    );
    await c.env.DB.prepare("DELETE FROM placements WHERE project_id=? AND id=?")
      .bind(c.get("projectId"), c.req.param("id"))
      .run();
    return { deleted: true };
  }),
);

app.get("/internal/v1/targeting-rules", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT id,placement_id,name,priority,conditions_json,active,created_at,updated_at FROM targeting_rules WHERE project_id=? ORDER BY priority DESC",
      )
        .bind(c.get("projectId"))
        .all<TargetingRow>()
    ).results.map(targetingJson),
  }),
);
app.post("/internal/v1/targeting-rules", async (c) =>
  mutation(
    c,
    "targeting_rule.create",
    async () => {
      const body = await objectBody(c.req.raw);
      await owned(
        c.env.DB,
        "placements",
        c.get("projectId"),
        required(body.placement_id, "placement_id", 64),
        "placement",
      );
      const id = crypto.randomUUID();
      await c.env.DB.prepare(
        "INSERT INTO targeting_rules (id,project_id,placement_id,name,priority,conditions_json,active,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",
      )
        .bind(
          id,
          c.get("projectId"),
          body.placement_id,
          required(body.name, "name", 255),
          integer(body.priority, 100, 0, 10000),
          jsonObject(body.conditions),
          boolean(body.active, true) ? 1 : 0,
        )
        .run();
      return { id };
    },
    201,
  ),
);
app.delete("/internal/v1/targeting-rules/:id", async (c) =>
  mutation(c, "targeting_rule.delete", async () => {
    await owned(
      c.env.DB,
      "targeting_rules",
      c.get("projectId"),
      c.req.param("id"),
      "targeting_rule",
    );
    await c.env.DB.prepare(
      "DELETE FROM targeting_rules WHERE project_id=? AND id=?",
    )
      .bind(c.get("projectId"), c.req.param("id"))
      .run();
    return { deleted: true };
  }),
);

app.get("/internal/v1/experiences", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id,placement_id,name,status,traffic_percentage,created_at,updated_at FROM experiences WHERE project_id=? ORDER BY created_at DESC",
  )
    .bind(c.get("projectId"))
    .all();
  const variants = await c.env.DB.prepare(
    "SELECT id,experience_id,name,weight,version_id FROM experience_variants WHERE project_id=? ORDER BY experience_id,name",
  )
    .bind(c.get("projectId"))
    .all();
  return c.json({
    data: rows.results.map((row) => ({
      ...row,
      variants: variants.results.filter(
        (v) => v.experience_id === (row as { id: string }).id,
      ),
    })),
  });
});
app.post("/internal/v1/experiences", async (c) =>
  mutation(
    c,
    "experience.create",
    async () => {
      const body = await objectBody(c.req.raw);
      const placementId = required(body.placement_id, "placement_id", 64);
      await owned(
        c.env.DB,
        "placements",
        c.get("projectId"),
        placementId,
        "placement",
      );
      const variants = Array.isArray(body.variants) ? body.variants : [];
      if (variants.length < 2 || variants.length > 10)
        throw fail(
          "variants_invalid",
          "An experience requires 2 to 10 variants",
          422,
        );
      const parsed = variants.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw fail("variant_invalid", "Variant must be an object", 422);
        const variant = value as Record<string, unknown>;
        return {
          id: crypto.randomUUID(),
          name: required(variant.name, "variant.name", 255),
          weight: integer(variant.weight, 0, 1, 10000),
          version_id: required(variant.version_id, "variant.version_id", 64),
        };
      });
      const total = parsed.reduce((sum, v) => sum + v.weight, 0);
      if (total !== 10000)
        throw fail(
          "variant_weights_invalid",
          "Variant weights must total 10000",
          422,
        );
      for (const variant of parsed)
        if (
          !(await c.env.DB.prepare(
            "SELECT id FROM onboarding_versions WHERE project_id=? AND id=? AND status='published'",
          )
            .bind(c.get("projectId"), variant.version_id)
            .first())
        )
          throw fail(
            "version_not_published",
            "Every variant must reference a published version",
            409,
          );
      const id = crypto.randomUUID();
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO experiences (id,project_id,placement_id,name,status,traffic_percentage,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)",
        ).bind(
          id,
          c.get("projectId"),
          placementId,
          required(body.name, "name", 255),
          enumValue(
            body.status,
            ["draft", "running", "paused", "completed"],
            "draft",
          ),
          integer(body.traffic_percentage, 10000, 1, 10000),
        ),
        ...parsed.map((v) =>
          c.env.DB.prepare(
            "INSERT INTO experience_variants (id,project_id,experience_id,name,weight,version_id) VALUES (?,?,?,?,?,?)",
          ).bind(v.id, c.get("projectId"), id, v.name, v.weight, v.version_id),
        ),
      ]);
      return { id, variants: parsed };
    },
    201,
  ),
);
app.post("/internal/v1/experiences/:id/status", async (c) =>
  mutation(c, "experience.status", async () => {
    await owned(
      c.env.DB,
      "experiences",
      c.get("projectId"),
      c.req.param("id"),
      "experience",
    );
    const body = await objectBody(c.req.raw);
    const status = enumValue(
      body.status,
      ["draft", "running", "paused", "completed"],
      "draft",
    );
    await c.env.DB.prepare(
      "UPDATE experiences SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?",
    )
      .bind(status, c.req.param("id"), c.get("projectId"))
      .run();
    return { id: c.req.param("id"), status };
  }),
);

app.post("/internal/v1/resolve", resolve);
app.post("/internal/v1/placements/resolve", resolve);
async function resolve(c: OnboardingContext) {
  const input = parsePlacement(await objectBody(c.req.raw));
  guardProject(c.get("projectId"), input.project_id);
  const placement = await c.env.DB.prepare(
    `SELECT p.id,p.key,p.onboarding_id,COALESCE(p.active_version_id,o.active_version_id) version_id FROM placements p JOIN onboardings o ON o.id=p.onboarding_id AND o.project_id=p.project_id WHERE p.project_id=? AND p.key=? AND p.active=1 ORDER BY p.priority DESC LIMIT 1`,
  )
    .bind(c.get("projectId"), input.placement)
    .first<{
      id: string;
      key: string;
      onboarding_id: string;
      version_id: string | null;
    }>();
  if (!placement?.version_id) return c.json({ data: null });
  const rules = await c.env.DB.prepare(
    "SELECT conditions_json FROM targeting_rules WHERE project_id=? AND placement_id=? AND active=1 ORDER BY priority DESC",
  )
    .bind(c.get("projectId"), placement.id)
    .all<{ conditions_json: string }>();
  if (
    rules.results.length &&
    !rules.results.some((row) =>
      matches(JSON.parse(row.conditions_json), input),
    )
  )
    return c.json({ data: null });
  let versionId = placement.version_id;
  let experienceId: string | null = null;
  let variantId: string | null = null;
  const experience = await c.env.DB.prepare(
    "SELECT id,traffic_percentage FROM experiences WHERE project_id=? AND placement_id=? AND status='running' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(c.get("projectId"), placement.id)
    .first<{ id: string; traffic_percentage: number }>();
  if (experience) {
    const seed = input.customer_id || input.anonymous_id || crypto.randomUUID();
    const bucket = hash(seed) % 10000;
    if (bucket < experience.traffic_percentage) {
      const variants = await c.env.DB.prepare(
        "SELECT id,weight,version_id FROM experience_variants WHERE project_id=? AND experience_id=? ORDER BY id",
      )
        .bind(c.get("projectId"), experience.id)
        .all<{ id: string; weight: number; version_id: string }>();
      let cursor = 0;
      const selected = variants.results.find((variant) => {
        cursor += variant.weight;
        return bucket % 10000 < cursor;
      });
      if (selected) {
        versionId = selected.version_id;
        experienceId = experience.id;
        variantId = selected.id;
      }
    }
  }
  const version = await c.env.DB.prepare(
    "SELECT id,version,definition_json FROM onboarding_versions WHERE project_id=? AND id=? AND status='published'",
  )
    .bind(c.get("projectId"), versionId)
    .first<{ id: string; version: number; definition_json: string }>();
  if (!version) return c.json({ data: null });
  return c.json({
    data: {
      onboarding_id: placement.onboarding_id,
      placement_id: placement.id,
      placement: placement.key,
      version_id: version.id,
      version: version.version,
      experience_id: experienceId,
      variant_id: variantId,
      definition: JSON.parse(version.definition_json),
    },
  });
}

app.post("/internal/v1/events", async (c) =>
  mutation(
    c,
    "events.record",
    async () => {
      const input = parseEvents(await objectBody(c.req.raw));
      guardProject(c.get("projectId"), input.project_id);
      const statements = input.events.map((event) =>
        c.env.DB.prepare(
          "INSERT OR IGNORE INTO events (id,project_id,placement,event_type,occurred_at,payload_json,platform,onboarding_id,version_id,experience_id,variant_id,step_id,customer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          event.id,
          c.get("projectId"),
          event.placement,
          event.type,
          event.occurred_at,
          JSON.stringify(event.payload),
          event.platform,
          event.onboarding_id || null,
          event.version_id || null,
          event.experience_id || null,
          event.variant_id || null,
          event.step_id || null,
          event.customer_id || null,
        ),
      );
      await c.env.DB.batch(statements);
      return { accepted: input.events.length };
    },
    202,
  ),
);
app.get("/internal/v1/statistics", async (c) => {
  const f = statFilters(c.req.query());
  const placement = f.placement
    ? await statisticsPlacementKey(c, f.placement)
    : null;
  const rows = await c.env.DB.prepare(
    `SELECT substr(occurred_at,1,13)||':00:00Z' hour,event_type,platform,placement,version_id,experience_id,variant_id,step_id,COUNT(*) count FROM events WHERE project_id=? AND occurred_at>=? AND occurred_at<? AND (? IS NULL OR platform=?) AND (? IS NULL OR placement=?) AND (? IS NULL OR version_id=?) AND (? IS NULL OR experience_id=?) AND (? IS NULL OR variant_id=?) GROUP BY hour,event_type,platform,placement,version_id,experience_id,variant_id,step_id ORDER BY hour`,
  )
    .bind(
      c.get("projectId"),
      `${f.from}T00:00:00Z`,
      `${nextDate(f.to)}T00:00:00Z`,
      f.platform,
      f.platform,
      placement,
      placement,
      f.version_id,
      f.version_id,
      f.experience_id,
      f.experience_id,
      f.variant_id,
      f.variant_id,
    )
    .all<StatRow>();
  const totals: Record<string, number> = {};
  const steps: Record<string, number> = {};
  const grouped = new Map<string, OnboardingSeriesRow>();
  for (const row of rows.results) {
    const count = Number(row.count);
    totals[row.event_type] = (totals[row.event_type] || 0) + count;
    if (row.step_id && row.event_type === "step_view")
      steps[row.step_id] = (steps[row.step_id] || 0) + count;
    const bucket = statisticsBucket(new Date(row.hour), f.interval, f.timezone);
    const key = [
      bucket,
      row.event_type,
      row.platform,
      row.placement,
      row.version_id,
      row.experience_id,
      row.variant_id,
      row.step_id,
    ].join("|");
    const current = grouped.get(key) ?? {
      date: bucket,
      event_type: row.event_type,
      platform: row.platform,
      placement: row.placement,
      version_id: row.version_id,
      experience_id: row.experience_id,
      variant_id: row.variant_id,
      step_id: row.step_id,
      count: 0,
    };
    current.count += count;
    grouped.set(key, current);
  }
  const completionRate = ratio(totals.complete, totals.impression);
  const funnel = Object.entries(steps).map(([step, count]) => ({
    step,
    count,
  }));
  return c.json({
    data: {
      filters: { ...f, placement_id: f.placement },
      totals,
      series: [...grouped.values()].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.event_type.localeCompare(b.event_type),
      ),
      funnel,
      completion_rate: completionRate,
      drop_off_rate: totals.impression ? 1 - completionRate : 0,
    },
  });
});

type VersionRow = {
  id: string;
  version: number;
  state: string;
  definition_json: string;
  created_at: string;
  published_at: string | null;
};
type TargetingRow = {
  id: string;
  placement_id: string;
  name: string;
  priority: number;
  conditions_json: string;
  active: number;
  created_at: string;
  updated_at: string;
};
type StatRow = {
  hour: string;
  event_type: string;
  platform: string;
  placement: string;
  version_id: string | null;
  experience_id: string | null;
  variant_id: string | null;
  step_id: string | null;
  count: number;
};
type OnboardingSeriesRow = {
  date: string;
  event_type: string;
  platform: string;
  placement: string;
  version_id: string | null;
  experience_id: string | null;
  variant_id: string | null;
  step_id: string | null;
  count: number;
};
function versionJson(row: VersionRow) {
  const { definition_json, ...rest } = row;
  return { ...rest, configuration: JSON.parse(definition_json) };
}
function targetingJson(row: TargetingRow) {
  const { conditions_json, ...rest } = row;
  return {
    ...rest,
    active: row.active === 1,
    conditions: JSON.parse(conditions_json),
  };
}
async function mutation(
  c: OnboardingContext,
  action: string,
  operation: () => Promise<unknown>,
  status = 200,
) {
  const key = c.req.header("idempotency-key")?.trim();
  if (!key || key.length > 255)
    throw fail("idempotency_key_required", "Idempotency-Key is required", 400);
  const p = c.get("projectId");
  const known = await c.env.DB.prepare(
    "SELECT response_json,status_code FROM idempotency_keys WHERE project_id=? AND key=?",
  )
    .bind(p, key)
    .first<{ response_json: string; status_code: number }>();
  if (known)
    return new Response(known.response_json, {
      status: known.status_code,
      headers: {
        "content-type": "application/json",
        "x-idempotent-replay": "true",
      },
    });
  const data = await operation();
  const response = JSON.stringify({ data });
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO audit_events (id,project_id,action,actor_id,request_id,payload_json) VALUES (?,?,?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      p,
      action,
      String(c.get("projectContext").actorId),
      c.get("projectContext").requestId,
      JSON.stringify(data),
    ),
    c.env.DB.prepare(
      "INSERT INTO idempotency_keys (project_id,key,response_json,status_code) VALUES (?,?,?,?)",
    ).bind(p, key, response, status),
  ]);
  return new Response(response, {
    status,
    headers: { "content-type": "application/json" },
  });
}
async function objectBody(request: Request) {
  try {
    return await readJsonObjectLimited(request, 1024 * 1024);
  } catch (cause) {
    if (cause instanceof RequestBodyError) {
      throw fail(cause.code, cause.message, cause.status);
    }
    throw cause;
  }
}
async function own(db: D1Database, p: string, id: string) {
  if (
    !(await db
      .prepare("SELECT id FROM onboardings WHERE id=? AND project_id=?")
      .bind(id, p)
      .first())
  )
    throw fail("onboarding_not_found", "Onboarding was not found", 404);
}
async function owned(
  db: D1Database,
  table: "placements" | "targeting_rules" | "experiences",
  p: string,
  id: string,
  label: string,
) {
  if (
    !(await db
      .prepare(`SELECT id FROM ${table} WHERE project_id=? AND id=?`)
      .bind(p, id)
      .first())
  )
    throw fail(
      `${label}_not_found`,
      `${label.replace("_", " ")} was not found`,
      404,
    );
}
async function createVersion(
  db: D1Database,
  p: string,
  onboardingId: string,
  configuration: unknown,
) {
  const definition = validateDefinition(configuration);
  const next = await db
    .prepare(
      "SELECT COALESCE(MAX(version),0)+1 version FROM onboarding_versions WHERE onboarding_id=? AND project_id=?",
    )
    .bind(onboardingId, p)
    .first<{ version: number }>();
  const row = {
    id: crypto.randomUUID(),
    version: Number(next?.version || 1),
    state: "draft",
    configuration: definition,
  };
  await db
    .prepare(
      "INSERT INTO onboarding_versions (id,onboarding_id,version,status,definition_json,project_id) VALUES (?,?,?,'draft',?,?)",
    )
    .bind(row.id, onboardingId, row.version, JSON.stringify(definition), p)
    .run();
  return row;
}
function guardProject(header: string, body?: string) {
  if (body && header !== body)
    throw fail("project_mismatch", "Project context does not match body", 403);
}
function required(value: unknown, name: string, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max)
    throw fail("validation_failed", `${name} is required`, 422, {
      field: name,
    });
  return text;
}
function optional(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max)
    throw fail("validation_failed", "Invalid text value", 422);
  return value.trim();
}
function slug(value: unknown, name: string) {
  const text = required(value, name, 128).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(text))
    throw fail(
      "validation_failed",
      `${name} contains unsupported characters`,
      422,
    );
  return text;
}
function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max)
    throw fail("number_invalid", "Invalid number", 422);
  return result;
}
function boolean(value: unknown, fallback: boolean) {
  return value === undefined ? fallback : value === true;
}
function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw fail("value_invalid", "Unsupported value", 422, { allowed });
  return value as T;
}
function jsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw fail("conditions_invalid", "conditions must be an object", 422);
  return JSON.stringify(value);
}
function matches(
  conditions: Record<string, unknown>,
  input: ReturnType<typeof parsePlacement>,
) {
  for (const [key, value] of Object.entries(conditions)) {
    if (key === "platform" && value !== input.platform) return false;
    if (key === "locale" && value !== input.locale) return false;
    if (
      key === "min_app_version" &&
      input.app_version &&
      String(input.app_version) < String(value)
    )
      return false;
    if (
      key.startsWith("attribute.") &&
      input.attributes[key.slice(10)] !== value
    )
      return false;
  }
  return true;
}
function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
function statFilters(query: Record<string, string>) {
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || "")
    ? query.from
    : new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || "") ? query.to : today;
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (from > to || toDate.getTime() - fromDate.getTime() > 366 * 86_400_000)
    throw fail(
      "date_range_invalid",
      "Statistics range must be valid and no longer than 366 days",
      422,
    );
  const timezone = query.timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(fromDate);
  } catch {
    throw fail(
      "timezone_invalid",
      "timezone must be a valid IANA timezone",
      422,
    );
  }
  return {
    from,
    to,
    timezone,
    interval: enumValue(
      query.interval,
      ["hour", "day", "week", "month"] as const,
      "day",
    ),
    platform: query.platform
      ? enumValue(query.platform, ["ios", "android", "web"] as const, "web")
      : null,
    placement: query.placement_id || query.placement || null,
    version_id: query.version_id || null,
    experience_id: query.experience_id || null,
    variant_id: query.variant_id || null,
  };
}
function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function ratio(value = 0, total = 0) {
  return total ? value / total : 0;
}
async function statisticsPlacementKey(c: OnboardingContext, value: string) {
  const row = await c.env.DB.prepare(
    "SELECT key FROM placements WHERE project_id=? AND (id=? OR key=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1",
  )
    .bind(c.get("projectId"), value, value, value)
    .first<{ key: string }>();
  return row?.key ?? value;
}
function statisticsBucket(
  date: Date,
  interval: "hour" | "day" | "week" | "month",
  timezone: string,
) {
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
export default app;
