import {
  PROJECT_CONTEXT_HEADERS,
  signProjectContext,
  type InternalProjectContext,
} from "@opengrow/contracts/project-context";
import { Hono, type Context } from "hono";
import { readJsonObjectLimited } from "../lib/http-limits";
import type { AppVariables, Env } from "../types";

const marketingSdk = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();
type MarketingSdkContext = Context<{
  Bindings: Env;
  Variables: AppVariables;
}>;

marketingSdk.all("/preferences", async (c) => {
  if (!new Set(["GET", "PUT"]).has(c.req.method)) {
    return failure(c, 405, "method_not_allowed", "Method not allowed");
  }
  const project = await applicationProject(c);
  if (project instanceof Response) return project;
  const identity = await applicationIdentity(c);
  if (identity instanceof Response) return identity;
  if (!c.env.MARKETING_MODULE || !c.env.MODULE_INTERNAL_TOKEN?.trim()) {
    return failure(
      c,
      503,
      "marketing_unavailable",
      "Marketing preferences are unavailable",
      true,
    );
  }

  const idempotencyKey = c.req.header("Idempotency-Key")?.trim() || "";
  if (
    c.req.method === "PUT" &&
    (!idempotencyKey || idempotencyKey.length > 255)
  ) {
    return failure(
      c,
      422,
      "idempotency_key_invalid",
      "A valid Idempotency-Key is required",
    );
  }

  let body: Record<string, unknown> | undefined;
  if (c.req.method === "PUT") {
    try {
      const input = await readJsonObjectLimited(
        c.req.raw,
        32_768,
        "Marketing preference request is too large",
      );
      if (typeof input.consented !== "boolean") {
        return failure(
          c,
          422,
          "consent_invalid",
          "consented must be a boolean",
        );
      }
      body = {
        consented: input.consented,
        attributes: requestObject(input.attributes, "attributes"),
        list_ids: requestStringArray(input.list_ids, "list_ids", 50),
      };
    } catch (error) {
      if (error instanceof MarketingInputError) {
        return failure(c, 422, error.code, error.message);
      }
      const status = Number((error as { status?: unknown })?.status || 422);
      return failure(
        c,
        status === 413 ? 413 : 422,
        status === 413 ? "body_too_large" : "body_invalid",
        status === 413
          ? "Marketing preference request is too large"
          : "Marketing preference request must be valid JSON",
      );
    }
  }

  const requestId = requestIdFrom(c.req.raw);
  const internalUrl = new URL(
    "https://marketing.internal/internal/v1/application/preferences",
  );
  const context: InternalProjectContext = {
    module: "marketing",
    method: c.req.method,
    pathname: internalUrl.pathname,
    projectId: project.projectId,
    projectRef: project.projectRef,
    instanceId: project.instanceId,
    environment: project.environment,
    actorId: 0,
    role: "application",
    requestId,
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const secret = c.env.MODULE_INTERNAL_TOKEN.trim();
  const signature = await signProjectContext(context, secret);
  const headers = new Headers({
    accept: "application/json",
    [PROJECT_CONTEXT_HEADERS.token]: secret,
    [PROJECT_CONTEXT_HEADERS.projectId]: String(context.projectId),
    [PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
    [PROJECT_CONTEXT_HEADERS.instanceId]: String(context.instanceId),
    [PROJECT_CONTEXT_HEADERS.environment]: context.environment,
    [PROJECT_CONTEXT_HEADERS.actorId]: "0",
    [PROJECT_CONTEXT_HEADERS.role]: context.role,
    [PROJECT_CONTEXT_HEADERS.requestId]: requestId,
    [PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
    [PROJECT_CONTEXT_HEADERS.version]: "1",
    [PROJECT_CONTEXT_HEADERS.signature]: signature,
    "x-opengrow-application-user-id": identity.id,
    "x-opengrow-application-email": identity.email,
  });
  if (identity.name) headers.set("x-opengrow-application-name", identity.name);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  if (body) headers.set("content-type", "application/json; charset=UTF-8");

  try {
    const response = await c.env.MARKETING_MODULE.fetch(internalUrl, {
      method: c.req.method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("cache-control", "private, no-store");
    responseHeaders.set("x-request-id", requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "marketing_sdk_proxy_failed",
        project_ref: project.projectRef,
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return failure(
      c,
      503,
      "marketing_unavailable",
      "Marketing preferences are unavailable",
      true,
    );
  }
});

async function applicationProject(c: MarketingSdkContext): Promise<
  | {
      projectId: number;
      instanceId: number;
      projectRef: string;
      environment: "production" | "test";
    }
  | Response
> {
  const projectId = Number(c.get("projectId"));
  const instanceId = Number(c.get("instanceId"));
  if (
    !Number.isSafeInteger(projectId) ||
    projectId <= 0 ||
    !Number.isSafeInteger(instanceId) ||
    instanceId <= 0
  ) {
    return failure(
      c,
      403,
      "sdk_project_invalid",
      "A valid SDK project is required",
    );
  }
  const project = await c.env.DB.prepare(
    "SELECT id, instance_id, COALESCE(is_test, test, 0) is_test FROM projects WHERE id = ? AND instance_id = ? LIMIT 1",
  )
    .bind(projectId, instanceId)
    .first<{ id: number; instance_id: number; is_test: number }>();
  if (!project) {
    return failure(
      c,
      403,
      "sdk_project_invalid",
      "A valid SDK project is required",
    );
  }
  const environment = Number(project.is_test) === 1 ? "test" : "production";
  return {
    projectId,
    instanceId,
    environment,
    projectRef: `${instanceId}-${environment === "test" ? "test" : "prod"}`,
  };
}

async function applicationIdentity(
  c: MarketingSdkContext,
): Promise<{ id: string; email: string; name: string | null } | Response> {
  const authorization = c.req.header("Authorization")?.trim() || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return failure(
      c,
      401,
      "identity_required",
      "An application identity token is required",
    );
  }
  if (!c.env.IDENTITY_SERVICE) {
    return failure(
      c,
      503,
      "identity_unavailable",
      "Application identity verification is unavailable",
      true,
    );
  }
  let response: Response;
  try {
    response = await c.env.IDENTITY_SERVICE.fetch(
      "https://identity.internal/auth/me",
      {
        headers: {
          authorization,
          accept: "application/json",
          "x-request-id": requestIdFrom(c.req.raw),
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return failure(
      c,
      503,
      "identity_unavailable",
      "Application identity verification is unavailable",
      true,
    );
  }
  if (response.status === 401) {
    return failure(
      c,
      401,
      "identity_invalid",
      "The application identity token is invalid",
    );
  }
  if (!response.ok) {
    return failure(
      c,
      503,
      "identity_unavailable",
      "Application identity verification is unavailable",
      true,
    );
  }
  let payload: Record<string, unknown>;
  try {
    payload = await readJsonObjectLimited(
      response,
      32_768,
      "Identity response is too large",
    );
  } catch {
    return failure(
      c,
      503,
      "identity_unavailable",
      "Application identity verification is unavailable",
      true,
    );
  }
  const user = objectValue(payload.user);
  const id = textValue(user.id, 255);
  const email = textValue(user.email, 320).toLowerCase();
  const name = optionalTextValue(user.name, 120);
  if (
    !id ||
    user.email_verified !== true ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return failure(
      c,
      422,
      "verified_email_required",
      "A verified application email is required for Marketing preferences",
    );
  }
  return { id, email, name };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requestObject(value: unknown, field: string): Record<string, unknown> {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketingInputError(
      `${field}_invalid`,
      `${field} must be a JSON object`,
    );
  }
  return value as Record<string, unknown>;
}

function requestStringArray(
  value: unknown,
  field: string,
  maximum: number,
): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new MarketingInputError(
      `${field}_invalid`,
      `${field} must contain at most ${maximum} identifiers`,
    );
  }
  if (value.some((item) => typeof item !== "string")) {
    throw new MarketingInputError(
      `${field}_invalid`,
      `${field} must contain only string identifiers`,
    );
  }
  const values = value.map((item) => item.trim());
  if (
    values.some((item) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item))
  ) {
    throw new MarketingInputError(
      `${field}_invalid`,
      `${field} contains an invalid identifier`,
    );
  }
  return [...new Set(values)];
}

class MarketingInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function textValue(value: unknown, maximum: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= maximum ? text : "";
}

function optionalTextValue(value: unknown, maximum: number): string | null {
  return textValue(value, maximum) || null;
}

function requestIdFrom(request: Request): string {
  const value = request.headers.get("x-request-id")?.trim() || "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

function failure(
  c: MarketingSdkContext,
  status: number,
  code: string,
  message: string,
  retryable = false,
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        status,
        retryable,
        request_id: requestIdFrom(c.req.raw),
      },
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export default marketingSdk;
