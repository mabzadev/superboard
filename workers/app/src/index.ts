import { Hono, type Context, type Next } from "hono";
import { inspectSqlDatabaseAndSchemaHealth } from "@opengrow/contracts/health";
import {
  verifyInternalProjectContextRequest,
  type InternalProjectContext,
} from "@opengrow/contracts/project-context";
import { configuredSecrets } from "@opengrow/contracts/secret";

type Variables = { projectId: string; projectContext: InternalProjectContext };
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500;

class AppError extends Error {
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
    cause instanceof AppError
      ? cause
      : new AppError("internal_error", "Internal server error", 500);
  if (!(cause instanceof AppError))
    console.error(
      JSON.stringify({
        event: "app_worker_error",
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
          service: "app",
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
          service: "app",
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

async function authenticate(c: AppContext, next: Next) {
  const verification = await verifyInternalProjectContextRequest(
    c.req.raw,
    configuredSecrets(
      c.env.INTERNAL_API_TOKEN,
      c.env.INTERNAL_API_TOKEN_PREVIOUS,
    ),
    "app",
  );
  if (!verification.ok)
    throw new AppError(
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
  const projectId = c.get("projectId");
  const [customers, referrals, configured] = await Promise.all([
    count(c.env.DB, "customers", projectId),
    count(c.env.DB, "referrals", projectId),
    c.env.DB.prepare(
      "SELECT COUNT(*) count FROM sdk_configurations WHERE project_id = ? AND status IN ('configured','verified')",
    )
      .bind(projectId)
      .first<{ count: number }>(),
  ]);
  return c.json({
    data: {
      project_id: Number(projectId),
      customers,
      referrals,
      configured_platforms: Number(configured?.count || 0),
    },
  });
});

app.get("/internal/v1/customers", async (c) => {
  const projectId = c.get("projectId");
  const limit = integerQuery(c.req.query("limit"), 50, 1, 100);
  const offset = integerQuery(c.req.query("offset"), 0, 0, 1_000_000);
  const search = (c.req.query("search") || "").trim();
  const filters = statisticsFilters(c.req.query());
  const where = search
    ? "AND (c.external_id LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')"
    : "";
  const values: unknown[] = [projectId];
  if (search) values.push(...Array(3).fill(`%${escapeLike(search)}%`));
  const rows = await c.env.DB.prepare(
    `SELECT c.id,c.external_id,c.email,c.name,c.platform,c.country_code,c.attributes_json,c.first_seen_at,c.last_seen_at,c.created_at,c.updated_at,
    COALESCE(SUM(CASE WHEN e.event_type='view' THEN 1 ELSE 0 END),0) total_views,
    COALESCE(SUM(CASE WHEN e.event_type='open' THEN 1 ELSE 0 END),0) total_opens,
    COALESCE(SUM(CASE WHEN e.event_type='install' THEN 1 ELSE 0 END),0) total_installs,
    COALESCE(SUM(CASE WHEN e.event_type='reinstall' THEN 1 ELSE 0 END),0) total_reinstalls,
    COALESCE(SUM(CASE WHEN e.event_type='reactivation' THEN 1 ELSE 0 END),0) total_reactivations,
    COALESCE(SUM(CASE WHEN e.event_type='app_open' THEN 1 ELSE 0 END),0) total_app_opens,
    COALESCE(SUM(CASE WHEN e.event_type='user_referred' THEN 1 ELSE 0 END),0) total_user_referred,
    COALESCE(SUM(e.engagement_time),0) total_time_spent,
    COALESCE(SUM(CASE WHEN e.event_type='purchase' THEN e.revenue_cents WHEN e.event_type='refund' THEN -e.revenue_cents ELSE 0 END),0) total_revenue
    FROM customers c LEFT JOIN customer_events e ON e.project_id=c.project_id AND e.customer_id=c.id
      AND datetime(e.occurred_at)>=datetime(?) AND datetime(e.occurred_at)<datetime(?) AND (? IS NULL OR e.platform=?)
    WHERE c.project_id = ? ${where} GROUP BY c.id
    ORDER BY c.last_seen_at DESC,c.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(
      filters.from_utc,
      filters.to_exclusive_utc,
      filters.platform,
      filters.platform,
      ...values,
      limit,
      offset,
    )
    .all<CustomerRow>();
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) count FROM customers c WHERE c.project_id = ? ${where}`,
  )
    .bind(...values)
    .first<{ count: number }>();
  return c.json({
    data: rows.results.map(customerJson),
    meta: {
      total: Number(total?.count || 0),
      limit,
      offset,
      filters: publicStatisticsFilters(filters),
    },
  });
});

app.get("/internal/v1/customers/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, external_id, email, name, platform, country_code, attributes_json, first_seen_at, last_seen_at, created_at, updated_at FROM customers WHERE project_id = ? AND id = ?",
  )
    .bind(c.get("projectId"), c.req.param("id"))
    .first<CustomerRow>();
  if (!row)
    throw new AppError("customer_not_found", "Customer was not found", 404);
  return c.json({ data: customerJson(row) });
});

app.post("/internal/v1/customers", async (c) =>
  runMutation(c, "customer.upsert", async () => {
    const body = await bodyObject(c.req.raw);
    const externalId = text(body.external_id, "external_id", 255);
    const now = new Date().toISOString();
    const row = await c.env.DB.prepare(
      `INSERT INTO customers (id, project_id, external_id, email, name, platform, country_code, attributes_json, first_seen_at, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, external_id) DO UPDATE SET email=excluded.email, name=excluded.name, platform=excluded.platform, country_code=excluded.country_code, attributes_json=excluded.attributes_json, last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at RETURNING id`,
    )
      .bind(
        crypto.randomUUID(),
        c.get("projectId"),
        externalId,
        optionalText(body.email, 320),
        optionalText(body.name, 255),
        optionalEnum(body.platform, ["ios", "android", "web"]),
        optionalText(body.country_code, 2)?.toUpperCase() || null,
        jsonObject(body.attributes),
        now,
        now,
        now,
      )
      .first<{ id: string }>();
    if (!row)
      throw new AppError(
        "customer_upsert_failed",
        "Customer could not be saved",
        500,
      );
    return { id: row.id, external_id: externalId };
  }),
);

app.delete("/internal/v1/customers/:id", async (c) =>
  runMutation(c, "customer.delete", async () => {
    const result = await c.env.DB.prepare(
      "DELETE FROM customers WHERE id = ? AND project_id = ?",
    )
      .bind(c.req.param("id"), c.get("projectId"))
      .run();
    if (!result.meta.changes)
      throw new AppError("customer_not_found", "Customer was not found", 404);
    return { deleted: true };
  }),
);

// Application identities are opaque subjects owned by the Identity Worker.
// This endpoint is intentionally idempotent because the account-erasure
// coordinator may replay a completed step after a timeout or Worker restart.
// Customer analytics and referral edges are removed by the project-scoped
// foreign-key cascade; the audit only records aggregate deletion counts.
app.delete("/internal/v1/application/users/:userId", async (c) =>
  runMutation(c, "application_user.erase", async () => {
    const userId = applicationUserId(c.req.param("userId"));
    const rows = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE project_id = ? AND external_id = ?",
    )
      .bind(c.get("projectId"), userId)
      .all<{ id: string }>();
    if (rows.results.length) {
      const placeholders = rows.results.map(() => "?").join(",");
      await c.env.DB.prepare(
        `DELETE FROM customers WHERE project_id = ? AND id IN (${placeholders})`,
      )
        .bind(c.get("projectId"), ...rows.results.map((row) => row.id))
        .run();
    }
    return { erased: true, customers_deleted: rows.results.length };
  }),
);

app.get("/internal/v1/referrals", async (c) => {
  const filters = statisticsFilters(c.req.query());
  const rows = await c.env.DB.prepare(
    `SELECT r.id,r.code,r.customer_id,r.invited_customer_id,r.source,r.status,r.converted_at,r.created_at,
    source.external_id customer_external_id,invited.external_id invited_customer_external_id,
    COALESCE(SUM(CASE WHEN e.event_type='view' THEN 1 ELSE 0 END),0) views,
    COALESCE(SUM(CASE WHEN e.event_type='open' THEN 1 ELSE 0 END),0) opens,
    COALESCE(SUM(CASE WHEN e.event_type='install' THEN 1 ELSE 0 END),0) installs,
    COALESCE(SUM(CASE WHEN e.event_type='reinstall' THEN 1 ELSE 0 END),0) reinstalls,
    COALESCE(SUM(CASE WHEN e.event_type='reactivation' THEN 1 ELSE 0 END),0) reactivations,
    COALESCE(SUM(CASE WHEN e.event_type='user_referred' THEN 1 ELSE 0 END),0) invited_users,
    COALESCE(SUM(e.engagement_time),0) time_spent,
    COALESCE(SUM(CASE WHEN e.event_type='purchase' THEN e.revenue_cents WHEN e.event_type='refund' THEN -e.revenue_cents ELSE 0 END),0) total_revenue
    FROM referrals r
    LEFT JOIN customers source ON source.id=r.customer_id AND source.project_id=r.project_id
    LEFT JOIN customers invited ON invited.id=r.invited_customer_id AND invited.project_id=r.project_id
    LEFT JOIN customer_events e ON e.project_id=r.project_id AND e.referrer_customer_id=r.customer_id
      AND (r.invited_customer_id IS NULL OR e.customer_id=r.invited_customer_id)
      AND datetime(e.occurred_at)>=datetime(?) AND datetime(e.occurred_at)<datetime(?) AND (? IS NULL OR e.platform=?)
    WHERE r.project_id=? GROUP BY r.id ORDER BY r.created_at DESC LIMIT 500`,
  )
    .bind(
      filters.from_utc,
      filters.to_exclusive_utc,
      filters.platform,
      filters.platform,
      c.get("projectId"),
    )
    .all();
  return c.json({ data: rows.results });
});

app.post("/internal/v1/referrals", async (c) =>
  runMutation(c, "referral.create", async () => {
    const body = await bodyObject(c.req.raw);
    const customerId = optionalText(body.customer_id, 64);
    const invitedCustomerId = optionalText(body.invited_customer_id, 64);
    await assertOwnedCustomer(c.env.DB, c.get("projectId"), customerId);
    await assertOwnedCustomer(c.env.DB, c.get("projectId"), invitedCustomerId);
    const id = crypto.randomUUID();
    const code = text(body.code, "code", 128);
    await c.env.DB.prepare(
      "INSERT INTO referrals (id, project_id, customer_id, invited_customer_id, code, source, status, converted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        c.get("projectId"),
        customerId,
        invitedCustomerId,
        code,
        optionalText(body.source, 128),
        optionalEnum(body.status, ["pending", "converted", "rejected"]) ||
          "pending",
        optionalIsoTimestamp(body.converted_at, "converted_at"),
      )
      .run();
    return { id, code };
  }),
);

app.get("/internal/v1/access-key", async (c) => {
  const key = await c.env.DB.prepare(
    "SELECT id, prefix, last_used_at, created_at, revoked_at FROM access_keys WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(c.get("projectId"))
    .first();
  return c.json({ data: key || null });
});

app.post("/internal/v1/access-key/rotate", async (c) =>
  runMutation(c, "access_key.rotate", async () => {
    const secret = randomToken("og_app_", 32);
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE access_keys SET revoked_at=CURRENT_TIMESTAMP WHERE project_id=? AND revoked_at IS NULL",
      ).bind(c.get("projectId")),
      c.env.DB.prepare(
        "INSERT INTO access_keys (id, project_id, key_hash, prefix, created_by) VALUES (?, ?, ?, ?, ?)",
      ).bind(
        id,
        c.get("projectId"),
        await sha256(secret),
        secret.slice(0, 15),
        String(c.get("projectContext").actorId),
      ),
    ]);
    return { id, prefix: secret.slice(0, 15), secret };
  }),
);

