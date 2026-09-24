import { Hono } from "hono";
import { readJsonObjectLimited } from "../lib/http-limits";
import {
  AccountErasureError,
  eraseApplicationAccount,
} from "../lib/account-erasure";
import type { AppVariables, Env } from "../types";

const accountSdk = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

accountSdk.delete("/", async (c) => {
  const requestId = requestIdFrom(c.req.raw);
  try {
    const projectId = Number(c.get("projectId"));
    const instanceId = Number(c.get("instanceId"));
    if (
      !Number.isSafeInteger(projectId) ||
      projectId <= 0 ||
      !Number.isSafeInteger(instanceId) ||
      instanceId <= 0
    ) {
      return failure(c, 403, "sdk_project_invalid", false, requestId);
    }
    const project = await c.env.DB.prepare(
      `SELECT id, instance_id, COALESCE(is_test, test, 0) is_test
       FROM projects WHERE id = ? AND instance_id = ? LIMIT 1`,
    )
      .bind(projectId, instanceId)
      .first<{ id: number; instance_id: number; is_test: number }>();
    if (!project) {
      return failure(c, 403, "sdk_project_invalid", false, requestId);
    }
    const identity = await authenticatedIdentity(c.env, c.req.raw, requestId);
    if (identity instanceof Response) return identity;
    const environment = Number(project.is_test) === 1 ? "test" : "production";
    const result = await eraseApplicationAccount(
      c.env,
      {
        projectId,
        instanceId,
        projectRef: `${instanceId}-${environment === "test" ? "test" : "prod"}`,
        environment,
      },
      identity.id,
      requestId,
    );
    return c.json(
      {
        data: {
          deleted: result.status === "completed",
          status: result.status,
          operation_id: result.operationId,
          completed_steps: result.completedSteps,
        },
      },
      result.status === "completed" ? 200 : 202,
      { "cache-control": "private, no-store", "x-request-id": requestId },
    );
  } catch (error) {
    const resolved =
      error instanceof AccountErasureError
        ? error
        : new AccountErasureError("account_erasure_internal_error", "gateway");
    return failure(
      c,
      resolved.status,
      resolved.code,
      resolved.retryable,
      requestId,
    );
  }
});

async function authenticatedIdentity(
  env: Env,
  request: Request,
  requestId: string,
): Promise<{ id: string } | Response> {
  const authorization = request.headers.get("authorization")?.trim() || "";
  if (!/^Bearer\s+\S+$/iu.test(authorization)) {
    return failureResponse(401, "identity_required", false, requestId);
  }
  if (!env.IDENTITY_SERVICE) {
    return failureResponse(503, "identity_unavailable", true, requestId);
  }
  let response: Response;
  try {
    response = await env.IDENTITY_SERVICE.fetch(
      "https://identity.internal/auth/me",
      {
        headers: { authorization, "x-request-id": requestId },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return failureResponse(503, "identity_unavailable", true, requestId);
  }
  if (response.status === 401) {
    response.body?.cancel().catch(() => undefined);
    return failureResponse(401, "identity_invalid", false, requestId);
  }
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined);
    return failureResponse(503, "identity_unavailable", true, requestId);
  }
  try {
    const payload = await readJsonObjectLimited(
      response,
      32_768,
      "Identity response is too large",
    );
    const user =
      payload.user &&
      typeof payload.user === "object" &&
      !Array.isArray(payload.user)
        ? (payload.user as Record<string, unknown>)
        : {};
    const id = typeof user.id === "string" ? user.id.trim() : "";
    if (!id) throw new Error("identity_subject_missing");
    return { id };
  } catch {
    return failureResponse(503, "identity_unavailable", true, requestId);
  }
}

function failure(
  c: any,
  status: number,
  code: string,
  retryable: boolean,
  requestId: string,
) {
  return c.json(
    {
      error: {
        code,
        message: publicMessage(code),
        status,
        retryable,
        request_id: requestId,
      },
    },
    status,
    { "cache-control": "private, no-store", "x-request-id": requestId },
  );
}

function failureResponse(
  status: number,
  code: string,
  retryable: boolean,
  requestId: string,
) {
  return Response.json(
    {
      error: {
        code,
        message: publicMessage(code),
        status,
        retryable,
        request_id: requestId,
      },
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-request-id": requestId,
      },
    },
  );
}

function publicMessage(code: string): string {
  if (code === "identity_required") return "Authentication is required";
  if (code === "identity_invalid")
    return "Authentication is invalid or expired";
  if (code === "sdk_project_invalid") return "A valid SDK project is required";
  return code.endsWith("_invalid")
    ? "The account deletion request is invalid"
    : "Account deletion is temporarily unavailable";
}

function requestIdFrom(request: Request): string {
  const value = request.headers.get("x-request-id")?.trim() || "";
  return /^[A-Za-z0-9._:-]{1,128}$/u.test(value) ? value : crypto.randomUUID();
}

export default accountSdk;
