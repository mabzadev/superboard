import {
  CUSTOM_WORKER_JOB_CANCEL_SUFFIX,
  CUSTOM_WORKER_JOB_PATH,
  CUSTOM_WORKER_PROJECT_HEADER,
  CUSTOM_WORKER_SUBJECT_HEADER,
  CustomWorkerProtocolError,
  parseCustomWorkerJob,
} from "@opengrow/contracts/custom-worker";
import {
  RequestBodyError,
  readRequestObjectLimited,
} from "@opengrow/contracts/request-body";
import { Hono } from "hono";
import type { AppVariables, Env } from "../types";
import { verifiedAppUserId } from "../lib/billing-identity";

const customSdk = new Hono<{ Bindings: Env; Variables: AppVariables }>();

class CustomSdkIdentityRejectedError extends Error {}
class CustomSdkDependencyUnavailableError extends Error {}

customSdk.post("/jobs", async (c) => {
  try {
    const context = await applicationContext(c);
    if (context instanceof Response) return context;
    const rawIdempotencyKey = c.req.header("Idempotency-Key")?.trim() || "";
    if (!rawIdempotencyKey || rawIdempotencyKey.length > 255) {
      return failure(
        c,
        400,
        "idempotency_key_invalid",
        "A valid Idempotency-Key is required",
      );
    }
    const body = await readRequestObjectLimited(c.req.raw, 70_000);
    const capability =
      typeof body.capability === "string" ? body.capability.trim() : "";
    const payload = body.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return failure(c, 422, "payload_invalid", "payload must be an object");
    }
    const businessPayload = { ...(payload as Record<string, unknown>) };
    for (const identityField of [
      "userId",
      "user_id",
      "subject",
      "projectRef",
      "project_ref",
    ]) {
      delete businessPayload[identityField];
    }
    const job = parseCustomWorkerJob({
      idempotencyKey: await scopedIdempotencyKey(
        context.projectRef,
        context.subject,
        rawIdempotencyKey,
      ),
      projectRef: context.projectRef,
      capability,
      payload: businessPayload,
      requestedAt: new Date().toISOString(),
    });
    return proxyCustom(c, CUSTOM_WORKER_JOB_PATH, context, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job),
    });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return failure(c, error.status, error.code, error.message);
    }
    if (error instanceof CustomWorkerProtocolError) {
      return failure(c, 422, error.code, "The custom job request is invalid");
    }
    return contextFailure(c, error);
  }
});

customSdk.get("/jobs", async (c) => {
  try {
    const context = await applicationContext(c);
    if (context instanceof Response) return context;
    const query = selectedQuery(c.req.url);
    return proxyCustom(c, `${CUSTOM_WORKER_JOB_PATH}${query}`, context);
  } catch (error) {
    return contextFailure(c, error);
  }
});

customSdk.get("/jobs/:jobId", async (c) => {
  try {
    const context = await applicationContext(c);
    if (context instanceof Response) return context;
    const jobId = validJobId(c.req.param("jobId"));
    if (!jobId) {
      return failure(c, 422, "job_id_invalid", "The job identifier is invalid");
    }
    return proxyCustom(
      c,
      `${CUSTOM_WORKER_JOB_PATH}/${encodeURIComponent(jobId)}`,
      context,
    );
  } catch (error) {
    return contextFailure(c, error);
  }
});

customSdk.post("/jobs/:jobId/cancel", async (c) => {
  try {
    const context = await applicationContext(c);
    if (context instanceof Response) return context;
    const jobId = validJobId(c.req.param("jobId"));
    if (!jobId) {
      return failure(c, 422, "job_id_invalid", "The job identifier is invalid");
    }
    return proxyCustom(
      c,
      `${CUSTOM_WORKER_JOB_PATH}/${encodeURIComponent(jobId)}${CUSTOM_WORKER_JOB_CANCEL_SUFFIX}`,
      context,
      { method: "POST" },
    );
  } catch (error) {
    return contextFailure(c, error);
  }
});

