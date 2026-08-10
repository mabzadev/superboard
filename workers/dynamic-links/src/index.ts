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

type Variables = { projectId: string; projectContext: InternalProjectContext };
type DynamicContext = Context<{ Bindings: Env; Variables: Variables }>;
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500;
class DynamicError extends Error {
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

app.onError((cause, c) => {
  const error =
    cause instanceof DynamicError
      ? cause
      : new DynamicError("internal_error", "Internal server error", 500);
  if (!(cause instanceof DynamicError))
    console.error(
      JSON.stringify({
        event: "dynamic_links_error",
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
          service: "dynamic-links",
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
          service: "dynamic-links",
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
async function authenticate(c: DynamicContext, next: Next) {
  const verification = await verifyInternalProjectContextRequest(
    c.req.raw,
    configuredSecrets(
      c.env.INTERNAL_API_TOKEN,
      c.env.INTERNAL_API_TOKEN_PREVIOUS,
    ),
    "dynamic-links",
  );
  if (!verification.ok)
    throw new DynamicError(
      verification.code,
      verification.message,
      verification.code === "internal_auth_invalid" ? 401 : 403,
    );
  c.set("projectId", String(verification.context.projectId));
  c.set("projectContext", verification.context);
  await next();
}
app.use("/internal/v1", authenticate);
app.use("/internal/v1/*", authenticate);

app.get("/internal/v1", async (c) => {
  const p = c.get("projectId");
  const [links, campaigns, domains] = await Promise.all([
    count(c.env.DB, "links", p),
    count(c.env.DB, "campaigns", p),
    count(c.env.DB, "domains", p),
  ]);
  return c.json({ data: { links, campaigns, domains } });
});

app.get("/internal/v1/links", async (c) => {
  const limit = integer(c.req.query("limit"), 50, 1, 100);
  const offset = integer(c.req.query("offset"), 0, 0, 1_000_000);
  const search = (c.req.query("search") || "").trim();
  const active = c.req.query("active") || "";
  const f = filters(c.req.query());
  const rows = await c.env.DB.prepare(
    `SELECT l.id,l.slug,l.name,l.destination_url,l.destinations_json,l.campaign_id,l.title,l.subtitle,l.image_url,l.utm_json,l.active,l.created_at,l.updated_at,c.name campaign_name,
    COALESCE(SUM(CASE WHEN e.event_type='view' THEN 1 ELSE 0 END),0) total_views,
    COALESCE(SUM(CASE WHEN e.event_type='open' THEN 1 ELSE 0 END),0) total_opens,
    COALESCE(SUM(CASE WHEN e.event_type='install' THEN 1 ELSE 0 END),0) total_installs,
    COALESCE(SUM(CASE WHEN e.event_type='reinstall' THEN 1 ELSE 0 END),0) total_reinstalls,
    COALESCE(SUM(CASE WHEN e.event_type='reactivation' THEN 1 ELSE 0 END),0) total_reactivations,
    COALESCE(SUM(CASE WHEN e.event_type='app_open' THEN 1 ELSE 0 END),0) total_app_opens,
    COALESCE(SUM(CASE WHEN e.event_type='user_referred' THEN 1 ELSE 0 END),0) total_user_referred,
    COALESCE(SUM(e.engagement_time),0) total_time_spent,
    COALESCE(SUM(e.revenue_cents),0) total_revenue
    FROM links l
    LEFT JOIN campaigns c ON c.id=l.campaign_id AND c.project_id=l.project_id
    LEFT JOIN link_events e ON e.project_id=l.project_id AND e.link_id=l.id
      AND datetime(e.occurred_at)>=datetime(?) AND datetime(e.occurred_at)<datetime(?)
      AND (? IS NULL OR e.platform=?)
    WHERE l.project_id=? AND (?='' OR l.slug LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\') AND (?='' OR l.active=?)
    GROUP BY l.id
    ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(
      `${f.from}T00:00:00Z`,
      `${nextDate(f.to)}T00:00:00Z`,
      f.platform,
      f.platform,
      c.get("projectId"),
      search,
      `%${escapeLike(search)}%`,
      `%${escapeLike(search)}%`,
      active,
      active === "true" ? 1 : active === "false" ? 0 : -1,
      limit,
      offset,
    )
    .all<LinkRow>();
  return c.json({
    data: rows.results.map(linkJson),
    meta: { limit, offset, filters: f },
  });
});
app.get("/internal/v1/links/:id", async (c) => {
  const row = await ownedLink(c.env.DB, c.get("projectId"), c.req.param("id"));
  return c.json({ data: linkJson(row) });
});
app.post("/internal/v1/links", async (c) =>
  mutation(
    c,
    "link.create",
    async () => {
      const body = await objectBody(c.req.raw);
      const id = crypto.randomUUID();
      const slug = identifier(body.slug, "slug");
      const destination = url(body.destination_url, "destination_url");
      await assertCampaign(
        c.env.DB,
        c.get("projectId"),
        optional(body.campaign_id, 64),
      );
      await c.env.DB.prepare(
        `INSERT INTO links (id,project_id,slug,name,destination_url,destinations_json,campaign_id,title,subtitle,image_url,utm_json,active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      )
        .bind(
          id,
          c.get("projectId"),
          slug,
          optional(body.name, 255) || slug,
          destination,
          validJson(body.destinations, {}),
          optional(body.campaign_id, 64),
          optional(body.title, 255),
          optional(body.subtitle, 500),
          optionalUrl(body.image_url),
          validJson(body.utm, {}),
          boolean(body.active, true) ? 1 : 0,
        )
        .run();
      return { id, slug };
    },
    201,
  ),
);
app.put("/internal/v1/links/:id", async (c) =>
  mutation(c, "link.update", async () => {
    await ownedLink(c.env.DB, c.get("projectId"), c.req.param("id"));
    const body = await objectBody(c.req.raw);
    const campaignId = optional(body.campaign_id, 64);
    await assertCampaign(c.env.DB, c.get("projectId"), campaignId);
    await c.env.DB.prepare(
      `UPDATE links SET slug=?,name=?,destination_url=?,destinations_json=?,campaign_id=?,title=?,subtitle=?,image_url=?,utm_json=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?`,
    )
      .bind(
        identifier(body.slug, "slug"),
        optional(body.name, 255) || identifier(body.slug, "slug"),
        url(body.destination_url, "destination_url"),
        validJson(body.destinations, {}),
        campaignId,
        optional(body.title, 255),
        optional(body.subtitle, 500),
        optionalUrl(body.image_url),
        validJson(body.utm, {}),
        boolean(body.active, true) ? 1 : 0,
        c.req.param("id"),
        c.get("projectId"),
      )
      .run();
    return linkJson(
      await ownedLink(c.env.DB, c.get("projectId"), c.req.param("id")),
    );
  }),
);
app.delete("/internal/v1/links/:id", async (c) =>
  mutation(c, "link.delete", async () => {
    const result = await c.env.DB.prepare(
      "DELETE FROM links WHERE id=? AND project_id=?",
    )
      .bind(c.req.param("id"), c.get("projectId"))
      .run();
    if (!result.meta.changes)
      throw new DynamicError("link_not_found", "Link was not found", 404);
    return { deleted: true };
  }),
);

app.post("/internal/v1/links/:slug/resolve", async (c) => {
  const body = await objectBody(c.req.raw);
  const platform = enumValue(
    body.platform,
    ["ios", "android", "web", "desktop"],
    "web",
  );
  const row = await c.env.DB.prepare(
    "SELECT id,destination_url,destinations_json,active FROM links WHERE project_id=? AND slug=?",
  )
    .bind(c.get("projectId"), c.req.param("slug"))
    .first<{
      id: string;
      destination_url: string;
      destinations_json: string;
      active: number;
    }>();
  if (!row || row.active !== 1)
    throw new DynamicError("link_not_found", "Link was not found", 404);
  const destinations = JSON.parse(row.destinations_json) as Record<
    string,
    unknown
  >;
  const rules = await c.env.DB.prepare(
    "SELECT rule_json FROM redirect_rules WHERE project_id=? AND active=1 ORDER BY priority,id",
  )
    .bind(c.get("projectId"))
    .all<{ rule_json: string }>();
  let destination =
    typeof destinations[platform] === "string"
      ? String(destinations[platform])
      : row.destination_url;
  for (const rule of rules.results) {
    const value = JSON.parse(rule.rule_json) as Record<string, unknown>;
    if (
      (!value.platform || value.platform === platform) &&
      typeof value.destination_url === "string"
    ) {
      destination = value.destination_url;
      break;
    }
  }
  return c.json({
    data: { link_id: row.id, destination_url: destination, platform },
  });
});

app.get("/internal/v1/campaigns", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT id,name,slug,status,metadata_json,created_at,updated_at FROM campaigns WHERE project_id=? ORDER BY created_at DESC",
      )
        .bind(c.get("projectId"))
        .all<CampaignRow>()
    ).results.map(campaignJson),
  }),
);
app.post("/internal/v1/campaigns", async (c) =>
  mutation(
    c,
    "campaign.create",
    async () => {
      const body = await objectBody(c.req.raw);
      const id = crypto.randomUUID();
      const name = required(body.name, "name", 255);
      const slug = identifier(
        body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        "slug",
      );
      await c.env.DB.prepare(
        "INSERT INTO campaigns (id,project_id,name,slug,status,metadata_json,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)",
      )
        .bind(
          id,
          c.get("projectId"),
          name,
          slug,
          enumValue(body.status, ["draft", "active", "archived"], "draft"),
          validJson(body.metadata, {}),
        )
        .run();
      return { id, name, slug };
    },
    201,
  ),
);
app.put("/internal/v1/campaigns/:id", async (c) =>
  mutation(c, "campaign.update", async () => {
    await assertCampaign(c.env.DB, c.get("projectId"), c.req.param("id"));
    const body = await objectBody(c.req.raw);
    await c.env.DB.prepare(
      "UPDATE campaigns SET name=?,slug=?,status=?,metadata_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?",
    )
      .bind(
        required(body.name, "name", 255),
        identifier(body.slug, "slug"),
        enumValue(body.status, ["draft", "active", "archived"], "draft"),
        validJson(body.metadata, {}),
        c.req.param("id"),
        c.get("projectId"),
      )
      .run();
    return { id: c.req.param("id") };
  }),
);
app.delete("/internal/v1/campaigns/:id", async (c) =>
  mutation(c, "campaign.delete", async () => {
    await assertCampaign(c.env.DB, c.get("projectId"), c.req.param("id"));
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE links SET campaign_id=NULL WHERE project_id=? AND campaign_id=?",
      ).bind(c.get("projectId"), c.req.param("id")),
      c.env.DB.prepare(
        "DELETE FROM campaigns WHERE project_id=? AND id=?",
      ).bind(c.get("projectId"), c.req.param("id")),
    ]);
    return { deleted: true };
  }),
);