app.get("/internal/v1/setup/:platform", async (c) => {
  const platform = platformParam(c.req.param("platform"));
  const row = await c.env.DB.prepare(
    "SELECT platform, status, configuration_json, verified_at, created_at, updated_at FROM sdk_configurations WHERE project_id=? AND platform=?",
  )
    .bind(c.get("projectId"), platform)
    .first<ConfigurationRow>();
  return c.json({ data: row ? configurationJson(row) : null });
});

app.post("/internal/v1/runtime-policy/resolve", async (c) => {
  const body = await bodyObject(c.req.raw);
  const platform = platformParam(
    String(c.req.header("PLATFORM") || body.platform || ""),
  );
  const appVersion = semanticVersion(body.app_version, "app_version", true)!;
  const build = optionalText(body.build, 64);
  const row = await c.env.DB.prepare(
    "SELECT configuration_json FROM sdk_configurations WHERE project_id=? AND platform=? LIMIT 1",
  )
    .bind(c.get("projectId"), platform)
    .first<{ configuration_json: string }>();
  const configuration = row
    ? (JSON.parse(row.configuration_json) as Record<string, unknown>)
    : {};
  const minimumVersion = semanticVersion(
    configuration.minimum_version,
    "minimum_version",
  );
  const recommendedVersion = semanticVersion(
    configuration.recommended_version,
    "recommended_version",
  );
  const maintenanceEnabled = configuration.maintenance_enabled === true;
  const updateRequired = Boolean(
    minimumVersion && compareVersions(appVersion, minimumVersion) < 0,
  );
  const updateAvailable = Boolean(
    recommendedVersion && compareVersions(appVersion, recommendedVersion) < 0,
  );
  return c.json({
    data: {
      platform,
      app_version: appVersion,
      build,
      status: maintenanceEnabled
        ? "maintenance"
        : updateRequired
          ? "update_required"
          : updateAvailable
            ? "update_available"
            : "operational",
      maintenance: {
        enabled: maintenanceEnabled,
        message: optionalText(configuration.maintenance_message, 500),
      },
      update: {
        required: updateRequired,
        available: updateAvailable,
        minimum_version: minimumVersion,
        recommended_version: recommendedVersion,
        store_url: safeHttpsUrl(configuration.store_url, "store_url"),
      },
    },
  });
});

