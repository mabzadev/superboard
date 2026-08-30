import { Hono, type Context } from "hono";
import {
  PROJECT_CONTEXT_HEADERS,
  signProjectContext,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { readBytesLimited } from "@superboard/contracts/request-body";
import { getRequestAuthContext } from "../lib/auth";
import {
  domainError,
  resolveAuthorizedProjectContext,
} from "../lib/domain-modules";
import type { Env } from "../types";

type AdminContext = Context<{ Bindings: Env }>;

const routes = new Hono<{ Bindings: Env }>();
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);
const MAX_ADMIN_BODY_BYTES = 1_048_576;

routes.all("/:projectRef", proxyIdentityAdmin);
routes.all("/:projectRef/:rest{.+}", proxyIdentityAdmin);

async function proxyIdentityAdmin(c: AdminContext): Promise<Response> {
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();
  if (!ALLOWED_METHODS.has(c.req.method)) {
    return domainError(
      requestId,
      405,
      "method_not_allowed",
      "Identity administration does not support this request method",
    );
  }

  const suffix = identityAdminSuffix(c.req.param("rest"));
  if (!suffix) {
    return domainError(
      requestId,
      404,
      "identity_admin_path_invalid",
      "Identity administration path is not allowed",
    );
  }

  const authorized = await authorize(c, requestId);
  if (authorized instanceof Response) return authorized;
  return forward(c, suffix, authorized, requestId);
}

function identityAdminSuffix(wildcard: string | undefined): string | null {
  const raw = wildcard?.trim() || "info";
  let segments: string[];
  try {
    segments = raw.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.length > 256 ||
        /[\\\u0000-\u001f\u007f]/u.test(segment),
    )
  ) {
    return null;
  }
  const normalized = `/${segments.map(encodeURIComponent).join("/")}`;
  return normalized === "/info" || normalized.startsWith("/api/v1/")
    ? normalized
    : null;
}

async function authorize(
  c: AdminContext,
  requestId: string,
): Promise<InternalProjectContext | Response> {
  const auth = await getRequestAuthContext(c.env, c.req.raw.headers);
  if (!auth) {
    return domainError(
      requestId,
      401,
      "unauthorized",
      "Invalid or expired token",
    );
  }
  const project = await resolveAuthorizedProjectContext(
    c.env.DB,
    auth.userId,
    c.req.param("projectRef") || "",
  );
  if (!project.ok) {
    return domainError(
      requestId,
      project.status,
      project.code,
      project.message,
    );
  }
  if (!new Set(["owner", "admin"]).has(project.context.role)) {
    return domainError(
      requestId,
      403,
      "administrator_required",
      "Owner or administrator access is required",
    );
  }
  return {
    ...project.context,
    actorId: auth.userId,
    requestId,
    issuedAt: Math.floor(Date.now() / 1_000),
    module: "identity",
    method: c.req.method,
    pathname: "",
  };
}

async function forward(
  c: AdminContext,
  suffix: string,
  authorized: InternalProjectContext,
  requestId: string,
): Promise<Response> {
  const internalToken = c.env.MODULE_INTERNAL_TOKEN?.trim();
  if (!c.env.IDENTITY_SERVICE || !internalToken) {
    return domainError(
      requestId,
      503,
      "identity_admin_unavailable",
      "Identity administration is unavailable",
      { retryable: true },
    );
  }

  try {
    const source = new URL(c.req.url);
    const target = new URL(
      `https://identity.internal/internal/v1/melody-admin${suffix}`,
    );
    target.search = source.search;
    const context: InternalProjectContext = {
      ...authorized,
      method: c.req.method,
      pathname: target.pathname,
    };
    const signature = await signProjectContext(context, internalToken);
    const headers = new Headers({
      accept: c.req.header("accept") || "application/json",
      [PROJECT_CONTEXT_HEADERS.token]: internalToken,
      [PROJECT_CONTEXT_HEADERS.projectId]: String(context.projectId),
      [PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
      [PROJECT_CONTEXT_HEADERS.instanceId]: String(context.instanceId),
      [PROJECT_CONTEXT_HEADERS.environment]: context.environment,
      [PROJECT_CONTEXT_HEADERS.actorId]: String(context.actorId),
      [PROJECT_CONTEXT_HEADERS.role]: context.role,
      [PROJECT_CONTEXT_HEADERS.requestId]: requestId,
      [PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
      [PROJECT_CONTEXT_HEADERS.version]: "1",
      [PROJECT_CONTEXT_HEADERS.signature]: signature,
    });
    const contentType = c.req.header("content-type");
    if (contentType) headers.set("content-type", contentType);
    const hasBody = c.req.method !== "GET";
    const body = hasBody
      ? await readBytesLimited(c.req.raw, MAX_ADMIN_BODY_BYTES)
      : undefined;
    const internal = await c.env.IDENTITY_SERVICE.fetch(target, {
      method: c.req.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(internal.body, {
      status: internal.status,
      headers: {
        "cache-control": "private, no-store",
        "content-type":
          internal.headers.get("content-type") ||
          "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "RequestBodyError") throw cause;
    console.error(
      JSON.stringify({
        event: "identity_admin_proxy_failed",
        request_id: requestId,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    return domainError(
      requestId,
      502,
      "identity_admin_request_failed",
      "Identity administration request failed",
      { retryable: true },
    );
  }
}

export default routes;