app.get("/internal/v1/redirect-rules", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT id,priority,name,rule_json,active,created_at,updated_at FROM redirect_rules WHERE project_id=? ORDER BY priority,id",
      )
        .bind(c.get("projectId"))
        .all<RuleRow>()
    ).results.map(ruleJson),
  }),
);
app.post("/internal/v1/redirect-rules", async (c) =>
  mutation(
    c,
    "redirect_rule.create",
    async () => {
      const body = await objectBody(c.req.raw);
      const id = crypto.randomUUID();
      await c.env.DB.prepare(
        "INSERT INTO redirect_rules (id,project_id,priority,name,rule_json,active,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
      )
        .bind(
          id,
          c.get("projectId"),
          integerValue(body.priority, 100, 0, 10000),
          required(body.name, "name", 255),
          validJson(body.rule, {}),
          boolean(body.active, true) ? 1 : 0,
        )
        .run();
      return { id };
    },
    201,
  ),
);
app.put("/internal/v1/redirect-rules/:id", async (c) =>
  mutation(c, "redirect_rule.update", async () => {
    await owned(
      c.env.DB,
      "redirect_rules",
      c.get("projectId"),
      c.req.param("id"),
      "redirect_rule",
    );
    const body = await objectBody(c.req.raw);
    await c.env.DB.prepare(
      "UPDATE redirect_rules SET priority=?,name=?,rule_json=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?",
    )
      .bind(
        integerValue(body.priority, 100, 0, 10000),
        required(body.name, "name", 255),
        validJson(body.rule, {}),
        boolean(body.active, true) ? 1 : 0,
        c.req.param("id"),
        c.get("projectId"),
      )
      .run();
    return { id: c.req.param("id") };
  }),
);
app.delete("/internal/v1/redirect-rules/:id", async (c) =>
  mutation(c, "redirect_rule.delete", async () => {
    await owned(
      c.env.DB,
      "redirect_rules",
      c.get("projectId"),
      c.req.param("id"),
      "redirect_rule",
    );
    await c.env.DB.prepare(
      "DELETE FROM redirect_rules WHERE id=? AND project_id=?",
    )
      .bind(c.req.param("id"), c.get("projectId"))
      .run();
    return { deleted: true };
  }),
);

