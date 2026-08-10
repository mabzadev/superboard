import { Hono } from "hono";
import {
  OBSERVABILITY_SUMMARY_PATH,
  type ObservabilitySummary,
} from "@opengrow/contracts/observability";
import {
  inspectSqlSchemaHealth,
  type SqlSchemaHealth,
} from "@opengrow/contracts/health";
import {
  CUSTOM_WORKER_JOB_PATH,
  CUSTOM_WORKER_MANIFEST_PATH,
  CUSTOM_WORKER_PROTOCOL_VERSION,
  CUSTOM_WORKER_STATS_PATH,
  type CustomWorkerManifest,
  type CustomWorkerStats,
} from "@opengrow/contracts/custom-worker";
import { getAuthContext } from "../lib/auth";
import { readJsonObjectLimited, readTextLimited } from "../lib/http-limits";
import type { Env } from "../types";
import sdkCatalog from "../../../../config/sdk-libraries.json";
import flutterFlowCustomCode from "../../../../config/flutterflow-custom-code.json";
import flutterFlowLibrary from "../../../../config/flutterflow-library.json";

const platform = new Hono<{ Bindings: Env }>();

const OBSERVABILITY_SUMMARY_MAX_BYTES = 512 * 1024;
const CUSTOM_MANIFEST_MAX_BYTES = 64 * 1024;
const CUSTOM_STATS_MAX_BYTES = 512 * 1024;
const CUSTOM_PROXY_MAX_BYTES = 2 * 1024 * 1024;
const MAX_PUBLIC_SURFACE_MONITORS = 20;

const SERVICES = [
  [
    "billing",
    "BILLING",
    "/internal/v1/health",
    "Purchases, entitlements, stores and billing jobs",
  ],
  [
    "messaging",
    "MESSAGING",
    "/health",
    "Legacy Messaging runtime (disabled after Support convergence)",
  ],
  [
    "email",
    "EMAIL_SERVICE",
    "/health",
    "Transactional and marketing email delivery",
  ],
  [
    "identity",
    "IDENTITY_SERVICE",
    "/health",
    "Application users, email/password, Google/Apple federation and OpenGrow identity exchange",
  ],
  [
    "files",
    "FILES_SERVICE",
    "/health",
    "Authenticated application file upload, metadata, download and deletion",
  ],
  [
    "app",
    "APP_MODULE",
    "/internal/v1/health",
    "Customers, referrals and application configuration",
  ],
  [
    "products",
    "PRODUCTS_MODULE",
    "/internal/v1/health",
    "Product catalogue, offerings and entitlements",
  ],
  [
    "paywalls",
    "PAYWALLS_MODULE",
    "/internal/v1/health",
    "Paywall definitions, versions and analytics",
  ],
  [
    "dynamic-links",
    "DYNAMIC_LINKS_MODULE",
    "/internal/v1/health",
    "Short links, redirects and attribution",
  ],
  [
    "support",
    "SUPPORT_MODULE",
    "/internal/v1/health",
    "Unified inbox, contacts and support workflows",
  ],
  [
    "marketing",
    "MARKETING_MODULE",
    "/internal/v1/health",
    "Contacts, consent, templates and campaigns",
  ],
  [
    "onboardings",
    "ONBOARDINGS_MODULE",
    "/internal/v1/health",
    "Onboarding flows and completion analytics",
  ],
  [
    "custom",
    "CUSTOM_WORKER",
    "/health",
    "Application-specific jobs and integrations",
  ],
] as const;

const API_CAPABILITIES = [
  {
    id: "identity",
    description:
      "Authentication, OAuth, Google/Apple federation, sessions and roles",
    access: "Application identity, Dashboard session, or OAuth client",
    entrypoints: [
      "/auth/*",
      "/api/v1/auth/*",
      "/api/v1/users/*",
      "/api/v1/identity/sso/*",
      "/oauth/*",
    ],
  },
  {
    id: "projects",
    description:
      "Applications, environments, access keys and SDK configuration",
    access: "Authenticated Dashboard administrator",
    entrypoints: [
      "/api/v1/instances/*",
      "/api/v1/projects/*",
      "/api/v1/links/*",
      "/api/v1/analytics/*",
    ],
  },
  {
    id: "files",
    description:
      "Authenticated upload, storage metadata and controlled downloads",
    access: "Application JWT on the Files domain or API alias",
    entrypoints: ["Files domain /v1/files/*", "/api/v1/app-files/*"],
  },
  {
    id: "notifications",
    description: "Push targets, notification delivery and inbox state",
    access: "Application SDK or authenticated project administrator",
    entrypoints: [
      "/api/v1/sdk/notifications*",
      "/api/v1/push/*",
      "/api/v1/projects/:id/notifications/*",
    ],
  },
  {
    id: "billing",
    description: "Purchases, subscriptions, entitlements, restores and refunds",
    access: "Application SDK, provider webhook, or project administrator",
    entrypoints: ["/api/v1/iap/*", "/api/v1/billing/*", "/api/v2/purchases/*"],
  },
  {
    id: "custom-jobs",
    description:
      "Application-authenticated creation, project/owner-scoped status and safe pre-processing cancellation for app-specific jobs",
    access:
      "Application JWT for owned jobs and cancellation; retries require a Dashboard administrator",
    entrypoints: ["/api/v1/sdk/custom/v1/jobs*", "/api/v1/platform/custom/*"],
  },
  {
    id: "marketing-consent",
    description:
      "Authenticated newsletter consent and public subscription-list preferences",
    access:
      "Verified application identity; private signed gateway to Marketing",
    entrypoints: ["/api/v1/sdk/marketing/v1/preferences"],
  },
  {
    id: "support",
    description:
      "Conversations, contacts, attachments, realtime orchestration and CSAT",
    access: "Application JWT or authenticated project administrator",
    entrypoints: [
      "/api/v1/support-client/*",
      "/api/v1/support/*",
      "/api/v1/support/realtime/:ticket",
    ],
  },
  {
    id: "modules",
    description: "Private gateway for enabled OpenGrow feature Workers",
    access: "Authenticated project context signed by the API gateway",
    entrypoints: [
      "/api/v1/app/*",
      "/api/v1/products/*",
      "/api/v1/paywalls/*",
      "/api/v1/dynamic-links/*",
      "/api/v1/marketing/*",
      "/api/v1/onboardings/*",
    ],
  },
  {
    id: "platform",
    description:
      "Infrastructure health, runtime metrics, jobs and data inventory",
    access: "Authenticated Dashboard administrator",
    entrypoints: [
      "/health",
      "/api/v1/platform/status",
      "/api/v1/platform/account-erasures",
    ],
  },
  {
    id: "libraries",
    description:
      "Git-owned SDK releases, FlutterFlow custom code and immutable installation references",
    access: "Authenticated Dashboard administrator",
    entrypoints: ["/api/v1/platform/libraries"],
  },
  {
    id: "mcp",
    description:
      "OAuth-protected infrastructure status and operator tools over stateless Streamable HTTP",
    access: "OAuth bearer token with operator consent",
    entrypoints: ["MCP domain /mcp", "/api/v1/mcp/*", "/oauth/*"],
  },
] as const;