function validJobId(value: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

async function applicationContext(
  c: any,
): Promise<{ projectRef: string; subject: string } | Response> {
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
  const authorization = c.req.header("Authorization")?.trim() || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return failure(
      c,
      401,
      "identity_required",
      "An application identity token is required",
    );
  }
  let project: { id: number; instance_id: number; is_test: number } | null;
  try {
    project = (await c.env.DB.prepare(
      "SELECT id, instance_id, COALESCE(is_test, test, 0) is_test FROM projects WHERE id = ? AND instance_id = ? LIMIT 1",
    )
      .bind(projectId, instanceId)
      .first()) as typeof project;
  } catch {
    throw new CustomSdkDependencyUnavailableError("project_store_unavailable");
  }
  if (!project)
    return failure(
      c,
      403,
      "sdk_project_invalid",
      "A valid SDK project is required",
    );
  let subject: string | null;
  try {
    subject = await verifiedAppUserId(c.env, projectId, authorization);
  } catch (error) {
    if (isRejectedIdentity(error))
      throw new CustomSdkIdentityRejectedError("identity_rejected");
    throw new CustomSdkDependencyUnavailableError(
      "identity_provider_unavailable",
    );
  }
  if (!subject)
    return failure(
      c,
      401,
      "identity_required",
      "An application identity token is required",
    );
  return {
    projectRef: `${instanceId}-${Number(project.is_test) === 1 ? "test" : "prod"}`,
    subject,
  };
}

async function scopedIdempotencyKey(
  projectRef: string,
  subject: string,
  provided: string,
) {
  const bytes = new TextEncoder().encode(
    `${projectRef}\u0000${subject}\u0000${provided}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sdk:v1:${hash}`;
}

function selectedQuery(rawUrl: string): string {
  const source = new URL(rawUrl).searchParams;
  const selected = new URLSearchParams();
  for (const name of ["limit", "status", "capability", "cursor"]) {
    const value = source.get(name);
    if (value !== null) selected.set(name, value);
  }
  const value = selected.toString();
  return value ? `?${value}` : "";
}

async function proxyCustom(
  c: any,
  path: string,
  scope: { projectRef: string; subject: string },
  init: RequestInit = {},
): Promise<Response> {
  if (!c.env.CUSTOM_WORKER) {
    return failure(
      c,
      404,
      "custom_worker_disabled",
      "This application has no custom job service",
    );
  }
  if (!c.env.CUSTOM_WORKER_TOKEN) {
    return failure(
      c,
      503,
      "custom_worker_misconfigured",
      "The custom job service is unavailable",
      true,
    );
  }
  const headers = new Headers(init.headers);
  headers.set("x-custom-worker-token", c.env.CUSTOM_WORKER_TOKEN);
  headers.set(CUSTOM_WORKER_PROJECT_HEADER, scope.projectRef);
  headers.set(CUSTOM_WORKER_SUBJECT_HEADER, scope.subject);
  try {
    const response = await c.env.CUSTOM_WORKER.fetch(
      `https://custom.internal${path}`,
      {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(10_000),
      },
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ||
          "application/json; charset=UTF-8",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId(c),
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "custom_sdk_proxy_failed",
        path: path.split("?", 1)[0],
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return failure(
      c,
      503,
      "custom_worker_unavailable",
      "The custom job service is unavailable",
      true,
    );
  }
}

function isRejectedIdentity(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  const code =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code)
      : "";
  return (
    code.startsWith("ERR_JWT_") ||
    code.startsWith("ERR_JWS_") ||
    code.startsWith("ERR_JWK_") ||
    code === "ERR_JWKS_NO_MATCHING_KEY" ||
    [
      "Invalid identity token",
      "Identity token issuer is missing",
      "Identity provider is not configured for this project",
      "Identity token subject is invalid",
    ].includes(message)
  );
}

function contextFailure(c: any, error: unknown): Response {
  if (error instanceof CustomSdkDependencyUnavailableError) {
    console.error(
      JSON.stringify({
        event: "custom_sdk_identity_unavailable",
        requestId: requestId(c),
        reason: error.message,
      }),
    );
    return failure(
      c,
      503,
      "identity_unavailable",
      "Application identity verification is temporarily unavailable",
      true,
    );
  }
  console.warn(
    JSON.stringify({
      event: "custom_sdk_identity_rejected",
      requestId: requestId(c),
      reason:
        error instanceof CustomSdkIdentityRejectedError
          ? error.message
          : "identity_rejected",
    }),
  );
  return failure(
    c,
    401,
    "identity_invalid",
    "The application identity token is invalid",
  );
}

function failure(
  c: any,
  status: number,
  code: string,
  message: string,
  retryable = false,
): Response {
  return Response.json(
    {
      error: { code, message, status, retryable, request_id: requestId(c) },
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId(c),
      },
    },
  );
}

function requestId(c: any): string {
  const existing = c.get("customRequestId");
  if (typeof existing === "string" && existing) return existing;
  const value = c.req.header("x-request-id")?.trim() || "";
  const resolved = /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : crypto.randomUUID();
  c.set("customRequestId", resolved);
  return resolved;
}

export default customSdk;