app.get("/internal/v1/domains", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT id,hostname,status,verification_token,verified_at,is_default,created_at,updated_at FROM domains WHERE project_id=? ORDER BY is_default DESC,created_at",
      )
        .bind(c.get("projectId"))
        .all()
    ).results,
  }),
);
app.post("/internal/v1/domains", async (c) =>
  mutation(
    c,
    "domain.create",
    async () => {
      const body = await objectBody(c.req.raw);
      const hostname = host(body.hostname);
      const id = crypto.randomUUID();
      const token = randomToken(24);
      await c.env.DB.prepare(
        "INSERT INTO domains (id,project_id,hostname,status,verification_token,is_default,updated_at) VALUES (?,?,?,'pending',?,?,CURRENT_TIMESTAMP)",
      )
        .bind(
          id,
          c.get("projectId"),
          hostname,
          token,
          boolean(body.is_default, false) ? 1 : 0,
        )
        .run();
      return { id, hostname, status: "pending", verification_token: token };
    },
    201,
  ),
);
app.post("/internal/v1/domains/:id/verify", async (c) =>
  mutation(c, "domain.verify", async () => {
    await owned(
      c.env.DB,
      "domains",
      c.get("projectId"),
      c.req.param("id"),
      "domain",
    );
    const body = await objectBody(c.req.raw);
    const valid = body.verified === true;
    if (valid)
      await c.env.DB.prepare(
        "UPDATE domains SET status='verified',verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?",
      )
        .bind(c.req.param("id"), c.get("projectId"))
        .run();
    return { id: c.req.param("id"), verified: valid };
  }),
);
app.delete("/internal/v1/domains/:id", async (c) =>
  mutation(c, "domain.delete", async () => {
    await owned(
      c.env.DB,
      "domains",
      c.get("projectId"),
      c.req.param("id"),
      "domain",
    );
    await c.env.DB.prepare("DELETE FROM domains WHERE id=? AND project_id=?")
      .bind(c.req.param("id"), c.get("projectId"))
      .run();
    return { deleted: true };
  }),
);