app.put("/internal/v1/setup/:platform", async (c) =>
  runMutation(c, "sdk_configuration.save", async () => {
    const platform = platformParam(c.req.param("platform"));
    const body = await bodyObject(c.req.raw);
    validateConfiguration(platform, body);
    await c.env.DB.prepare(
      "INSERT INTO sdk_configurations (id, project_id, platform, status, configuration_json, updated_at) VALUES (?, ?, ?, 'configured', ?, CURRENT_TIMESTAMP) ON CONFLICT(project_id, platform) DO UPDATE SET status='configured', configuration_json=excluded.configuration_json, verified_at=NULL, updated_at=CURRENT_TIMESTAMP",
    )
      .bind(
        crypto.randomUUID(),
        c.get("projectId"),
        platform,
        JSON.stringify(body),
      )
      .run();
    return { platform, status: "configured", configuration: body };
  }),
);

app.post("/internal/v1/setup/:platform/test", async (c) =>
  runMutation(c, "sdk_configuration.verify", async () => {
    const platform = platformParam(c.req.param("platform"));
    const row = await c.env.DB.prepare(
      "SELECT configuration_json FROM sdk_configurations WHERE project_id=? AND platform=?",
    )
      .bind(c.get("projectId"), platform)
      .first<{ configuration_json: string }>();
    if (!row)
      throw new AppError(
        "configuration_not_found",
        "SDK configuration was not found",
        404,
      );
    validateConfiguration(platform, JSON.parse(row.configuration_json));
    const verifiedAt = new Date().toISOString();
    await c.env.DB.prepare(
      "UPDATE sdk_configurations SET status='verified', verified_at=?, updated_at=? WHERE project_id=? AND platform=?",
    )
      .bind(verifiedAt, verifiedAt, c.get("projectId"), platform)
      .run();
    return { ok: true, platform, verified_at: verifiedAt };
  }),
);

