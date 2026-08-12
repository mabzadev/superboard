import type { Context, MiddlewareHandler } from "hono";
import {
  verifyInternalProjectContextRequest,
  type ProjectContext,
} from "@superboard/contracts/project-context";
import { configuredSecrets } from "@superboard/contracts/secret";
import type { Env } from "./types";

export type AnalyticsBindings = Env;
export type AnalyticsVariables = { project: ProjectContext };
export type AnalyticsContext = Context<{
  Bindings: AnalyticsBindings;
  Variables: AnalyticsVariables;
}>;

export function internalAuth(): MiddlewareHandler<{
  Bindings: AnalyticsBindings;
  Variables: AnalyticsVariables;
}> {
  return async (c, next) => {
    const verified = await verifyInternalProjectContextRequest(
      c.req.raw,
      configuredSecrets(
        c.env.INTERNAL_API_TOKEN,
        c.env.INTERNAL_API_TOKEN_PREVIOUS,
      ),
      "analytics",
    );
    if (!verified.ok) {
      throw httpError(
        verified.code,
        verified.message,
        verified.code === "internal_auth_invalid" ? 401 : 403,
      );
    }
    c.set("project", verified.context);
    await next();
  };
}

export function errorResponse(error: unknown, c: AnalyticsContext): Response {
  const known = error as {
    code?: string;
    status?: number;
    message?: string;
    details?: unknown;
  };
  const status =
    Number.isInteger(known.status) &&
    Number(known.status) >= 400 &&
    Number(known.status) <= 599
      ? Number(known.status)
      : 500;
  const requestId =
    c.get("project")?.requestId ??
    c.req.header("x-request-id") ??
    crypto.randomUUID();
  if (status >= 500) {
    console.error(
      JSON.stringify({
        event: "analytics_request_failed",
        request_id: requestId,
        path: c.req.path,
        error: known.message ?? String(error),
      }),
    );
  }
  return json(
    {
      error: {
        code: known.code ?? "analytics_internal_error",
        message:
          status >= 500
            ? "Analytics is temporarily unavailable"
            : (known.message ?? "Request failed"),
        status,
        retryable: status >= 500,
        request_id: requestId,
        ...(known.details === undefined ? {} : { details: known.details }),
      },
    },
    status,
  );
}

export function httpError(
  code: string,
  message: string,
  status = 422,
  details?: unknown,
): Error {
  return Object.assign(new Error(message), { code, status, details });
}

export async function readJson(
  request: Request,
  limit = 1_048_576,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) {
    throw httpError(
      "request_too_large",
      `Request body is limited to ${limit} bytes`,
      413,
    );
  }
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw httpError(
        "request_too_large",
        `Request body is limited to ${limit} bytes`,
        413,
      );
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes) || "{}");
  } catch {
    throw httpError("invalid_json", "Request body must be valid JSON", 400);
  }
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

export function positiveLimit(value: string | undefined, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 250)
    : fallback;
}

export function optionalIsoTimestamp(
  value: string | undefined,
  field: string,
): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw httpError(
      "analytics_timestamp_invalid",
      `${field} must be a valid ISO 8601 timestamp`,
      400,
    );
  }
  return new Date(parsed).toISOString();
}