app.get("/internal/v1/social-preview", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT title,description,image_url,site_name,updated_at FROM social_previews WHERE project_id=?",
  )
    .bind(c.get("projectId"))
    .first();
  return c.json({ data: row || null });
});
app.put("/internal/v1/social-preview", async (c) =>
  mutation(c, "social_preview.save", async () => {
    const body = await objectBody(c.req.raw);
    await c.env.DB.prepare(
      "INSERT INTO social_previews (project_id,title,description,image_url,site_name,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(project_id) DO UPDATE SET title=excluded.title,description=excluded.description,image_url=excluded.image_url,site_name=excluded.site_name,updated_at=CURRENT_TIMESTAMP",
    )
      .bind(
        c.get("projectId"),
        required(body.title, "title", 255),
        optional(body.description, 500),
        optionalUrl(body.image_url),
        optional(body.site_name, 255),
      )
      .run();
    return { saved: true };
  }),
);

app.get("/internal/v1/tracking", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT enabled,provider,configuration_json,updated_at FROM tracking_settings WHERE project_id=?",
  )
    .bind(c.get("projectId"))
    .first<{
      enabled: number;
      provider: string;
      configuration_json: string;
      updated_at: string;
    }>();
  return c.json({
    data: row
      ? {
          enabled: row.enabled === 1,
          provider: row.provider,
          configuration: JSON.parse(row.configuration_json),
          updated_at: row.updated_at,
        }
      : { enabled: true, provider: "opengrow", configuration: {} },
  });
});
app.put("/internal/v1/tracking", async (c) =>
  mutation(c, "tracking.save", async () => {
    const body = await objectBody(c.req.raw);
    await c.env.DB.prepare(
      "INSERT INTO tracking_settings (project_id,enabled,provider,configuration_json,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,provider=excluded.provider,configuration_json=excluded.configuration_json,updated_at=CURRENT_TIMESTAMP",
    )
      .bind(
        c.get("projectId"),
        boolean(body.enabled, true) ? 1 : 0,
        enumValue(
          body.provider,
          ["opengrow", "google", "segment", "none"],
          "opengrow",
        ),
        validJson(body.configuration, {}),
      )
      .run();
    return { saved: true };
  }),
);
app.post("/internal/v1/tracking/events", async (c) =>
  mutation(
    c,
    "tracking.record",
    async () => {
      const body = await objectBody(c.req.raw);
      const events = Array.isArray(body.events) ? body.events : [];
      if (!events.length || events.length > 100)
        throw new DynamicError(
          "events_invalid",
          "events must contain 1 to 100 items",
          422,
        );
      const statements = events.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new DynamicError(
            "event_invalid",
            "Each event must be an object",
            422,
          );
        const event = value as Record<string, unknown>;
        return c.env.DB.prepare(
          "INSERT OR IGNORE INTO link_events (id,project_id,link_id,campaign_id,event_type,platform,country_code,occurred_at,metadata_json,revenue_cents,engagement_time,customer_id,session_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          required(event.id, "id", 128),
          c.get("projectId"),
          optional(event.link_id, 64),
          optional(event.campaign_id, 64),
          enumValue(
            event.type,
            [
              "click",
              "redirect",
              "view",
              "open",
              "install",
              "reinstall",
              "reactivation",
              "app_open",
              "user_referred",
              "time_spent",
              "conversion",
            ],
            "click",
          ),
          optional(event.platform, 32),
          optional(event.country_code, 2),
          required(event.occurred_at, "occurred_at", 64),
          validJson(event.metadata, {}),
          integerValue(event.revenue_cents, 0, 0, Number.MAX_SAFE_INTEGER),
          integerValue(event.engagement_time, 0, 0, Number.MAX_SAFE_INTEGER),
          optional(event.customer_id, 128),
          optional(event.session_id, 128),
        );
      });
      await c.env.DB.batch(statements);
      return { accepted: events.length };
    },
    202,
  ),
);