app.delete("/internal/v1/setup/:platform", async (c) =>
  runMutation(c, "sdk_configuration.delete", async () => {
    const platform = platformParam(c.req.param("platform"));
    await c.env.DB.prepare(
      "DELETE FROM sdk_configurations WHERE project_id=? AND platform=?",
    )
      .bind(c.get("projectId"), platform)
      .run();
    return { deleted: true, platform };
  }),
);

app.post("/internal/v1/customer-events", async (c) =>
  runMutation(c, "customer_events.record", async () => {
    const body = await bodyObject(c.req.raw);
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length < 1 || events.length > 100)
      throw new AppError(
        "events_invalid",
        "events must contain 1 to 100 items",
        422,
      );
    const statements = [];
    for (const value of events) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new AppError(
          "event_invalid",
          "Each event must be an object",
          422,
        );
      const event = value as Record<string, unknown>;
      const customerId = optionalText(event.customer_id, 128);
      const referrerCustomerId = optionalText(event.referrer_customer_id, 128);
      await assertOwnedCustomer(c.env.DB, c.get("projectId"), customerId);
      await assertOwnedCustomer(
        c.env.DB,
        c.get("projectId"),
        referrerCustomerId,
      );
      statements.push(
        c.env.DB.prepare(
          "INSERT OR IGNORE INTO customer_events (id,project_id,customer_id,referrer_customer_id,event_type,platform,occurred_at,revenue_cents,engagement_time,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          text(event.id, "id", 128),
          c.get("projectId"),
          customerId,
          referrerCustomerId,
          requiredEnum(event.type, [
            "view",
            "open",
            "install",
            "reinstall",
            "reactivation",
            "app_open",
            "user_referred",
            "time_spent",
            "purchase",
            "refund",
          ]),
          optionalEnum(event.platform, ["ios", "android", "web"]),
          isoTimestamp(event.occurred_at, "occurred_at"),
          nonNegativeInteger(event.revenue_cents),
          nonNegativeInteger(event.engagement_time),
          jsonObject(event.metadata),
        ),
      );
    }
    await c.env.DB.batch(statements);
    return { accepted: events.length };
  }),
);