platform.get("/libraries", async (c) => {
  const denial = await platformAdminDenial(
    c.env,
    c.req.header("Authorization"),
  );
  if (denial) return c.json({ error: denial.error }, denial.status);
  return c.json(
    {
      data: {
        ...sdkCatalog,
        customCode: flutterFlowCustomCode,
        flutterFlowLibrary,
      },
    },
    200,
    { "cache-control": "no-store" },
  );
});

platform.get("/account-erasures", async (c) => {
  const admin = await platformAdminContext(
    c.env,
    c.req.header("Authorization"),
  );
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const status = String(c.req.query("status") || "").trim();
  if (status && !["processing", "failed", "completed"].includes(status)) {
    return c.json({ error: "status_invalid" }, 422);
  }
  const projectValue = String(c.req.query("project_id") || "").trim();
  const projectId = projectValue ? Number(projectValue) : null;
  if (
    projectId !== null &&
    (!Number.isSafeInteger(projectId) || projectId <= 0)
  ) {
    return c.json({ error: "project_id_invalid" }, 422);
  }
  const requestedLimit = Number(c.req.query("limit") || 50);
  if (
    !Number.isSafeInteger(requestedLimit) ||
    requestedLimit <= 0 ||
    requestedLimit > 100
  ) {
    return c.json({ error: "limit_invalid" }, 422);
  }
  const limit = requestedLimit;
  const rows = await c.env.DB.prepare(
    `SELECT erasure.id, erasure.project_id, erasure.project_ref,
       erasure.application_user_hash, erasure.status,
       erasure.completed_steps_json, erasure.attempts,
       erasure.last_error_code, erasure.last_error_service,
       erasure.requested_at, erasure.updated_at, erasure.completed_at
     FROM application_account_erasures erasure
     INNER JOIN projects project ON project.id = erasure.project_id
     WHERE project.instance_id = ?
       AND (? = '' OR erasure.status = ?)
       AND (? IS NULL OR erasure.project_id = ?)
     ORDER BY erasure.requested_at DESC LIMIT ?`,
  )
    .bind(admin.instanceId, status, status, projectId, projectId, limit)
    .all<Record<string, unknown>>();
  return c.json(
    {
      data: rows.results.map((row) => ({
        id: String(row.id),
        projectId: Number(row.project_id),
        projectRef: String(row.project_ref),
        subjectReference: String(row.application_user_hash).slice(0, 12),
        status: String(row.status),
        completedSteps: accountErasureSteps(row.completed_steps_json),
        attempts: Number(row.attempts || 0),
        lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
        lastErrorService: row.last_error_service
          ? String(row.last_error_service)
          : null,
        requestedAt: String(row.requested_at),
        updatedAt: String(row.updated_at),
        completedAt: row.completed_at ? String(row.completed_at) : null,
      })),
    },
    200,
    { "cache-control": "private, no-store" },
  );
});

platform.get("/status", async (c) => {
  const denial = await platformAdminDenial(
    c.env,
    c.req.header("Authorization"),
  );
  if (denial) return c.json({ error: denial.error }, denial.status);

  return c.json(await buildPlatformStatus(c.env), 200, {
    "cache-control": "no-store",
  });
});