app.get("/internal/v1/statistics", async (c) => {
  const f = filters(c.req.query());
  const rows = await c.env.DB.prepare(
    `SELECT substr(occurred_at,1,10) date,event_type,platform,COUNT(*) count,COALESCE(SUM(revenue_cents),0) revenue_cents,COALESCE(SUM(engagement_time),0) engagement_time FROM link_events WHERE project_id=? AND datetime(occurred_at)>=datetime(?) AND datetime(occurred_at)<datetime(?) AND (? IS NULL OR platform=?) AND (? IS NULL OR campaign_id=?) AND (? IS NULL OR link_id=?) GROUP BY date,event_type,platform ORDER BY date`,
  )
    .bind(
      c.get("projectId"),
      `${f.from}T00:00:00Z`,
      `${nextDate(f.to)}T00:00:00Z`,
      f.platform,
      f.platform,
      f.campaign_id,
      f.campaign_id,
      f.link_id,
      f.link_id,
    )
    .all<StatisticRow>();
  const totals: Record<string, number> = {};
  let revenue = 0;
  let timeSpent = 0;
  for (const row of rows.results) {
    totals[row.event_type] = (totals[row.event_type] || 0) + Number(row.count);
    revenue += Number(row.revenue_cents || 0);
    timeSpent += Number(row.engagement_time || 0);
  }
  totals.views = totals.view || 0;
  totals.clicks = (totals.click || 0) + (totals.redirect || 0);
  totals.opens = totals.open || 0;
  totals.installs = totals.install || 0;
  totals.reinstalls = totals.reinstall || 0;
  totals.reactivations = totals.reactivation || 0;
  totals.app_opens = totals.app_open || 0;
  totals.user_referred = totals.user_referred || 0;
  totals.revenue = revenue;
  totals.time_spent = timeSpent;
  return c.json({ data: { filters: f, totals, series: rows.results } });
});

