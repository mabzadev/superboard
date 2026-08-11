import type { Context } from "hono";
import {
  signProjectContext,
  type DomainModuleName,
  type InternalProjectContext,
  type ProjectContext,
  type ProjectEnvironment,
} from "@superboard/contracts/project-context";
import type { Env } from "../types";
import { getAuthContext } from "./auth";

export const DOMAIN_MODULES = {
  app: "APP_MODULE",
  products: "PRODUCTS_MODULE",
  paywalls: "PAYWALLS_MODULE",
  "dynamic-links": "DYNAMIC_LINKS_MODULE",
  support: "SUPPORT_MODULE",
  marketing: "MARKETING_MODULE",
  onboardings: "ONBOARDINGS_MODULE",
} as const;

export type DomainModuleBinding = (typeof DOMAIN_MODULES)[DomainModuleName];

export const DOMAIN_SDK_ROUTES = Object.freeze([
  sdkRoute("app", "/runtime-policy", "/runtime-policy/resolve", false),
  sdkRoute("app", "/events", "/customer-events", true),
  sdkRoute("products", "/offerings/resolve", "/offerings/resolve", false),
  sdkRoute("paywalls", "/resolve", "/placements/resolve", false),
  sdkRoute("paywalls", "/events", "/events", true),
  sdkRoute("onboardings", "/resolve", "/placements/resolve", false),
  sdkRoute("onboardings", "/events", "/events", true),
]);

export interface DomainSdkRoute {
  moduleName: "app" | "products" | "paywalls" | "onboardings";
  bindingName: DomainModuleBinding;
  publicPath: string;
  internalPath: string;
  requiresIdempotency: boolean;
}