export async function buildPlatformStatus(env: Env) {
  const started = Date.now();
  const [
    serviceChecks,
    metrics,
    platformJobs,
    runtime,
    custom,
    publicSurfaces,
    centralSchema,
  ] = await Promise.all([
    Promise.all(
      SERVICES.map(([id, binding, path, description]) =>
        checkService(env, id, binding, path, description),
      ),
    ),
    platformMetrics(env.DB),
    jobMetrics(env.DB),
    runtimeMetrics(env),
    customOverview(env),
    publicSurfaceHealth(env.PUBLIC_SURFACES_JSON),
    inspectSqlSchemaHealth(env.DB, env.D1_EXPECTED_MIGRATION).catch(() => null),
  ]);
  const services = [runtime.service, ...serviceChecks];
  const serviceJobs = serviceJobMetrics(serviceChecks);
  const dataStores = dataStoreInventory(
    env,
    serviceChecks,
    metrics,
    centralSchema,
  );
  const apiStatus =
    Object.values(metrics).every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) && centralSchema?.status === "current"
      ? "ok"
      : "degraded";
  const unavailable =
    services.filter(
      (service) => service.status !== "ok" && service.status !== "disabled",
    ).length +
    publicSurfaces.filter((surface) => surface.status !== "ok").length +
    (custom.status === "ok" || custom.status === "disabled" ? 0 : 1) +
    dataStores.filter(
      (store) =>
        !["ok", "configured", "declared", "disabled"].includes(store.status),
    ).length +
    (jobVisibilityUnavailable(platformJobs, serviceChecks, serviceJobs)
      ? 1
      : 0) +
    (securityStateDegraded(platformJobs.pushCredentials, [
      "legacyPlaintext",
      "missing",
    ])
      ? 1
      : 0) +
    (securityStateDegraded(platformJobs.bearerTokenStorage, ["legacyPlaintext"])
      ? 1
      : 0) +
    (securityStateDegraded(platformJobs.authCredentials, ["legacyPlaintext"])
      ? 1
      : 0);
  return {
    status: unavailable === 0 ? "ok" : "degraded",
    environment: env.ENVIRONMENT,
    generatedAt: new Date().toISOString(),
    responseTimeMs: Date.now() - started,
    deployment: {
      target: env.OPENGROW_TARGET || "unknown",
      release: env.OPENGROW_RELEASE || "unknown",
      publicRouting: env.PUBLIC_ROUTING_MODE || "unknown",
    },
    endpoints: {
      api: `https://${env.API_DOMAIN}`,
      sdk: `https://${env.SDK_DOMAIN}`,
      shortLinks: `https://${env.SHORTLINK_DOMAIN}`,
      dashboard: env.APP_URL,
      files: env.FILES_DOMAIN ? `https://${env.FILES_DOMAIN}` : null,
      mcp: env.MCP_DOMAIN ? `https://${env.MCP_DOMAIN}` : null,
    },
    api: {
      status: apiStatus,
      description:
        "Authenticated OpenGrow gateway, orchestration and public SDK surface",
      capabilities: API_CAPABILITIES,
    },
    publicSurfaces,
    services,
    dataStores,
    custom,
    metrics: {
      ...metrics,
      applicationUsers: custom.stats?.users?.total ?? null,
      premiumApplicationUsers: custom.stats?.users?.premium ?? null,
    },
    jobs: {
      ...platformJobs,
      ...serviceJobs,
      custom: custom.stats?.jobs ?? null,
    },
    runtime: runtime.summary,
  };
}

type PublicSurfaceDefinition = {
  id: string;
  url: string;
  healthUrl?: string;
  description: string;
};

async function publicSurfaceHealth(raw: string | undefined) {
  if (!raw) return [];
  let definitions: unknown[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > MAX_PUBLIC_SURFACE_MONITORS) {
      throw new Error("monitor list is invalid");
    }
    definitions = parsed;
  } catch {
    return [publicSurfaceConfigurationError("PUBLIC_SURFACES_JSON is invalid")];
  }
  const ids = new Set<string>();
  return Promise.all(
    definitions.map((definition) => {
      if (!isPublicSurfaceDefinition(definition)) {
        return checkPublicSurface(definition);
      }
      if (ids.has(definition.id)) {
        return Promise.resolve(
          publicSurfaceConfigurationError(
            `Public surface monitor ${definition.id} is duplicated`,
          ),
        );
      }
      ids.add(definition.id);
      return checkPublicSurface(definition);
    }),
  );
}

async function checkPublicSurface(definition: unknown) {
  const started = Date.now();
  if (!isPublicSurfaceDefinition(definition)) {
    return publicSurfaceConfigurationError(
      "Monitor requires an id, description and absolute HTTPS URLs",
    );
  }
  const publicUrl = safeHttpsUrl(definition.url);
  const healthUrl = safeHttpsUrl(definition.healthUrl ?? definition.url);
  if (!publicUrl || !healthUrl || publicUrl.origin !== healthUrl.origin) {
    return {
      id: definition.id,
      url: publicUrl?.toString() ?? null,
      status: "misconfigured",
      description: definition.description,
      responseTimeMs: null,
      httpStatus: null,
      error: "Monitor requires credential-free public HTTPS URLs on one origin",
    };
  }
  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/json,text/html;q=0.8" },
      signal: AbortSignal.timeout(3_000),
    });
    await response.body?.cancel().catch(() => undefined);
    const reachable =
      (response.status >= 200 && response.status < 400) ||
      response.status === 401 ||
      response.status === 403;
    return {
      id: definition.id,
      url: publicUrl.toString().replace(/\/$/, ""),
      status: reachable ? "ok" : "degraded",
      description: definition.description,
      responseTimeMs: Date.now() - started,
      httpStatus: response.status,
    };
  } catch {
    return {
      id: definition.id,
      url: publicUrl.toString().replace(/\/$/, ""),
      status: "unavailable",
      description: definition.description,
      responseTimeMs: Date.now() - started,
      httpStatus: null,
      error: "Public health request failed",
    };
  }
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const unsafeHostname =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.startsWith("[") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname);
    return url.protocol === "https:" &&
      hostname &&
      !unsafeHostname &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443")
      ? url
      : null;
  } catch {
    return null;
  }
}