type LinkRow = {
  id: string;
  slug: string;
  name: string;
  destination_url: string;
  destinations_json: string;
  campaign_id: string | null;
  campaign_name?: string | null;
  title: string | null;
  subtitle: string | null;
  image_url: string | null;
  utm_json: string;
  active: number;
  created_at: string;
  updated_at: string;
  total_views?: number;
  total_opens?: number;
  total_installs?: number;
  total_reinstalls?: number;
  total_reactivations?: number;
  total_app_opens?: number;
  total_user_referred?: number;
  total_time_spent?: number;
  total_revenue?: number;
};
type CampaignRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};
type RuleRow = {
  id: string;
  priority: number;
  name: string;
  rule_json: string;
  active: number;
  created_at: string;
  updated_at: string;
};
type StatisticRow = {
  date: string;
  event_type: string;
  platform: string | null;
  count: number;
  revenue_cents: number;
  engagement_time: number;
};
function linkJson(row: LinkRow) {
  const { destinations_json, utm_json, ...rest } = row;
  return {
    ...rest,
    active: row.active === 1,
    destinations: JSON.parse(destinations_json),
    utm: JSON.parse(utm_json),
  };
}
function campaignJson(row: CampaignRow) {
  const { metadata_json, ...rest } = row;
  return { ...rest, metadata: JSON.parse(metadata_json) };
}
function ruleJson(row: RuleRow) {
  const { rule_json, ...rest } = row;
  return { ...rest, active: row.active === 1, rule: JSON.parse(rule_json) };
}
async function mutation(
  c: DynamicContext,
  action: string,
  operation: () => Promise<unknown>,
  status = 200,
) {
  const key = c.req.header("idempotency-key")?.trim();
  if (!key || key.length > 255)
    throw new DynamicError(
      "idempotency_key_required",
      "Idempotency-Key is required",
      400,
    );
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
async function ownedLink(db: D1Database, p: string, id: string) {
  const row = await db
    .prepare(
      "SELECT id,slug,name,destination_url,destinations_json,campaign_id,title,subtitle,image_url,utm_json,active,created_at,updated_at FROM links WHERE project_id=? AND id=?",
    )
    .bind(p, id)
    .first<LinkRow>();
  if (!row) throw new DynamicError("link_not_found", "Link was not found", 404);
  return row;
}
async function owned(
  db: D1Database,
  table: "redirect_rules" | "domains",
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
    throw new DynamicError(
      `${label}_not_found`,
      `${label.replace("_", " ")} was not found`,
      404,
    );
}
async function assertCampaign(db: D1Database, p: string, id: string | null) {
  if (
    id &&
    !(await db
      .prepare("SELECT id FROM campaigns WHERE project_id=? AND id=?")
      .bind(p, id)
      .first())
  )
    throw new DynamicError("campaign_not_found", "Campaign was not found", 404);
}
async function count(
  db: D1Database,
  table: "links" | "campaigns" | "domains",
  p: string,
) {
  const row = await db
    .prepare(`SELECT COUNT(*) count FROM ${table} WHERE project_id=?`)
    .bind(p)
    .first<{ count: number }>();
  return Number(row?.count || 0);
}
async function objectBody(request: Request) {
  try {
    return await readJsonObjectLimited(request, 1024 * 1024);
  } catch (cause) {
    if (cause instanceof RequestBodyError)
      throw new DynamicError(cause.code, cause.message, cause.status);
    throw cause;
  }
}
function required(value: unknown, field: string, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max)
    throw new DynamicError("validation_failed", `${field} is required`, 422, {
      field,
    });
  return text;
}
function optional(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max)
    throw new DynamicError("validation_failed", "Invalid text value", 422);
  return value.trim();
}
function identifier(value: unknown, field: string) {
  const text = required(value, field, 128).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(text))
    throw new DynamicError(
      "validation_failed",
      `${field} contains unsupported characters`,
      422,
    );
  return text;
}
function url(value: unknown, field: string) {
  const text = required(value, field, 2048);
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return parsed.toString();
  } catch {
    throw new DynamicError(
      "validation_failed",
      `${field} must be an HTTP URL`,
      422,
    );
  }
}
function optionalUrl(value: unknown) {
  const text = optional(value, 2048);
  return text ? url(text, "url") : null;
}
function host(value: unknown) {
  const text = required(value, "hostname", 253).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(text))
    throw new DynamicError("hostname_invalid", "hostname is invalid", 422);
  return text;
}
function boolean(value: unknown, fallback: boolean) {
  return value === undefined ? fallback : value === true;
}
function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  return integerValue(value, fallback, min, max);
}
function integerValue(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new DynamicError("number_invalid", "Invalid numeric value", 422);
  return parsed;
}
function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new DynamicError("value_invalid", "Unsupported value", 422, {
      allowed,
    });
  return value as T;
}
function validJson(value: unknown, fallback: Record<string, never>) {
  if (value === undefined || value === null) return JSON.stringify(fallback);
  if (typeof value !== "object" || Array.isArray(value))
    throw new DynamicError("json_invalid", "Value must be an object", 422);
  return JSON.stringify(value);
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (v) => `\\${v}`);
}
function randomToken(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function filters(query: Record<string, string>) {
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || "")
    ? query.from
    : new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || "") ? query.to : today;
  if (from > to)
    throw new DynamicError("date_range_invalid", "from must be before to", 422);
  return {
    from,
    to,
    timezone: query.timezone || "UTC",
    interval: query.interval || "day",
    platform: query.platform || null,
    campaign_id: query.campaign_id || null,
    link_id: query.link_id || null,
  };
}
function nextDate(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default app;