app.get("/internal/v1/statistics", async (c) => {
  const filters = statisticsFilters(c.req.query());
  const rows = await c.env.DB.prepare(
    `SELECT metric_date date, platform, SUM(active_customers) active_customers, SUM(new_customers) new_customers, SUM(referrals) referrals, SUM(installs) installs, SUM(opens) opens FROM daily_metrics WHERE project_id=? AND metric_date>=? AND metric_date<=? AND (? IS NULL OR platform=?) GROUP BY metric_date, platform ORDER BY metric_date`,
  )
    .bind(
      c.get("projectId"),
      filters.from,
      filters.to,
      filters.platform,
      filters.platform,
    )
    .all();
  return c.json({
    data: { filters: publicStatisticsFilters(filters), series: rows.results },
  });
});

type CustomerRow = {
  id: string;
  external_id: string;
  email: string | null;
  name: string | null;
  platform: string | null;
  country_code: string | null;
  attributes_json: string;
  first_seen_at: string;
  last_seen_at: string;
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
type ConfigurationRow = {
  platform: string;
  status: string;
  configuration_json: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};
function customerJson(row: CustomerRow) {
  const { attributes_json, ...rest } = row;
  return { ...rest, attributes: JSON.parse(attributes_json) };
}
function configurationJson(row: ConfigurationRow) {
  const { configuration_json, ...rest } = row;
  return { ...rest, configuration: JSON.parse(configuration_json) };
}

async function runMutation(
  c: AppContext,
  action: string,
  operation: () => Promise<unknown>,
) {
  const key = c.req.header("idempotency-key")?.trim();
  if (!key || key.length > 255)
    throw new AppError(
      "idempotency_key_required",
      "Idempotency-Key is required",
      400,
    );
  const projectId = c.get("projectId");
  const known = await c.env.DB.prepare(
    "SELECT response_json, status_code FROM idempotency_keys WHERE project_id=? AND key=?",
  )
    .bind(projectId, key)
    .first<{ response_json: string; status_code: number }>();
  if (known)
    return new Response(known.response_json, {
      status: known.status_code,
      headers: {
        "content-type": "application/json",
        "x-idempotent-replay": "true",
      },
    });
  const result = await operation();
  const response = JSON.stringify({ data: result });
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO audit_events (id, project_id, action, actor, payload_json, request_id) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      projectId,
      action,
      String(c.get("projectContext").actorId),
      JSON.stringify(result),
      c.get("projectContext").requestId,
    ),
    c.env.DB.prepare(
      "INSERT INTO idempotency_keys (project_id, key, response_json, status_code) VALUES (?, ?, ?, 200)",
    ).bind(projectId, key, response),
  ]);
  return new Response(response, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function bodyObject(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > 65_536)
    throw new AppError("payload_too_large", "Request body exceeds 64 KiB", 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw new AppError(
          "payload_too_large",
          "Request body exceeds 64 KiB",
          413,
        );
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new AppError(
      "invalid_json",
      "Request body must be valid UTF-8 JSON",
      400,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(
      "invalid_request",
      "Request body must be an object",
      422,
    );
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max)
    throw new AppError("validation_failed", `${field} is required`, 422, {
      field,
    });
  return result;
}
function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max)
    throw new AppError("validation_failed", "Invalid text value", 422);
  return value.trim();
}
function optionalEnum(
  value: unknown,
  allowed: readonly string[],
): string | null {
  const result = optionalText(value, 64);
  if (result && !allowed.includes(result))
    throw new AppError("validation_failed", "Unsupported value", 422, {
      allowed,
    });
  return result;
}
function requiredEnum(value: unknown, allowed: readonly string[]): string {
  const result = text(value, "type", 64);
  if (!allowed.includes(result))
    throw new AppError("validation_failed", "Unsupported value", 422, {
      allowed,
    });
  return result;
}
function nonNegativeInteger(value: unknown) {
  if (value === undefined || value === null || value === "") return 0;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new AppError(
      "validation_failed",
      "Expected a non-negative integer",
      422,
    );
  return result;
}
function jsonObject(value: unknown) {
  if (value === undefined || value === null) return "{}";
  if (typeof value !== "object" || Array.isArray(value))
    throw new AppError(
      "validation_failed",
      "attributes must be an object",
      422,
    );
  return JSON.stringify(value);
}
function platformParam(value: string): "ios" | "android" | "web" {
  if (!(["ios", "android", "web"] as string[]).includes(value))
    throw new AppError(
      "platform_invalid",
      "Platform must be ios, android or web",
      422,
    );
  return value as "ios" | "android" | "web";
}