function isPublicSurfaceDefinition(
  value: unknown,
): value is PublicSurfaceDefinition {
  return (
    record(value) &&
    typeof value.id === "string" &&
    /^[a-z][a-z0-9-]{1,50}$/u.test(value.id) &&
    typeof value.url === "string" &&
    (value.healthUrl === undefined || typeof value.healthUrl === "string") &&
    typeof value.description === "string" &&
    value.description.length > 0 &&
    value.description.length <= 300
  );
}

function publicSurfaceConfigurationError(error: string) {
  return {
    id: "configuration",
    url: null,
    status: "misconfigured",
    description: "Public surface monitoring configuration",
    responseTimeMs: null,
    httpStatus: null,
    error,
  };
}

platform.get("/custom/stats", async (c) => {
  const denial = await platformAdminDenial(
    c.env,
    c.req.header("Authorization"),
  );
  if (denial) return c.json({ error: denial.error }, denial.status);
  return proxyCustom(c.env, CUSTOM_WORKER_STATS_PATH);
});

platform.get("/custom/jobs", async (c) => {
  const denial = await platformAdminDenial(
    c.env,
    c.req.header("Authorization"),
  );
  if (denial) return c.json({ error: denial.error }, denial.status);
  return proxyCustom(
    c.env,
    `${CUSTOM_WORKER_JOB_PATH}${new URL(c.req.url).search}`,
  );
});

platform.post("/custom/jobs/:jobId/retry", async (c) => {
  const denial = await platformAdminDenial(
    c.env,
    c.req.header("Authorization"),
  );
  if (denial) return c.json({ error: denial.error }, denial.status);
  const jobId = encodeURIComponent(c.req.param("jobId"));
  return proxyCustom(c.env, `${CUSTOM_WORKER_JOB_PATH}/${jobId}/retry`, {
    method: "POST",
  });
});

platform.get("/custom/jobs/:jobId", async (c) => {
  const denial = await platformAdminDenial(
    c.env,
    c.req.header("Authorization"),
  );
  if (denial) return c.json({ error: denial.error }, denial.status);
  return proxyCustom(
    c.env,
    `${CUSTOM_WORKER_JOB_PATH}/${encodeURIComponent(c.req.param("jobId"))}`,
  );
});

async function checkService(
  env: Env,
  id: string,
  bindingName: (typeof SERVICES)[number][1],
  path: string,
  description: string,
) {
  const binding = env[bindingName];
  if (!binding)
    return { id, status: "disabled", description, responseTimeMs: null };
  const started = Date.now();
  try {
    const response = await binding.fetch(`https://${id}.internal${path}`, {
      signal: AbortSignal.timeout(3_000),
    });
    const text = await readTextLimited(
      response,
      16_384,
      "Service health response is too large",
    );
    let detail: unknown = null;
    try {
      detail = text ? JSON.parse(text) : null;
    } catch {
      detail = { message: text };
    }
    const reportedStatus = serviceReportedStatus(detail);
    return {
      id,
      status: response.ok ? reportedStatus : "degraded",
      description,
      responseTimeMs: Date.now() - started,
      detail,
    };
  } catch (error) {
    return {
      id,
      status: "unavailable",
      description,
      responseTimeMs: Date.now() - started,
      error: error instanceof Error ? error.message : "Service check failed",
    };
  }
}

type ServiceCheck = Awaited<ReturnType<typeof checkService>>;

function serviceJobMetrics(services: ServiceCheck[]) {
  const metrics = (id: string): Record<string, unknown> | null => {
    const detail = services.find((service) => service.id === id)?.detail;
    if (!detail || typeof detail !== "object") return null;
    const root = detail as Record<string, unknown>;
    const data =
      root.data && typeof root.data === "object"
        ? (root.data as Record<string, unknown>)
        : root;
    return data.metrics && typeof data.metrics === "object"
      ? (data.metrics as Record<string, unknown>)
      : null;
  };
  const email = metrics("email");
  const marketing = metrics("marketing");
  const support = metrics("support");

  return {
    email: selectMetrics(email, {
      messagesQueued: ["messages", "queued"],
      messagesSending: ["messages", "sending"],
      messagesFailed: ["messages", "failed"],
      deliveriesQueued: ["deliveries", "queued"],
      deliveriesSending: ["deliveries", "sending"],
      deliveriesFailed: ["deliveries", "failed"],
      deadLettersQuarantined: ["deadLetters", "quarantined"],
    }),
    marketing: selectMetrics(marketing, {
      campaignsScheduled: ["content", "scheduled"],
      campaignsRunning: ["content", "running"],
      deliveriesPending: ["deliveries", "pending"],
      deliveriesSending: ["deliveries", "sending"],
      deliveriesFailed: ["deliveries", "failed"],
      deliveriesBounced: ["deliveries", "bounced"],
      deliveriesComplained: ["deliveries", "complained"],
      outboxPending: ["outbox", "pending"],
      outboxDeadLetter: ["outbox", "deadLetter"],
      deadLettersQuarantined: ["deadLetters", "quarantined"],
    }),
    support: selectMetrics(support, {
      webhooksPending: ["webhooks", "pending"],
      webhooksFailed: ["webhooks", "failed"],
      deadLettersQuarantined: ["deadLetters", "quarantined"],
    }),
  };
}

type ServiceJobMetrics = ReturnType<typeof serviceJobMetrics>;