export interface DomainErrorBody {
  error: {
    code: string;
    message: string;
    status: number;
    request_id: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}

type GatewayContext = Context<{ Bindings: Env }>;

const PROJECT_REF_PATTERN = /^(\d+)-(prod|test)$/;
const CONTEXT_VERSION = "1";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function proxyDomainModule(
  c: GatewayContext,
  moduleName: DomainModuleName,
  bindingName: DomainModuleBinding,
): Promise<Response> {
  const requestId = requestIdFrom(c.req.raw);
  try {
    return await proxyDomainModuleRequest(
      c,
      moduleName,
      bindingName,
      requestId,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "domain_module_gateway_failed",
        module: moduleName,
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return domainError(
      requestId,
      500,
      "gateway_internal_error",
      "The module gateway could not process the request",
      { retryable: true },
    );
  }
}

async function proxyDomainModuleRequest(
  c: GatewayContext,
  moduleName: DomainModuleName,
  bindingName: DomainModuleBinding,
  requestId: string,
): Promise<Response> {
  const auth = await getAuthContext(c.env, c.req.header("Authorization"));
  if (!auth) {
    return domainError(
      requestId,
      401,
      "unauthorized",
      "Invalid or expired token",
    );
  }

  const route = extractDomainRoute(c.req.raw, moduleName);
  if (!route.ok) {
    return domainError(requestId, route.status, route.code, route.message, {
      details: route.details,
    });
  }

  if (isMutatingRequest(c.req.raw)) {
    const error = validateIdempotencyKey(c.req.raw, requestId);
    if (error) return error;
  }

  const project = await resolveAuthorizedProjectContext(
    c.env.DB,
    auth.userId,
    route.projectRef,
  );
  if (!project.ok) {
    return domainError(
      requestId,
      project.status,
      project.code,
      project.message,
    );
  }

  if (
    isMutatingRequest(c.req.raw) &&
    (await isProjectReadOnly(c.env.DB, project.context.projectId))
  ) {
    return domainError(
      requestId,
      503,
      "maintenance_read_only",
      "This project is temporarily read-only during module cutover",
      { retryable: true },
    );
  }

  return forwardDomainRequest(
    c,
    moduleName,
    bindingName,
    requestId,
    route.internalPath,
    {
      ...project.context,
      actorId: auth.userId,
    },
  );
}

export async function proxyDomainSdkModule(
  c: GatewayContext,
  route: DomainSdkRoute,
): Promise<Response> {
  const requestId = requestIdFrom(c.req.raw);
  try {
    const resolved = await resolveSdkProjectContext(c.env.DB, c.req.raw);
    if (!resolved.ok) {
      return domainError(
        requestId,
        resolved.status,
        resolved.code,
        resolved.message,
      );
    }
    if (route.requiresIdempotency) {
      const error = validateIdempotencyKey(c.req.raw, requestId);
      if (error) return error;
    }
    if (
      route.requiresIdempotency &&
      (await isProjectReadOnly(c.env.DB, resolved.context.projectId))
    ) {
      return domainError(
        requestId,
        503,
        "maintenance_read_only",
        "This project is temporarily read-only during module cutover",
        { retryable: true },
      );
    }
    return forwardDomainRequest(
      c,
      route.moduleName,
      route.bindingName,
      requestId,
      route.internalPath,
      {
        ...resolved.context,
        actorId: 0,
        role: "sdk",
      },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "domain_module_sdk_gateway_failed",
        module: route.moduleName,
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return domainError(
      requestId,
      500,
      "gateway_internal_error",
      "The module SDK gateway could not process the request",
      { retryable: true },
    );
  }
}

export async function proxyPublicMarketing(
  c: GatewayContext,
  internalPath: string,
): Promise<Response> {
  const requestId = requestIdFrom(c.req.raw);
  if (!c.env.MARKETING_MODULE) {
    return domainError(
      requestId,
      503,
      "module_unavailable",
      "marketing service is unavailable",
      { retryable: true },
    );
  }
  try {
    const source = new URL(c.req.url);
    const target = new URL(`https://marketing.internal${internalPath}`);
    target.search = source.search;
    const forwarded = new Request(target, c.req.raw);
    const response = await c.env.MARKETING_MODULE.fetch(forwarded);
    const headers = new Headers(response.headers);
    headers.set("X-Request-Id", requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "marketing_public_proxy_failed",
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return domainError(
      requestId,
      502,
      "module_request_failed",
      "marketing service request failed",
      { retryable: true },
    );
  }
}

export async function proxyPublicSupport(
  c: GatewayContext,
  internalPath: string,
): Promise<Response> {
  const requestId = requestIdFrom(c.req.raw);
  if (!c.env.SUPPORT_MODULE) {
    return domainError(
      requestId,
      503,
      "module_unavailable",
      "support service is unavailable",
      { retryable: true },
    );
  }
  try {
    const source = new URL(c.req.url);
    const target = new URL(`https://support.internal${internalPath}`);
    target.search = source.search;
    const response = await c.env.SUPPORT_MODULE.fetch(
      new Request(target, c.req.raw),
    );
    const headers = new Headers(response.headers);
    headers.set("X-Request-Id", requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
      webSocket: response.webSocket,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "support_public_proxy_failed",
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return domainError(
      requestId,
      502,
      "module_request_failed",
      "support service request failed",
      { retryable: true },
    );
  }
}

export async function isProjectReadOnly(
  db: D1Database,
  projectId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT enabled FROM module_cutover_maintenance WHERE project_id = ? LIMIT 1",
    )
    .bind(projectId)
    .first<{ enabled: number }>()
    // The gateway can be rolled back before migration 0051 without blocking all
    // traffic. A failed/missing cutover table therefore means maintenance off.
    .catch(() => null);
  return Number(row?.enabled ?? 0) === 1;
}

async function forwardDomainRequest(
  c: GatewayContext,
  moduleName: DomainModuleName,
  bindingName: DomainModuleBinding,
  requestId: string,
  internalPath: string,
  project: Omit<ProjectContext, "requestId" | "issuedAt">,
): Promise<Response> {
  const service = c.env[bindingName];
  if (!service) {
    return domainError(
      requestId,
      503,
      "module_unavailable",
      `${moduleName} service is unavailable`,
      { retryable: true },
    );
  }
  const internalToken = c.env.MODULE_INTERNAL_TOKEN?.trim();
  if (!internalToken) {
    return domainError(
      requestId,
      503,
      "module_credentials_unavailable",
      `${moduleName} service credentials are unavailable`,
      { retryable: true },
    );
  }

  const source = new URL(c.req.url);
  const internalUrl = new URL(`https://${moduleName}.internal${internalPath}`);
  internalUrl.search = source.search;
  const context: InternalProjectContext = {
    ...project,
    requestId,
    issuedAt: Math.floor(Date.now() / 1_000),
    module: moduleName,
    method: c.req.method.toUpperCase(),
    pathname: internalUrl.pathname,
  };
  const signature = await signProjectContext(context, internalToken);
  const headers = internalHeaders(
    c.req.raw.headers,
    context,
    internalToken,
    signature,
  );

  try {
    // Constructing from the source Request preserves body streaming without
    // buffering it or requiring Node's non-standard `duplex` RequestInit key.
    const forwardedRequest = new Request(internalUrl, c.req.raw);
    const response = await service.fetch(
      new Request(forwardedRequest, { headers }),
    );
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("X-Request-Id", requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "domain_module_proxy_failed",
        module: moduleName,
        project_ref: context.projectRef,
        project_id: context.projectId,
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return domainError(
      requestId,
      502,
      "module_request_failed",
      `${moduleName} service request failed`,
      { retryable: true },
    );
  }
}

export async function resolveSdkProjectContext(
  db: D1Database,
  request: Request,
): Promise<
  | {
      ok: true;
      context: Omit<
        ProjectContext,
        "actorId" | "role" | "requestId" | "issuedAt"
      >;
      platform: string;
      identifier: string;
    }
  | {
      ok: false;
      status: 401 | 403 | 422;
      code: string;
      message: string;
    }
> {
  const rawProjectKey = request.headers.get("PROJECT-KEY")?.trim() || "";
  const platform = request.headers.get("PLATFORM")?.trim().toLowerCase() || "";
  const identifier = request.headers.get("IDENTIFIER")?.trim() || "";
  if (!rawProjectKey || !platform || !identifier) {
    return {
      ok: false,
      status: 401,
      code: "sdk_credentials_required",
      message: "PROJECT-KEY, PLATFORM and IDENTIFIER are required",
    };
  }
  if (!new Set(["ios", "android", "web", "desktop"]).has(platform)) {
    return {
      ok: false,
      status: 422,
      code: "sdk_platform_invalid",
      message: "PLATFORM must be ios, android, web or desktop",
    };
  }

  const keySelectsTest = rawProjectKey.startsWith("test_");
  const projectKey = keySelectsTest
    ? rawProjectKey.slice("test_".length)
    : rawProjectKey;
  if (!projectKey) {
    return {
      ok: false,
      status: 403,
      code: "sdk_credentials_invalid",
      message: "Invalid SDK credentials",
    };
  }
  const environmentHeader = request.headers
    .get("ENVIRONMENT")
    ?.trim()
    .toLowerCase();
  if (
    environmentHeader &&
    environmentHeader !== "production" &&
    environmentHeader !== "test"
  ) {
    return {
      ok: false,
      status: 422,
      code: "sdk_environment_invalid",
      message: "ENVIRONMENT must be production or test",
    };
  }
  const environment: ProjectEnvironment = keySelectsTest
    ? "test"
    : environmentHeader === "test"
      ? "test"
      : "production";
  if (keySelectsTest && environmentHeader === "production") {
    return {
      ok: false,
      status: 403,
      code: "sdk_environment_mismatch",
      message: "PROJECT-KEY and ENVIRONMENT select different projects",
    };
  }

  const project = await db
    .prepare(
      `SELECT p.id AS project_id, p.instance_id, p.is_test
       FROM instances i
       INNER JOIN projects p ON p.instance_id = i.id
       WHERE i.api_key = ? AND p.is_test = ?
       LIMIT 1`,
    )
    .bind(projectKey, environment === "test" ? 1 : 0)
    .first<{ project_id: number; instance_id: number; is_test: number }>();
  if (!project) {
    return {
      ok: false,
      status: 403,
      code: "sdk_credentials_invalid",
      message: "Invalid SDK credentials",
    };
  }

  const configured = await sdkApplicationConfigured(
    db,
    Number(project.instance_id),
    platform,
    identifier,
  );
  if (!configured) {
    return {
      ok: false,
      status: 403,
      code: "sdk_application_forbidden",
      message: "SDK application is not configured for this project",
    };
  }
  const projectId = Number(project.project_id);
  const instanceId = Number(project.instance_id);
  if (
    !Number.isSafeInteger(projectId) ||
    projectId <= 0 ||
    !Number.isSafeInteger(instanceId) ||
    instanceId <= 0
  ) {
    throw new Error("Resolved SDK project context is invalid");
  }
  return {
    ok: true,
    context: {
      projectId,
      projectRef: `${instanceId}-${environment === "test" ? "test" : "prod"}`,
      instanceId,
      environment,
    },
    platform,
    identifier,
  };
}

export function extractDomainRoute(
  request: Request,
  moduleName: DomainModuleName,
):
  | { ok: true; projectRef: string; internalPath: string }
  | {
      ok: false;
      status: 400 | 409 | 422;
      code: string;
      message: string;
      details?: Record<string, unknown>;
    } {
  const url = new URL(request.url);
  const publicPrefix = `/api/v1/${moduleName}`;
  const relativePath = url.pathname.slice(publicPrefix.length);
  const segments = relativePath.split("/").filter(Boolean);
  const headerProjectRef =
    request.headers.get("X-Project-Ref")?.trim() ||
    request.headers.get("X-Project-Id")?.trim() ||
    "";

  let pathProjectRef = "";
  let resourceSegments = segments;
  if (segments[0] === "projects") {
    pathProjectRef = segments[1] || "";
    resourceSegments = segments.slice(2);
  } else if (!headerProjectRef || PROJECT_REF_PATTERN.test(segments[0] || "")) {
    pathProjectRef = segments[0] || "";
    resourceSegments = segments.slice(1);
  }

  if (
    headerProjectRef &&
    pathProjectRef &&
    headerProjectRef !== pathProjectRef
  ) {
    return {
      ok: false,
      status: 409,
      code: "project_context_conflict",
      message: "Project reference in the path and header do not match",
      details: {
        path_project_ref: pathProjectRef,
        header_project_ref: headerProjectRef,
      },
    };
  }
  const projectRef = pathProjectRef || headerProjectRef;
  if (!projectRef) {
    return {
      ok: false,
      status: 400,
      code: "project_required",
      message: "A project reference is required",
    };
  }
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    return {
      ok: false,
      status: 422,
      code: "project_ref_invalid",
      message:
        "Project reference must use the <instance>-prod or <instance>-test format",
    };
  }

  return {
    ok: true,
    projectRef,
    internalPath:
      resourceSegments.length === 0
        ? "/internal/v1"
        : `/internal/v1/${resourceSegments.join("/")}`,
  };
}

export async function resolveAuthorizedProjectContext(
  db: D1Database,
  actorId: number,
  projectRef: string,
): Promise<
  | {
      ok: true;
      context: Omit<ProjectContext, "actorId" | "requestId" | "issuedAt">;
    }
  | {
      ok: false;
      status: 403 | 404 | 422;
      code: string;
      message: string;
    }
> {
  const parsed = PROJECT_REF_PATTERN.exec(projectRef);
  if (!parsed) {
    return {
      ok: false,
      status: 422,
      code: "project_ref_invalid",
      message:
        "Project reference must use the <instance>-prod or <instance>-test format",
    };
  }
  const instanceId = Number(parsed[1]);
  if (!Number.isSafeInteger(instanceId) || instanceId <= 0) {
    return {
      ok: false,
      status: 422,
      code: "project_ref_invalid",
      message: "Project reference contains an invalid instance id",
    };
  }
  const environment: ProjectEnvironment =
    parsed[2] === "test" ? "test" : "production";
  const row = await db
    .prepare(
      `SELECT p.id AS project_id, p.instance_id, p.is_test, ir.role
       FROM projects p
       INNER JOIN instance_roles ir
         ON ir.instance_id = p.instance_id AND ir.user_id = ?
       WHERE p.instance_id = ? AND p.is_test = ?
       LIMIT 1`,
    )
    .bind(actorId, instanceId, environment === "test" ? 1 : 0)
    .first<{
      project_id: number;
      instance_id: number;
      is_test: number;
      role: string;
    }>();

  if (!row) {
    const projectExists = await db
      .prepare(
        "SELECT id FROM projects WHERE instance_id = ? AND is_test = ? LIMIT 1",
      )
      .bind(instanceId, environment === "test" ? 1 : 0)
      .first<{ id: number }>();
    return projectExists
      ? {
          ok: false,
          status: 403,
          code: "project_forbidden",
          message: "Project access denied",
        }
      : {
          ok: false,
          status: 404,
          code: "project_not_found",
          message: "Project was not found",
        };
  }

  const projectId = Number(row.project_id);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error("Resolved project has an invalid internal id");
  }
  return {
    ok: true,
    context: {
      projectId,
      projectRef: `${instanceId}-${environment === "test" ? "test" : "prod"}`,
      instanceId,
      environment,
      role: String(row.role),
    },
  };
}

export function domainError(
  requestId: string,
  status: number,
  code: string,
  message: string,
  options: {
    retryable?: boolean;
    details?: Record<string, unknown>;
  } = {},
): Response {
  const body: DomainErrorBody = {
    error: {
      code,
      message,
      status,
      request_id: requestId,
      ...(options.retryable === undefined
        ? {}
        : { retryable: options.retryable }),
      ...(options.details ? { details: options.details } : {}),
    },
  };
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}

function internalHeaders(
  source: Headers,
  context: InternalProjectContext,
  token: string,
  signature: string,
): Headers {
  const headers = new Headers(source);
  for (const name of [
    "Authorization",
    "Host",
    "X-Internal-Token",
    "X-Project-Id",
    "X-Project-Ref",
    "X-Instance-Id",
    "X-Environment",
    "X-Actor-Id",
    "X-Role",
    "X-Request-Id",
    "X-Context-Issued-At",
    "X-Context-Version",
    "X-Context-Signature",
    "X-OpenGrow-Internal-Actor",
    "PROJECT-KEY",
    "X-Api-Key",
    "Cookie",
  ]) {
    headers.delete(name);
  }
  headers.set("X-Internal-Token", token);
  headers.set("X-Project-Id", String(context.projectId));
  headers.set("X-Project-Ref", context.projectRef);
  headers.set("X-Instance-Id", String(context.instanceId));
  headers.set("X-Environment", context.environment);
  headers.set("X-Actor-Id", String(context.actorId));
  headers.set("X-Role", context.role);
  headers.set("X-Request-Id", context.requestId);
  headers.set("X-Context-Issued-At", String(context.issuedAt));
  headers.set("X-Context-Version", CONTEXT_VERSION);
  headers.set("X-Context-Signature", signature);
  return headers;
}

function requestIdFrom(request: Request): string {
  const provided = request.headers.get("X-Request-Id")?.trim();
  if (provided && /^[A-Za-z0-9._:-]{1,128}$/.test(provided)) return provided;
  return crypto.randomUUID();
}

function isMutatingRequest(request: Request): boolean {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return false;
  return !new URL(request.url).pathname.endsWith("/resolve");
}

export function isDomainSdkRoutePath(pathname: string): boolean {
  return DOMAIN_SDK_ROUTES.some((route) => route.publicPath === pathname);
}

function sdkRoute(
  moduleName: DomainSdkRoute["moduleName"],
  publicSuffix: string,
  internalSuffix: string,
  requiresIdempotency: boolean,
): DomainSdkRoute {
  return Object.freeze({
    moduleName,
    bindingName: DOMAIN_MODULES[moduleName],
    publicPath: `/api/v1/${moduleName}${publicSuffix}`,
    internalPath: `/internal/v1${internalSuffix}`,
    requiresIdempotency,
  });
}

function validateIdempotencyKey(
  request: Request,
  requestId: string,
): Response | null {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key) {
    return domainError(
      requestId,
      400,
      "idempotency_key_required",
      "Idempotency-Key is required for mutating requests",
    );
  }
  if (key.length > 255) {
    return domainError(
      requestId,
      422,
      "idempotency_key_invalid",
      "Idempotency-Key must not exceed 255 characters",
    );
  }
  return null;
}

async function sdkApplicationConfigured(
  db: D1Database,
  instanceId: number,
  platform: string,
  identifier: string,
): Promise<boolean> {
  let sql: string;
  let values: unknown[];
  if (platform === "ios") {
    sql = `SELECT a.id
           FROM applications a
           INNER JOIN ios_configurations configuration
             ON configuration.application_id = a.id
           WHERE a.instance_id = ? AND a.platform = 'ios'
             AND COALESCE(a.enabled, 1) = 1
             AND configuration.bundle_id = ?
           LIMIT 1`;
    values = [instanceId, identifier];
  } else if (platform === "android") {
    sql = `SELECT a.id
           FROM applications a
           INNER JOIN android_configurations configuration
             ON configuration.application_id = a.id
           WHERE a.instance_id = ? AND a.platform = 'android'
             AND COALESCE(a.enabled, 1) = 1
             AND configuration.identifier = ?
           LIMIT 1`;
    values = [instanceId, identifier];
  } else if (platform === "web") {
    sql = `SELECT a.id
           FROM applications a
           INNER JOIN web_configurations configuration
             ON configuration.application_id = a.id
           LEFT JOIN web_configuration_linked_domains linked_domain
             ON linked_domain.web_configuration_id = configuration.id
           WHERE a.instance_id = ? AND a.platform = 'web'
             AND COALESCE(a.enabled, 1) = 1
             AND (
               lower(linked_domain.domain) = lower(?)
               OR lower(replace(replace(configuration.site_url, 'https://', ''), 'http://', '')) = lower(?)
             )
           LIMIT 1`;
    values = [instanceId, identifier, identifier];
  } else {
    sql = `SELECT a.id
           FROM applications a
           INNER JOIN desktop_configurations configuration
             ON configuration.application_id = a.id
           WHERE a.instance_id = ? AND a.platform = 'desktop'
             AND COALESCE(a.enabled, 1) = 1
             AND (configuration.bundle_identifier = ? OR configuration.package_name = ?)
           LIMIT 1`;
    values = [instanceId, identifier, identifier];
  }
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first<{ id: number }>();
  return Boolean(row);
}
