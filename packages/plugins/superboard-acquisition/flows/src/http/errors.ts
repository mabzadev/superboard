import type { Context } from "hono";
import type { FlowApiError } from "@superboard/contracts/flows";

export class FlowHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503,
    readonly details?: Record<string, unknown>,
    readonly retryable = status >= 500,
  ) {
    super(message);
  }
}

export function failure(
  code: string,
  message: string,
  status: FlowHttpError["status"],
  details?: Record<string, unknown>,
): FlowHttpError {
  return new FlowHttpError(code, message, status, details);
}

export function errorResponse(error: unknown, context: Context): Response {
  const requestId =
    context.req.header("x-request-id") ||
    context.req.header("x-context-request-id") ||
    crypto.randomUUID();
  const known =
    error instanceof FlowHttpError
      ? error
      : new FlowHttpError(
          "flows_internal_error",
          "Flows is temporarily unavailable",
          500,
        );
  if (!(error instanceof FlowHttpError)) {
    console.error(
      JSON.stringify({
        event: "flows_unhandled_error",
        request_id: requestId,
        path: new URL(context.req.url).pathname,
        method: context.req.method,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const body: FlowApiError = {
    message: known.message,
    error: {
      code: known.code,
      message: known.message,
      request_id: requestId,
      retryable: known.retryable,
      ...(known.details ? { details: known.details } : {}),
    },
  };
  return Response.json(body, {
    status: known.status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}
