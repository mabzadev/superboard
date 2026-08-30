import { Hono } from "hono";
import { cors } from "hono/cors";
import { RequestBodyError } from "@superboard/contracts/request-body";
import { inspectSqlSchemaHealth } from "@superboard/contracts/health";
import {
  PROJECT_CONTEXT_HEADERS,
  signProjectContext,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { Env } from "./types";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import oauthRoutes from "./routes/oauth";
import linksRoutes from "./routes/links";
import instancesRoutes from "./routes/instances";
import projectsRoutes from "./routes/projects";
import mcpRoutes from "./routes/mcp";
import mcpOauthRoutes from "./routes/mcp-oauth";
import sdkRoutes from "./routes/sdk";
import pushRoutes, { internalPush } from "./routes/push";
import iapRoutes from "./routes/iap";
import identitySsoRoutes from "./routes/identity-sso";
import automationRoutes from "./routes/automation";
import diagnosticsRoutes from "./routes/diagnostics";
import adminRoutes from "./routes/admin";
import wellKnownRoutes from "./routes/well-known";
import purchasesAdminRoutes from "./routes/purchases-admin";
import purchasesV2AdminRoutes from "./routes/purchases-v2-admin";
import purchasesProviderWebhooks from "./routes/purchases-provider-webhooks";
import messagingAdminRoutes from "./routes/messaging-admin";
import inboxAdminRoutes from "./routes/inbox-admin";
import platformStatusRoutes from "./routes/platform-status";
import applicationUsersAdminRoutes from "./routes/application-users-admin";
import identityAdminRoutes from "./routes/identity-admin";
import redirectRoute from "./routes/redirect";
import { runMaintenance } from "./lib/maintenance";
import { dispatchQueueJob } from "./lib/jobs";
import { isSsoEnabled } from "./lib/deployment";
import {
  billingServiceEnabled,
  dispatchBillingServiceJob,
  purchasesJwksFromBillingAuthority,
} from "./lib/billing-service";
import { isBillingQueueJob } from "./lib/billing-dispatch";
import { readTextLimited } from "./lib/http-limits";
import { getAuthContext, getRequestAuthContext } from "./lib/auth";
import { refreshAppleNotificationConfigurationsIfDue } from "./lib/apple-notification-configuration";
import {
  DOMAIN_MODULES,
  DOMAIN_SDK_ROUTES,
  PUBLIC_FLOWS_SDK_ROUTES,
  isDomainSdkRoutePath,
  isPublicFlowsSdkRoutePath,
  proxyDomainModule,
  proxyDomainSdkModule,
  proxyLegacyDomainModule,
  proxyPublicFlows,
  proxyPublicMarketing,
  resolveSdkProjectContext,
} from "./lib/domain-modules";
import {
  isSupportWidgetPath,
  proxySupportProviderEvent,
  proxySupportSurface,
} from "./lib/support-gateway";
import { quarantinePlatformDeadLetter } from "./lib/platform-dead-letters";
import { resumePendingAccountErasures } from "./lib/account-erasure";
import { drainAnalyticsFactOutbox } from "./lib/analytics-facts";
import { proxyAwsSesEvent } from "./lib/mail";

export const app = new Hono<{ Bindings: Env }>();

app.onError((error, c) => {
  if (error instanceof RequestBodyError) {
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  }
  console.error(
    JSON.stringify({
      event: "api_unhandled_error",
      requestId: c.req.header("x-request-id") || null,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return c.json(
    { error: { code: "internal_error", message: "Internal server error" } },
    500,
  );
});

// CORS global
app.use(
  "*",
  cors({
    origin: (origin, c) =>
      isPublicFlowsSdkRoutePath(new URL(c.req.url).pathname) ||
      isSupportWidgetPath(new URL(c.req.url).pathname)
        ? allowedEmbeddableSdkOrigin(origin)
        : allowedCorsOrigin(origin, c.env.CORS_ORIGINS_JSON),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Api-Key",
      "X-AUTH",
      "X-Project-Id",
      "X-Project-Ref",
      "X-Request-Id",
      "PROJECT-KEY",
      "PLATFORM",
      "IDENTIFIER",
      "X-OpenGrow-Anonymous-ID",
      "X-OpenGrow-App-Version",
      "X-OpenGrow-Build-Number",
      "X-OpenGrow-SDK-Version",
      "X-OpenGrow-Storefront",
      "X-OpenGrow-Campaign",
      "X-OpenGrow-Project-Id",
      "X-SuperBoard-Anonymous-ID",
      "X-SuperBoard-App-Version",
      "X-SuperBoard-Build-Number",
      "X-SuperBoard-SDK-Version",
      "X-SuperBoard-Storefront",
      "X-SuperBoard-Campaign",
      "X-SuperBoard-Project-Id",
      "Idempotency-Key",
      "X-Flows-Version",
      "X-SuperBoard-Flows-SDK-Key",
      "X-SuperBoard-Widget-Key",
      "X-SuperBoard-Widget-Visitor",
      "X-SuperBoard-Widget-Signature",
      "X-SuperBoard-Widget-Timestamp",
      "X-Filename",
      "ENVIRONMENT",
      "LINKSQUARED",
      "x-maintenance-key",
      "x-diagnostics-key",
    ],
    exposeHeaders: ["Content-Disposition", "X-Request-Id"],
  }),
);

export function allowedCorsOrigin(
  origin: string,
  configured: string | undefined,
): string | undefined {
  try {
    const candidate = new URL(origin).origin;
    if (candidate !== origin.replace(/\/$/u, "")) return undefined;
    const values: unknown = JSON.parse(configured || "[]");
    if (!Array.isArray(values)) return undefined;
    return values.some(
      (value) =>
        typeof value === "string" && value.replace(/\/$/u, "") === candidate,
    )
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Flows environment keys are intentionally public client credentials. Its web
 * SDK must therefore work on the customer origins where a flow is embedded,
 * while still rejecting malformed/non-HTTP Origin values.
 */
export function allowedEmbeddableSdkOrigin(
  origin: string,
): string | undefined {
  try {
    const candidate = new URL(origin);
    const normalized = origin.replace(/\/$/u, "");
    if (
      candidate.origin !== normalized ||
      !new Set(["https:", "http:"]).has(candidate.protocol) ||
      candidate.username ||
      candidate.password
    ) {
      return undefined;
    }
    return candidate.origin;
  } catch {
    return undefined;
  }
}

// Public readiness for the API route. It deliberately verifies the central
// state authorities instead of returning a process-only liveness response.
app.get("/health", async (c) => {
  try {
    const [database, , schema] = await Promise.all([
      c.env.DB.prepare("SELECT 1 AS ready").first<{ ready: number }>(),
      c.env.KV.get("opengrow:health:read-probe"),
      inspectSqlSchemaHealth(c.env.DB, c.env.D1_EXPECTED_MIGRATION),
    ]);
    if (Number(database?.ready) !== 1)
      throw new Error("database_readiness_failed");
    if (!c.env.API_DOMAIN || !c.env.SDK_DOMAIN || !c.env.SHORTLINK_DOMAIN) {
      throw new Error("public_domain_configuration_missing");
    }
    const current = schema.status === "current";
    return c.json(
      {
        status: current ? "ok" : "degraded",
        service: "superboard-api",
        environment: c.env.ENVIRONMENT,
        host: c.req.header("host"),
        timestamp: new Date().toISOString(),
        schema,
        ...(current ? {} : { reason: "database_schema_not_current" }),
        dependencies: {
          d1: current ? "ok" : "schema_not_current",
          kv: "ok",
          publicDomains: "configured",
        },
      },
      current ? 200 : 503,
      { "cache-control": "no-store" },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "api_readiness_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return c.json(
      {
        status: "degraded",
        service: "superboard-api",
        environment: c.env.ENVIRONMENT,
        timestamp: new Date().toISOString(),
        dependencies: { d1: "unavailable", kv: "unavailable" },
      },
      503,
      { "cache-control": "no-store" },
    );
  }
});

app.get("/health/billing", async (c) => {
  if (!c.env.BILLING)
    return c.json(
      { status: "unavailable", service: "superboard-billing" },
      503,
    );
  try {
    const response = await c.env.BILLING.fetch(
      "https://billing.internal/internal/v1/health",
      { signal: AbortSignal.timeout(5_000) },
    );
    const payload = JSON.parse(await readTextLimited(response, 16_384));
    return c.json(
      { ...payload, routing_mode: c.env.BILLING_EXECUTION_MODE || "local" },
      response.ok ? 200 : 503,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "billing_health_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return c.json(
      {
        status: "unavailable",
        service: "superboard-billing",
        routing_mode: c.env.BILLING_EXECUTION_MODE || "local",
      },
      503,
    );
  }
});

app.get("/up", (c) => c.text("OK", 200));
app.get("/favicon.ico", (c) => c.body(null, 204));

app.get("/.well-known/purchases-jwks.json", async (c) => {
  try {
    return c.json(await purchasesJwksFromBillingAuthority(c.env), 200, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "purchases_jwks_unavailable",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return c.json({ error: "Purchases verification keys unavailable" }, 503);
  }
});

app.get("/.well-known/jwks.json", (c) => {
  if ((c.req.header("host") || "") === c.env.AUTH_DOMAIN) {
    return proxyAuthGateway(
      c.req.raw,
      c.env.IDENTITY_SERVICE,
      "/.well-known/jwks.json",
    );
  }
  return proxyPublicService(
    c.req.raw,
    c.env.IDENTITY_SERVICE,
    "/.well-known/jwks.json",
  );
});

// =============================================
// Route requests by subdomain
// =============================================
app.all("*", async (c, next) => {
  const host = c.req.header("host") || "";

  if (host === c.env.AUTH_DOMAIN) {
    const url = new URL(c.req.url);
    return proxyAuthGateway(
      c.req.raw,
      c.env.IDENTITY_SERVICE,
      `${url.pathname}${url.search}`,
    );
  }

  if (host === c.env.FILES_DOMAIN) {
    const url = new URL(c.req.url);
    if (url.pathname === "/v1/files" || url.pathname.startsWith("/v1/files/")) {
      return proxyPublicService(
        c.req.raw,
        c.env.FILES_SERVICE,
        `${url.pathname}${url.search}`,
      );
    }
    return c.notFound();
  }

  // Mobile SDK custom domain.
  if (host.startsWith("sdk.")) {
    const pathname = new URL(c.req.url).pathname;
    if (
      pathname === "/api/v1/sdk" ||
      pathname.startsWith("/api/v1/sdk/") ||
      isDomainSdkRoutePath(pathname)
    ) {
      return next();
    }
    return sdkRoutes.fetch(c.req.raw, c.env);
  }

  // Short-link custom domain and well-known resources.
  // The workers.dev host is also accepted for tests.
  return next();
});

// =====================================
// Routes for the custom domain and workers.dev.
// =====================================
app.route("/api/v1/auth", authRoutes);
app.all("/auth", (c) => proxyIdentityAuth(c.req.raw, c.env, "/auth"));
app.all("/auth/*", async (c) => {
  const url = new URL(c.req.url);
  if (c.req.method === "DELETE" && url.pathname === "/auth/me") {
    return c.json(
      {
        error: {
          code: "account_erasure_route_required",
          message:
            "Use DELETE /api/v1/sdk/account/v1 with the application SDK headers",
          retryable: false,
        },
      },
      410,
      { "cache-control": "private, no-store" },
    );
  }
  return await proxyIdentityAuth(
    c.req.raw,
    c.env,
    `${url.pathname}${url.search}`,
  );
});
app.all("/api/v1/app-files", (c) =>
  proxyFilesAlias(c.req.raw, c.env.FILES_SERVICE),
);
app.all("/api/v1/app-files/*", (c) =>
  proxyFilesAlias(c.req.raw, c.env.FILES_SERVICE),
);
app.route("/api/v1/users", usersRoutes);
app.route("/api/v1/instances", instancesRoutes);
app.route("/api/v1/projects", projectsRoutes);
app.route("/api/v1/mcp", mcpRoutes);
app.route("/api/v1/links", linksRoutes);
app.route("/api/v1/sdk", sdkRoutes);
app.route("/api/v1/push", pushRoutes);
app.route("/internal/v1/push", internalPush);
app.route("/api/v1/iap", iapRoutes);
app.use("/api/v1/identity/sso/*", async (c, next) => {
  if (!isSsoEnabled(c.env)) return c.notFound();
  return next();
});
app.route("/api/v1/identity/sso", identitySsoRoutes);
app.route("/api/v1/automation", automationRoutes);
app.route("/api/v1/diagnostics", diagnosticsRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/platform", platformStatusRoutes);
app.route("/api/v1/application-users/projects", applicationUsersAdminRoutes);
app.route("/api/v1/identity-admin/projects", identityAdminRoutes);
app.all("/api/v1/marketing/tracking/:action/:token", (c) => {
  const action = c.req.param("action");
  if (!["open", "click", "unsubscribe"].includes(action)) return c.notFound();
  return proxyPublicMarketing(
    c,
    `/public/v1/tracking/${action}/${c.req.param("token")}`,
  );
});
app.all("/api/v1/marketing/opt-in/:token", (c) => {
  if (!["GET", "POST"].includes(c.req.method)) return c.notFound();
  return proxyPublicMarketing(c, `/public/v1/opt-in/${c.req.param("token")}`);
});
app.post("/api/v1/marketing/provider-webhooks/:endpointId", (c) =>
  proxyPublicMarketing(
    c,
    `/public/v1/provider-webhooks/${c.req.param("endpointId")}`,
  ),
);
app.post("/api/v1/email/aws-ses/events", (c) =>
  proxyAwsSesEvent(c.env, c.req.raw),
);
app.get("/api/v1/support/realtime/:ticket", (c) =>
  proxySupportSurface(
    c,
    `/public/v1/realtime/${encodeURIComponent(c.req.param("ticket"))}`,
    "realtime",
  ),
);
app.post("/api/v1/support/providers/:provider/:endpointId/events", (c) =>
  proxySupportProviderEvent(
    c,
    c.req.param("provider"),
    c.req.param("endpointId"),
  ),
);
app.get("/api/v1/support/providers/:provider/:endpointId/events", (c) =>
  proxySupportProviderEvent(
    c,
    c.req.param("provider"),
    c.req.param("endpointId"),
  ),
);
app.get("/api/v1/support/providers/:provider/oauth/callback", (c) =>
  proxySupportSurface(
    c,
    `/public/v1/providers/${encodeURIComponent(c.req.param("provider"))}/oauth/callback`,
    "oauth",
  ),
);
app.all("/api/v1/support-widget", (c) =>
  proxySupportSurface(c, "/public/v1/widget", "widget"),
);
app.all("/api/v1/support-widget/*", (c) => {
  const url = new URL(c.req.url);
  const suffix = url.pathname.slice("/api/v1/support-widget".length);
  return proxySupportSurface(c, `/public/v1/widget${suffix}`, "widget");
});
app.all("/api/v1/support/help-center", (c) =>
  proxySupportSurface(c, "/public/v1/help-center", "help-center"),
);
app.all("/api/v1/support/help-center/*", (c) => {
  const url = new URL(c.req.url);
  const suffix = url.pathname.slice("/api/v1/support/help-center".length);
  return proxySupportSurface(
    c,
    `/public/v1/help-center${suffix}`,
    "help-center",
  );
});
app.all("/api/v1/support-client", (c) =>
  proxySupportSurface(c, "/v1", "client"),
);
app.all("/api/v1/support-client/*", (c) => {
  const url = new URL(c.req.url);
  const suffix = url.pathname.slice("/api/v1/support-client".length);
  return proxySupportSurface(c, `/v1${suffix}`, "client");
});
for (const route of DOMAIN_SDK_ROUTES) {
  app.post(route.publicPath, (c) => proxyDomainSdkModule(c, route));
}
for (const route of PUBLIC_FLOWS_SDK_ROUTES) {
  if (route.method === "POST") {
    app.post(route.publicPath, (c) => proxyPublicFlows(c, route.internalPath));
  } else {
    app.get(route.publicPath, (c) => proxyPublicFlows(c, route.internalPath));
  }
}
for (const [moduleName, bindingName] of Object.entries(DOMAIN_MODULES)) {
  const name = moduleName as keyof typeof DOMAIN_MODULES;
  const binding = bindingName as (typeof DOMAIN_MODULES)[typeof name];
  if (name === "paywalls" || name === "onboardings") {
    app.all(`/api/v1/${name}`, (c) => proxyLegacyDomainModule(c, name));
    app.all(`/api/v1/${name}/*`, (c) => proxyLegacyDomainModule(c, name));
  } else {
    app.all(`/api/v1/${name}`, (c) => proxyDomainModule(c, name, binding));
    app.all(`/api/v1/${name}/*`, (c) => proxyDomainModule(c, name, binding));
  }
}
app.use("/api/v1/billing/*", async (c, next) =>
  proxyBillingAdmin(c, next, "/api/v1/billing", "/internal/v1/admin/billing"),
);
app.route("/api/v1/billing", purchasesAdminRoutes);
// The v2 admin surface is additive: existing catalogue/customer operations
// stay available while new resources use stable error envelopes.
app.use("/api/v2/purchases/projects/*", async (c, next) =>
  proxyBillingAdmin(
    c,
    next,
    "/api/v2/purchases/projects",
    "/internal/v1/admin/purchases/projects",
  ),
);
app.route("/api/v2/purchases/projects", purchasesV2AdminRoutes);
app.route("/api/v2/purchases/projects", purchasesAdminRoutes);
app.route("/api/v2/purchases/providers/webhooks", purchasesProviderWebhooks);
app.route("/api/v2/messaging/projects", messagingAdminRoutes);
app.route("/api/v2/inbox/projects", inboxAdminRoutes);
app.route("/oauth", oauthRoutes);
app.route("/.well-known", wellKnownRoutes);
app.route("", mcpOauthRoutes);

// Short link redirect — this must remain last.
app.route("", redirectRoute);

function proxyFilesAlias(
  request: Request,
  binding: Fetcher | undefined,
): Promise<Response> | Response {
  const url = new URL(request.url);
  const suffix = url.pathname.slice("/api/v1/app-files".length);
  return proxyPublicService(
    request,
    binding,
    `/v1/files${suffix}${url.search}`,
  );
}

async function proxyPublicService(
  request: Request,
  binding: Fetcher | undefined,
  path: string,
): Promise<Response> {
  if (!binding)
    return Response.json(
      {
        error: {
          code: "service_unavailable",
          message: "Service is unavailable",
          retryable: true,
        },
      },
      { status: 503 },
    );
  const headers = new Headers();
  for (const name of [
    "authorization",
    "content-type",
    "content-length",
    "accept",
    "range",
    "if-none-match",
    "if-match",
    "x-filename",
    "x-request-id",
    "cf-connecting-ip",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const method = request.method.toUpperCase();
  try {
    return await binding.fetch(`https://service.internal${path}`, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? null : request.body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    console.error(
      JSON.stringify({
        event: "public_service_proxy_failed",
        path: path.split("?", 1)[0],
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    return Response.json(
      {
        error: {
          code: "service_unavailable",
          message: "Service is unavailable",
          retryable: true,
        },
      },
      { status: 503 },
    );
  }
}

async function proxyAuthGateway(
  request: Request,
  binding: Fetcher | undefined,
  path: string,
): Promise<Response> {
  if (!binding) {
    return Response.json(
      {
        error: {
          code: "identity_service_unavailable",
          message: "Identity service is unavailable",
          retryable: true,
        },
      },
      { status: 503 },
    );
  }

  const headers = new Headers(request.headers);
  for (const name of [
    "connection",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    headers.delete(name);
  }
  const publicUrl = new URL(request.url);
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
  headers.set("x-superboard-auth-gateway", "1");

  const method = request.method.toUpperCase();
  try {
    return await binding.fetch(`https://identity.internal${path}`, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? null : request.body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    console.error(
      JSON.stringify({
        event: "auth_gateway_proxy_failed",
        path: path.split("?", 1)[0],
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    return Response.json(
      {
        error: {
          code: "identity_service_unavailable",
          message: "Identity service is unavailable",
          retryable: true,
        },
      },
      { status: 503 },
    );
  }
}

async function proxyIdentityAuth(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const pathname = new URL(`https://identity.internal${path}`).pathname;
  const projectRequired =
    new Set([
      "/auth/register",
      "/auth/signin/password",
      "/auth/anonymous",
      "/auth/request-password-reset",
    ]).has(pathname) || pathname.startsWith("/auth/signin/");
  if (!projectRequired) {
    return proxyPublicService(request, env.IDENTITY_SERVICE, path);
  }
  if (!env.IDENTITY_SERVICE || !env.MODULE_INTERNAL_TOKEN) {
    return Response.json(
      { error: { code: "identity_context_unavailable", retryable: true } },
      { status: 503 },
    );
  }
  const resolved = await resolveSdkProjectContext(env.DB, request);
  if (!resolved.ok) {
    return Response.json(
      {
        error: {
          code: resolved.code,
          message: resolved.message,
          retryable: false,
        },
      },
      { status: resolved.status },
    );
  }
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const context: InternalProjectContext = {
    ...resolved.context,
    actorId: 0,
    role: "sdk",
    requestId,
    issuedAt: Math.floor(Date.now() / 1_000),
    module: "identity",
    method: request.method.toUpperCase(),
    pathname,
  };
  const signature = await signProjectContext(
    context,
    env.MODULE_INTERNAL_TOKEN,
  );
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set(PROJECT_CONTEXT_HEADERS.token, env.MODULE_INTERNAL_TOKEN);
  headers.set(PROJECT_CONTEXT_HEADERS.projectId, String(context.projectId));
  headers.set(PROJECT_CONTEXT_HEADERS.projectRef, context.projectRef);
  headers.set(PROJECT_CONTEXT_HEADERS.instanceId, String(context.instanceId));
  headers.set(PROJECT_CONTEXT_HEADERS.environment, context.environment);
  headers.set(PROJECT_CONTEXT_HEADERS.actorId, "0");
  headers.set(PROJECT_CONTEXT_HEADERS.role, context.role);
  headers.set(PROJECT_CONTEXT_HEADERS.requestId, context.requestId);
  headers.set(PROJECT_CONTEXT_HEADERS.issuedAt, String(context.issuedAt));
  headers.set(PROJECT_CONTEXT_HEADERS.version, "1");
  headers.set(PROJECT_CONTEXT_HEADERS.signature, signature);
  const method = request.method.toUpperCase();
  return env.IDENTITY_SERVICE.fetch(`https://identity.internal${path}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? null : request.body,
    signal: AbortSignal.timeout(30_000),
  });
}

async function proxyBillingAdmin(
  c: any,
  next: () => Promise<void>,
  publicPrefix: string,
  internalPrefix: string,
) {
  if (!billingServiceEnabled(c.env)) return next();
  const pathname = new URL(c.req.url).pathname;
  if (c.req.method === "POST" && /\/connections$/.test(pathname)) return next();
  const auth = await getRequestAuthContext(c.env, c.req.raw.headers);
  if (!auth) return c.json({ error: "Invalid or expired token" }, 401);
  if (!c.env.BILLING)
    return c.json(
      {
        code: "billing_service_unavailable",
        message: "Billing service is unavailable",
        retryable: true,
      },
      503,
    );
  const source = new URL(c.req.url);
  const internalUrl = new URL(
    `https://billing.internal${internalPrefix}${pathname.slice(publicPrefix.length)}`,
  );
  internalUrl.search = source.search;
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-OpenGrow-Internal-Actor", String(auth.userId));
  headers.delete("Authorization");
  const response = await c.env.BILLING.fetch(
    new Request(internalUrl, {
      method: c.req.method,
      headers,
      body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
    }),
  );
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      drainAnalyticsFactOutbox(env).then((summary) => {
        if (summary.inspected > 0) {
          console.log(
            JSON.stringify({
              event: "analytics_fact_outbox_drained",
              summary,
            }),
          );
        }
      }),
    );
    ctx.waitUntil(
      resumePendingAccountErasures(env).then((summary) => {
        if (summary.inspected > 0) {
          console.log(
            JSON.stringify({
              event: "application_account_erasures_resumed",
              summary,
            }),
          );
        }
      }),
    );
    if (env.BILLING_QUEUE && !billingServiceEnabled(env)) {
      ctx.waitUntil(env.BILLING_QUEUE.send({ type: "billing.reconcile" }));
    }
    ctx.waitUntil(
      refreshAppleNotificationConfigurationsIfDue(env)
        .then((summary) => {
          console.log(
            JSON.stringify({
              event: "apple_notification_configuration_checked",
              summary,
            }),
          );
        })
        .catch((error) => {
          console.error(
            JSON.stringify({
              event: "apple_notification_configuration_check_failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }),
    );
    if (env.MAINTENANCE_QUEUE) {
      ctx.waitUntil(
        env.MAINTENANCE_QUEUE.send({ type: "maintenance.run", days: 3 }),
      );
      return;
    }
    ctx.waitUntil(
      runMaintenance(env)
        .then((summary) => {
          console.log(
            JSON.stringify({ event: "maintenance_completed", summary }),
          );
        })
        .catch((error) => {
          console.error(
            JSON.stringify({
              event: "maintenance_failed",
              error: error?.message || String(error),
            }),
          );
        }),
    );
  },
  async queue(batch, env, ctx) {
    const deadLetterQueues = [
      env.EVENT_DLQ_NAME,
      env.PUSH_DLQ_NAME,
      env.MAINTENANCE_DLQ_NAME,
    ].filter((name): name is string => Boolean(name));
    if (deadLetterQueues.includes(batch.queue)) {
      for (const message of batch.messages) {
        try {
          const result = await quarantinePlatformDeadLetter(
            env.DB,
            batch.queue,
            message,
          );
          console.error(
            JSON.stringify({
              event: "platform_job_quarantined",
              queue: batch.queue,
              message_id: message.id,
              job_type: result.jobType,
              replayable: result.replayable,
              duplicate: result.duplicate,
            }),
          );
          message.ack();
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "platform_dead_letter_persistence_failed",
              queue: batch.queue,
              message_id: message.id,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          message.retry({ delaySeconds: 60 });
        }
      }
      return;
    }
    for (const message of batch.messages) {
      let body: any = null;
      try {
        body =
          typeof message.body === "string"
            ? JSON.parse(message.body)
            : message.body;
        const result =
          isBillingQueueJob(body) && billingServiceEnabled(env)
            ? await dispatchBillingServiceJob(env, body)
            : await dispatchQueueJob(env, body);
        console.log(
          JSON.stringify({
            event: "queue_job_completed",
            queue: batch.queue,
            message_id: message.id,
            job_type: body?.type,
            result,
          }),
        );
        message.ack();
      } catch (error: any) {
        console.error(
          JSON.stringify({
            event: "queue_job_failed",
            queue: batch.queue,
            message_id: message.id,
            job_type: body?.type,
            error: error?.message || String(error),
          }),
        );
        if (error?.retryable === false) message.ack();
        else
          message.retry({
            delaySeconds: Math.max(
              30,
              Math.min(3600, Number(error?.retryDelaySeconds || 60)),
            ),
          });
      }
    }
  },
} satisfies ExportedHandler<Env>;