function selectMetrics(
  source: Record<string, unknown> | null,
  selectors: Record<string, readonly [string, string]>,
): Record<string, number> | null {
  if (!source) return null;
  const selected: Record<string, number> = {};
  for (const [output, [groupName, metricName]] of Object.entries(selectors)) {
    const group = source[groupName];
    if (!record(group)) return null;
    const value = group[metricName];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    selected[output] = value;
  }
  return selected;
}

function jobVisibilityUnavailable(
  platformJobs: Record<string, Record<string, number> | null>,
  services: ServiceCheck[],
  serviceJobs: ServiceJobMetrics,
) {
  if (Object.values(platformJobs).some((metrics) => metrics === null)) {
    return true;
  }
  return Object.entries(serviceJobs).some(([id, metrics]) => {
    const service = services.find((candidate) => candidate.id === id);
    return service?.status === "ok" && metrics === null;
  });
}

function securityStateDegraded(
  metrics: Record<string, number> | null,
  unsafeStates: string[],
): boolean {
  if (!metrics) return true;
  return unsafeStates.some((state) => Number(metrics[state] || 0) > 0);
}

function dataStoreInventory(
  env: Env,
  services: ServiceCheck[],
  metrics: Record<string, number | null>,
  centralSchema: SqlSchemaHealth | null,
) {
  const serviceStatus = (owner: string) =>
    services.find((service) => service.id === owner)?.status ?? "disabled";
  const serviceSchema = (owner: string) =>
    reportedSchema(
      services.find((service) => service.id === owner)?.detail ?? null,
    );
  const d1Status = (owner: string) => {
    const status = serviceStatus(owner);
    if (status !== "ok") return status;
    return serviceSchema(owner)?.status === "current" ? "ok" : "degraded";
  };
  const apiDatabaseStatus =
    Object.values(metrics).some((value) => value === null) ||
    centralSchema?.status !== "current"
      ? "degraded"
      : "ok";
  const store = (
    id: string,
    kind: "D1" | "KV" | "R2" | "Durable Object",
    owner: string,
    status: string,
    description: string,
    schema?: SqlSchemaHealth | null,
  ) => ({
    id,
    kind,
    owner,
    status,
    description,
    ...(kind === "D1" ? { schema: schema ?? null } : {}),
  });
  const d1Store = (id: string, owner: string, description: string) =>
    store(id, "D1", owner, d1Status(owner), description, serviceSchema(owner));
  return [
    store(
      "central",
      "D1",
      "api",
      apiDatabaseStatus,
      "Administrators, projects, OAuth, notifications and the converging billing ledger",
      centralSchema,
    ),
    store(
      "configuration",
      "KV",
      "api",
      env.KV ? "configured" : "unavailable",
      "Ephemeral configuration, cache and coordination",
    ),
    store(
      "application-files",
      "R2",
      "files",
      env.R2 ? "configured" : "unavailable",
      "Application uploads and controlled downloads",
    ),
    d1Store(
      "identity",
      "identity",
      "Application users, federated identities, sessions and refresh tokens",
    ),
    d1Store(
      "file-metadata",
      "files",
      "File ownership, metadata, retention and deletion state",
    ),
    d1Store(
      "email",
      "email",
      "Transactional messages, capture previews and delivery attempts",
    ),
    d1Store(
      "app",
      "app",
      "Customers, referrals, access keys, SDK configuration and events",
    ),
    d1Store(
      "products",
      "products",
      "Products, offerings, entitlements, purchases and refunds",
    ),
    d1Store(
      "paywalls",
      "paywalls",
      "Paywalls, placements, variants, versions and events",
    ),
    d1Store(
      "dynamic-links",
      "dynamic-links",
      "Short links, campaigns, domains, redirects and attribution",
    ),
    d1Store(
      "support",
      "support",
      "Contacts, conversations, messages, automations and CSAT",
    ),
    store(
      "support-attachments",
      "R2",
      "support",
      serviceStatus("support"),
      "Support attachments migrated from Chatwoot and created in OpenGrow",
    ),
    store(
      "support-realtime",
      "Durable Object",
      "support",
      serviceStatus("support"),
      "Realtime conversation rooms and connection coordination",
    ),
    d1Store(
      "marketing",
      "marketing",
      "Consent, lists, segments, templates, campaigns and deliveries",
    ),
    store(
      "marketing-media",
      "R2",
      "marketing",
      serviceStatus("marketing"),
      "Media used by campaigns and email templates",
    ),
    d1Store(
      "onboardings",
      "onboardings",
      "Onboarding flows, targeting, versions and completion events",
    ),
    d1Store(
      "custom",
      "custom",
      "Application-specific durable jobs, receipts and integration state",
    ),
    store(
      "dashboard-cache",
      "R2",
      "dashboard",
      "declared",
      "OpenNext incremental cache; verified by the Dashboard Worker deployment",
    ),
  ];
}

function reportedSchema(detail: unknown): SqlSchemaHealth | null {
  if (!detail || typeof detail !== "object") return null;
  const root = detail as Record<string, unknown>;
  const value =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>).schema
      : root.schema;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const schema = value as Record<string, unknown>;
  const status = String(schema.status || "");
  const expectedMigration = String(schema.expectedMigration || "");
  const latestMigration =
    schema.latestMigration === null
      ? null
      : String(schema.latestMigration || "");
  const appliedMigrationCount = Number(schema.appliedMigrationCount);
  if (
    !["current", "behind", "drifted"].includes(status) ||
    !/^\d+[a-z0-9_-]*\.sql$/iu.test(expectedMigration) ||
    (latestMigration !== null &&
      !/^\d+[a-z0-9_-]*\.sql$/iu.test(latestMigration)) ||
    !Number.isSafeInteger(appliedMigrationCount) ||
    appliedMigrationCount < 0
  ) {
    return null;
  }
  return {
    status: status as SqlSchemaHealth["status"],
    expectedMigration,
    latestMigration,
    appliedMigrationCount,
  };
}