function applicationUserId(value: string): string {
  const resolved = value.trim();
  if (
    !resolved ||
    resolved.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(resolved)
  ) {
    throw new AppError(
      "application_user_id_invalid",
      "Application user identifier is invalid",
      422,
    );
  }
  return resolved;
}
function validateConfiguration(platform: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(
      "configuration_invalid",
      "Configuration must be an object",
      422,
    );
  const body = value as Record<string, unknown>;
  const forbidden = forbiddenConfigurationFields(body);
  if (forbidden.length)
    throw new AppError(
      "configuration_secret_forbidden",
      "SDK configuration accepts secret references only, never credential values",
      422,
      { forbidden },
    );
  for (const field of [
    "push_credential_reference",
    "store_credential_reference",
  ]) {
    const reference = body[field];
    if (reference === undefined || reference === null || reference === "")
      continue;
    if (
      typeof reference !== "string" ||
      !/^(?:secret|provider|operator):\/{2}[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/.test(
        reference,
      )
    )
      throw new AppError(
        "configuration_secret_reference_invalid",
        `${field} must be an opaque secret reference`,
        422,
      );
  }
  const required =
    platform === "ios"
      ? ["bundle_id", "team_id"]
      : platform === "android"
        ? ["package_name", "sha256"]
        : ["domain"];
  const missing = required.filter(
    (field) => typeof body[field] !== "string" || !String(body[field]).trim(),
  );
  if (missing.length)
    throw new AppError(
      "configuration_invalid",
      "Configuration is incomplete",
      422,
      { missing },
    );
  if (
    body.maintenance_enabled !== undefined &&
    typeof body.maintenance_enabled !== "boolean"
  )
    throw new AppError(
      "configuration_invalid",
      "maintenance_enabled must be a boolean",
      422,
    );
  const minimumVersion = semanticVersion(
    body.minimum_version,
    "minimum_version",
  );
  const recommendedVersion = semanticVersion(
    body.recommended_version,
    "recommended_version",
  );
  if (
    minimumVersion &&
    recommendedVersion &&
    compareVersions(recommendedVersion, minimumVersion) < 0
  )
    throw new AppError(
      "configuration_invalid",
      "recommended_version must be greater than or equal to minimum_version",
      422,
    );
  const maintenanceMessage = optionalText(body.maintenance_message, 500);
  if (body.maintenance_enabled === true && !maintenanceMessage)
    throw new AppError(
      "configuration_invalid",
      "maintenance_message is required while maintenance is enabled",
      422,
    );
  safeHttpsUrl(body.store_url, "store_url");
}

function forbiddenConfigurationFields(
  value: unknown,
  path = "configuration",
  depth = 0,
): string[] {
  if (depth > 12) return [path];
  if (!value || typeof value !== "object") return [];
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  const forbidden: string[] = [];
  for (const [field, child] of entries) {
    const childPath = `${path}.${field}`;
    if (/(?:secret|password|private[_-]?key|credential)$/i.test(field)) {
      forbidden.push(childPath);
    }
    forbidden.push(
      ...forbiddenConfigurationFields(child, childPath, depth + 1),
    );
  }
  return forbidden;
}

function semanticVersion(
  value: unknown,
  field: string,
  required = false,
): string | null {
  const version = optionalText(value, 64);
  if (!version && !required) return null;
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new AppError(
      "configuration_invalid",
      `${field} must be a semantic version`,
      422,
    );
  return version;
}

function compareVersions(left: string, right: string): number {
  const numbers = (value: string) =>
    value
      .split("-", 1)[0]!
      .split(".")
      .map((part) => Number(part));
  const a = numbers(left);
  const b = numbers(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  if (left.includes("-") !== right.includes("-"))
    return left.includes("-") ? -1 : 1;
  return left.localeCompare(right);
}

function safeHttpsUrl(value: unknown, field: string): string | null {
  const textValue = optionalText(value, 2_048);
  if (!textValue) return null;
  let url: URL;
  try {
    url = new URL(textValue);
  } catch {
    throw new AppError(
      "configuration_invalid",
      `${field} must be an HTTPS URL`,
      422,
    );
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password
  )
    throw new AppError(
      "configuration_invalid",
      `${field} must be an HTTPS URL`,
      422,
    );
  return url.toString();
}
function statisticsFilters(query: Record<string, string>) {
  const now = new Date();
  const before = new Date(now.getTime() - 29 * 86_400_000);
  const from = query.from
    ? validDate(query.from, "from")
    : before.toISOString().slice(0, 10);
  const to = query.to
    ? validDate(query.to, "to")
    : now.toISOString().slice(0, 10);
  if (from > to)
    throw new AppError("date_range_invalid", "from must be before to", 422);
  const platform = optionalEnum(query.platform, ["ios", "android", "web"]);
  const timezone = validTimezone(query.timezone || "UTC");
  const interval = requiredEnum(query.interval || "day", ["day"]);
  return {
    from,
    to,
    timezone,
    interval,
    platform,
    from_utc: zonedDateStartUtc(from, timezone),
    to_exclusive_utc: zonedDateStartUtc(nextDate(to), timezone),
  };
}
function publicStatisticsFilters(
  filters: ReturnType<typeof statisticsFilters>,
) {
  return {
    from: filters.from,
    to: filters.to,
    timezone: filters.timezone,
    interval: filters.interval,
    platform: filters.platform,
  };
}
function validDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError("date_invalid", `${field} must use YYYY-MM-DD`, 422, {
      field,
    });
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new AppError("date_invalid", `${field} is not a calendar date`, 422, {
      field,
    });
  return value;
}
function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    throw new AppError(
      "timezone_invalid",
      "timezone must be a valid IANA timezone",
      422,
      { field: "timezone" },
    );
  }
}
function zonedDateStartUtc(value: string, timezone: string) {
  const [year, month, day] = value.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const rendered = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    guess -= rendered - desired;
  }
  return new Date(guess).toISOString();
}
function optionalIsoTimestamp(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  return isoTimestamp(value, field);
}
function isoTimestamp(value: unknown, field: string) {
  const textValue = text(value, field, 64);
  const legacy = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(
    textValue,
  );
  const iso =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      textValue,
    );
  if (!legacy && !iso)
    throw new AppError(
      "timestamp_invalid",
      `${field} must be ISO-8601 or legacy UTC YYYY-MM-DD HH:mm:ss`,
      422,
      { field },
    );
  const parsed = new Date(
    legacy ? `${textValue.replace(" ", "T")}Z` : textValue,
  );
  if (!Number.isFinite(parsed.getTime()))
    throw new AppError(
      "timestamp_invalid",
      `${field} must be a valid timestamp`,
      422,
      { field },
    );
  return parsed.toISOString();
}
function nextDate(value: string) {
  const result = new Date(`${value}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + 1);
  return result.toISOString().slice(0, 10);
}
function integerQuery(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new AppError("pagination_invalid", "Invalid pagination value", 422);
  return parsed;
}
async function count(
  db: D1Database,
  table: "customers" | "referrals",
  projectId: string,
) {
  const row = await db
    .prepare(`SELECT COUNT(*) count FROM ${table} WHERE project_id=?`)
    .bind(projectId)
    .first<{ count: number }>();
  return Number(row?.count || 0);
}
async function assertOwnedCustomer(
  db: D1Database,
  projectId: string,
  id: string | null,
) {
  if (!id) return;
  if (
    !(await db
      .prepare("SELECT id FROM customers WHERE project_id=? AND id=?")
      .bind(projectId, id)
      .first())
  )
    throw new AppError("customer_not_found", "Customer was not found", 404);
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
function randomToken(prefix: string, size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return (
    prefix +
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}
async function sha256(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export default app;