function serviceReportedStatus(detail: unknown) {
  if (!detail || typeof detail !== "object") return "degraded";
  const record = detail as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>).status
      : null;
  const value = String(nested ?? record.status ?? "");
  return ["ok", "degraded", "unavailable", "misconfigured"].includes(value)
    ? value
    : "degraded";
}

async function runtimeMetrics(env: Env): Promise<{
  service: {
    id: string;
    status: string;
    description: string;
    responseTimeMs: number | null;
    detail?: unknown;
    error?: string;
  };
  summary: ObservabilitySummary | null;
}> {
  const description =
    "Cloudflare invocation, outcome, exception, CPU and wall-time telemetry";
  if (!env.OBSERVABILITY) {
    return {
      service: {
        id: "observability",
        status: "disabled",
        description,
        responseTimeMs: null,
      },
      summary: null,
    };
  }
  if (!env.OBSERVABILITY_INTERNAL_TOKEN) {
    return {
      service: {
        id: "observability",
        status: "misconfigured",
        description,
        responseTimeMs: null,
        error: "Internal token missing",
      },
      summary: null,
    };
  }
  const started = Date.now();
  try {
    const response = await env.OBSERVABILITY.fetch(
      `https://observability.internal${OBSERVABILITY_SUMMARY_PATH}?window=60`,
      {
        headers: { "x-observability-token": env.OBSERVABILITY_INTERNAL_TOKEN },
        signal: AbortSignal.timeout(6_000),
      },
    );
    const summaryValue = await readJsonObjectLimited(
      response,
      OBSERVABILITY_SUMMARY_MAX_BYTES,
      "Observability summary response is too large",
    );
    if (!isObservabilitySummary(summaryValue)) {
      throw new Error("Observability returned an invalid summary contract");
    }
    const summary = summaryValue;
    return {
      service: {
        id: "observability",
        status: response.ok && summary.status === "ok" ? "ok" : summary.status,
        description,
        responseTimeMs: Date.now() - started,
        detail: {
          dataset: summary.dataset,
          windowMinutes: summary.windowMinutes,
        },
      },
      summary,
    };
  } catch (error) {
    return {
      service: {
        id: "observability",
        status: "unavailable",
        description,
        responseTimeMs: Date.now() - started,
        error:
          error instanceof Error ? error.message : "Runtime metrics failed",
      },
      summary: null,
    };
  }
}

async function platformMetrics(db: D1Database) {
  const queries = {
    users: "SELECT COUNT(*) total FROM users",
    instances: "SELECT COUNT(*) total FROM instances",
    projects: "SELECT COUNT(*) total FROM projects",
    activeOauthTokens:
      "SELECT COUNT(*) total FROM oauth_access_tokens WHERE revoked_at IS NULL",
    pushDevices:
      "SELECT COUNT(*) total FROM devices WHERE push_token IS NOT NULL AND push_token != ''",
    notifications: "SELECT COUNT(*) total FROM notifications",
    notificationMessages: "SELECT COUNT(*) total FROM notification_messages",
    rateLimitedAuthKeys:
      "SELECT COUNT(*) total FROM dashboard_auth_rate_limits WHERE attempt_count > 10 AND datetime(window_started_at) >= datetime('now', '-10 minutes')",
  };
  const entries = await Promise.all(
    Object.entries(queries).map(async ([key, sql]) => {
      const row = await db
        .prepare(sql)
        .first<{ total: number }>()
        .catch(() => null);
      return [key, row ? Number(row.total || 0) : null] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function jobMetrics(db: D1Database) {
  const [
    exports,
    failures,
    deadLetters,
    pushDeliveries,
    pushCredentials,
    bearerTokenStorage,
    authCredentials,
    accountErasures,
  ] = await Promise.all([
    grouped(
      db,
      "SELECT status, COUNT(*) total FROM billing_export_jobs GROUP BY status",
    ),
    grouped(
      db,
      "SELECT status, COUNT(*) total FROM failed_purchase_jobs GROUP BY status",
    ),
    grouped(
      db,
      "SELECT source_queue AS status, COUNT(*) total FROM platform_dead_letters WHERE status = 'quarantined' GROUP BY source_queue",
    ),
    grouped(
      db,
      `SELECT
         CASE
           WHEN COALESCE(delivered, 0) = 1 THEN 'delivered'
           WHEN COALESCE(failed, 0) = 1 THEN 'failed'
           WHEN COALESCE(processing, 0) = 1 AND datetime(updated_at) <= datetime('now', '-15 minutes') THEN 'stale'
           WHEN COALESCE(processing, 0) = 1 THEN 'processing'
           ELSE 'queued'
         END AS status,
         COUNT(*) total
       FROM rpush_notifications
       GROUP BY status`,
    ),
    grouped(
      db,
      `SELECT status, COUNT(*) total
       FROM (
         SELECT CASE
           WHEN apn_key IS NOT NULL OR json_key IS NOT NULL OR access_token IS NOT NULL
             OR certificate IS NOT NULL OR password IS NOT NULL OR auth_key IS NOT NULL OR client_secret IS NOT NULL
             THEN 'legacyPlaintext'
           WHEN type = 'Rpush::Apnsp8::App' AND encrypted_apn_key IS NULL THEN 'missing'
           WHEN type = 'Rpush::Fcm::App' AND encrypted_json_key IS NULL THEN 'missing'
           ELSE 'encrypted'
         END AS status
         FROM rpush_apps
         WHERE type IN ('Rpush::Apnsp8::App', 'Rpush::Fcm::App')
       ) credential_state
       GROUP BY status`,
    ),
    grouped(
      db,
      `SELECT status, COUNT(*) total
       FROM (
         SELECT CASE
           WHEN length(token) = 64 AND token NOT GLOB '*[^a-f0-9]*'
             AND (refresh_token IS NULL OR (length(refresh_token) = 64 AND refresh_token NOT GLOB '*[^a-f0-9]*'))
             THEN 'digested' ELSE 'legacyPlaintext'
           END AS status
         FROM oauth_access_tokens
         UNION ALL
         SELECT CASE
           WHEN length(access_token) = 64 AND access_token NOT GLOB '*[^a-f0-9]*'
             AND (refresh_token IS NULL OR (length(refresh_token) = 64 AND refresh_token NOT GLOB '*[^a-f0-9]*'))
             THEN 'digested' ELSE 'legacyPlaintext'
           END AS status
         FROM mcp_tokens
         UNION ALL
         SELECT CASE
           WHEN length(secret) = 64 AND secret NOT GLOB '*[^a-f0-9]*'
             THEN 'digested' ELSE 'legacyPlaintext'
           END AS status
         FROM oauth_applications
         UNION ALL
         SELECT CASE
           WHEN (reset_password_token IS NULL OR (length(reset_password_token) = 64 AND reset_password_token NOT GLOB '*[^a-f0-9]*'))
             AND (invitation_token IS NULL OR (length(invitation_token) = 64 AND invitation_token NOT GLOB '*[^a-f0-9]*'))
             THEN 'digested' ELSE 'legacyPlaintext'
           END AS status
         FROM users
         WHERE reset_password_token IS NOT NULL OR invitation_token IS NOT NULL
       ) bearer_state
       GROUP BY status`,
    ),
    grouped(
      db,
      `SELECT
         CASE WHEN instr(otp_secret, '.') > 0 THEN 'encrypted' ELSE 'legacyPlaintext' END AS status,
         COUNT(*) total
       FROM users
       WHERE otp_secret IS NOT NULL
       GROUP BY status`,
    ),
    grouped(
      db,
      `SELECT status, COUNT(*) total
       FROM application_account_erasures
       GROUP BY status`,
    ),
  ]);
  return {
    billingExports: exports,
    failedPurchases: failures,
    platformDeadLetters: deadLetters,
    pushDeliveries,
    pushCredentials,
    bearerTokenStorage,
    authCredentials,
    accountErasures,
  };
}

async function grouped(
  db: D1Database,
  sql: string,
): Promise<Record<string, number> | null> {
  try {
    const rows = (
      await db.prepare(sql).all<{ status: string; total: number }>()
    ).results;
    return Object.fromEntries(
      rows.map((row) => [
        String(row.status || "unknown"),
        Number(row.total || 0),
      ]),
    );
  } catch {
    return null;
  }
}

async function customOverview(env: Env): Promise<{
  manifest: unknown;
  stats: CustomWorkerStats | null;
  status: string;
  error?: string;
}> {
  if (!env.CUSTOM_WORKER)
    return { status: "disabled", manifest: null, stats: null };
  if (!env.CUSTOM_WORKER_TOKEN)
    return { status: "misconfigured", manifest: null, stats: null };
  try {
    const [manifestResponse, statsResponse] = await Promise.all([
      customFetch(env, CUSTOM_WORKER_MANIFEST_PATH),
      customFetch(env, CUSTOM_WORKER_STATS_PATH),
    ]);
    if (!manifestResponse.ok || !statsResponse.ok) {
      const manifestValue = manifestResponse.ok
        ? await readJsonObjectLimited(
            manifestResponse,
            CUSTOM_MANIFEST_MAX_BYTES,
            "Custom Worker manifest response is too large",
          )
        : null;
      const statsValue = statsResponse.ok
        ? await readJsonObjectLimited(
            statsResponse,
            CUSTOM_STATS_MAX_BYTES,
            "Custom Worker stats response is too large",
          )
        : null;
      return {
        status: "unavailable",
        manifest: isCustomManifest(manifestValue) ? manifestValue : null,
        stats: isCustomStats(statsValue) ? statsValue : null,
      };
    }
    const [manifestValue, statsValue] = await Promise.all([
      readJsonObjectLimited(
        manifestResponse,
        CUSTOM_MANIFEST_MAX_BYTES,
        "Custom Worker manifest response is too large",
      ),
      readJsonObjectLimited(
        statsResponse,
        CUSTOM_STATS_MAX_BYTES,
        "Custom Worker stats response is too large",
      ),
    ]);
    if (!isCustomManifest(manifestValue)) {
      return {
        status: "incompatible",
        manifest: null,
        stats: null,
        error: "Custom Worker returned an invalid manifest contract",
      };
    }
    const manifest = manifestValue;
    if (!isCustomStats(statsValue)) {
      return {
        status: "incompatible",
        manifest,
        stats: null,
        error: "Custom Worker returned an invalid stats contract",
      };
    }
    const stats = statsValue;
    const target = env.OPENGROW_TARGET || "";
    if (
      !manifest ||
      typeof manifest !== "object" ||
      manifest.protocolVersion !== CUSTOM_WORKER_PROTOCOL_VERSION ||
      !target ||
      manifest.appKey !== target
    ) {
      return {
        status: "incompatible",
        manifest,
        stats,
        error: `Expected custom protocol v${CUSTOM_WORKER_PROTOCOL_VERSION} for ${target || "the configured target"}`,
      };
    }
    return { status: "ok", manifest, stats };
  } catch (error) {
    return {
      status: "unavailable",
      manifest: null,
      stats: null,
      error:
        error instanceof Error ? error.message : "Custom Worker check failed",
    };
  }
}

function isCustomManifest(value: unknown): value is CustomWorkerManifest {
  if (!record(value) || !Array.isArray(value.capabilities)) return false;
  return (
    Number.isSafeInteger(value.protocolVersion) &&
    typeof value.appKey === "string" &&
    typeof value.service === "string" &&
    typeof value.version === "string" &&
    typeof value.description === "string" &&
    value.capabilities.every(
      (capability) =>
        record(capability) &&
        typeof capability.id === "string" &&
        typeof capability.description === "string" &&
        new Set(["request", "queue", "scheduled"]).has(String(capability.mode)),
    )
  );
}

function isObservabilitySummary(value: unknown): value is ObservabilitySummary {
  if (!record(value) || !Array.isArray(value.rows)) return false;
  if (
    !new Set(["ok", "misconfigured", "unavailable"]).has(
      String(value.status),
    ) ||
    typeof value.environment !== "string" ||
    typeof value.dataset !== "string" ||
    ![5, 15, 60, 360, 1440].includes(Number(value.windowMinutes)) ||
    typeof value.generatedAt !== "string"
  ) {
    return false;
  }
  return value.rows.every(
    (row) =>
      record(row) &&
      typeof row.service === "string" &&
      typeof row.outcome === "string" &&
      typeof row.eventType === "string" &&
      finiteNumber(row.invocations) &&
      finiteNumber(row.exceptions) &&
      finiteNumber(row.truncated) &&
      nullableFiniteNumber(row.averageCpuMs) &&
      nullableFiniteNumber(row.averageWallMs) &&
      nullableFiniteNumber(row.maximumCpuMs) &&
      nullableFiniteNumber(row.maximumWallMs),
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || finiteNumber(value);
}

function isCustomStats(value: unknown): value is CustomWorkerStats {
  if (
    !record(value) ||
    !new Set(["ok", "degraded"]).has(String(value.status)) ||
    typeof value.generatedAt !== "string" ||
    !numberRecord(value.jobs) ||
    !record(value.capabilities)
  ) {
    return false;
  }
  if (
    !Object.values(value.capabilities).every((entry) => numberRecord(entry))
  ) {
    return false;
  }
  if (value.users !== undefined) {
    if (!record(value.users)) return false;
    for (const name of ["total", "premium", "anonymous"]) {
      if (!Number.isFinite(value.users[name])) return false;
    }
  }
  if (value.cancellations !== undefined) {
    if (!record(value.cancellations)) return false;
    for (const name of [
      "jobs",
      "refundsPending",
      "refundsApplied",
      "creditsRefunded",
    ]) {
      if (!Number.isFinite(value.cancellations[name])) return false;
    }
  }
  return true;
}

function numberRecord(value: unknown): boolean {
  return (
    record(value) &&
    Object.values(value).every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    )
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function platformAdminDenial(
  env: Env,
  authorization: string | undefined,
): Promise<{ error: string; status: 401 | 403 } | null> {
  const value = await platformAdminContext(env, authorization);
  return "error" in value ? value : null;
}

async function platformAdminContext(
  env: Env,
  authorization: string | undefined,
): Promise<
  { userId: number; instanceId: number } | { error: string; status: 401 | 403 }
> {
  const auth = await getAuthContext(env, authorization);
  if (!auth) return { error: "unauthorized", status: 401 };
  if (!auth.instanceId) return { error: "instance_required", status: 403 };
  const role = await env.DB.prepare(
    "SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1",
  )
    .bind(auth.userId, auth.instanceId)
    .first<{ role: string }>();
  if (!role || !new Set(["owner", "admin"]).has(role.role))
    return { error: "admin_required", status: 403 };
  return { userId: auth.userId, instanceId: auth.instanceId };
}

function accountErasureSteps(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is string =>
            typeof entry === "string" && /^[a-z][a-z0-9-]{0,31}$/u.test(entry),
        )
      : [];
  } catch {
    return [];
  }
}

function customFetch(env: Env, path: string, init: RequestInit = {}) {
  if (!env.CUSTOM_WORKER || !env.CUSTOM_WORKER_TOKEN)
    throw new Error("custom_worker_unavailable");
  return env.CUSTOM_WORKER.fetch(`https://custom.internal${path}`, {
    ...init,
    headers: {
      "x-custom-worker-token": env.CUSTOM_WORKER_TOKEN,
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(5_000),
  });
}

async function proxyCustom(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!env.CUSTOM_WORKER)
    return Response.json({ error: "custom_worker_disabled" }, { status: 404 });
  if (!env.CUSTOM_WORKER_TOKEN)
    return Response.json(
      { error: "custom_worker_misconfigured" },
      { status: 503 },
    );
  try {
    const response = await customFetch(env, path, init);
    const body = await readTextLimited(
      response,
      CUSTOM_PROXY_MAX_BYTES,
      "Custom Worker operator response is too large",
    );
    const bodyAllowed = ![101, 204, 205, 304].includes(response.status);
    return new Response(bodyAllowed ? body : null, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ||
          "application/json; charset=UTF-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "custom_worker_unavailable" },
      { status: 503 },
    );
  }
}

export default platform;
