import type { Context, MiddlewareHandler } from "hono";
import { verifyInternalProjectContextRequest } from "@superboard/contracts/project-context";
import { configuredSecrets } from "@superboard/contracts/secret";

export type ProjectContext = {
  projectId: string;
  projectRef: string;
  instanceId: string;
  environment: string;
  actorId: string;
  role: string;
  requestId: string;
};
export type WorkerBindings = Env;
export type WorkerVariables = { project: ProjectContext };
export type WorkerContext = Context<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

export function internalAuth(): MiddlewareHandler<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}> {
  return async (c, next) => {
    const verified = await verifyInternalProjectContextRequest(
      c.req.raw,
      configuredSecrets(
        c.env.INTERNAL_API_TOKEN,
        c.env.INTERNAL_API_TOKEN_PREVIOUS,
      ),
      "paywalls",
    );
    if (!verified.ok)
      throw httpError(
        verified.code,
        verified.message,
        verified.code === "internal_auth_invalid" ? 401 : 403,
      );
    const context: ProjectContext = {
      projectId: String(verified.context.projectId),
      projectRef: verified.context.projectRef,
      instanceId: String(verified.context.instanceId),
      environment: verified.context.environment,
      actorId: String(verified.context.actorId),
      role: verified.context.role,
      requestId: verified.context.requestId,
    };
    c.set("project", context);
    await next();
  };
}

export function errorResponse(error: unknown, c: WorkerContext): Response {
  const known = error as { code?: string; status?: number; message?: string };
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
  if (status >= 500)
    console.error(
      JSON.stringify({
        event: "paywalls_request_failed",
        request_id: requestId,
        path: c.req.path,
        error: known.message ?? String(error),
      }),
    );
  return json(
    {
      error: {
        code: known.code ?? "paywalls_internal_error",
        message:
          status >= 500
            ? "Paywalls is temporarily unavailable"
            : (known.message ?? "Request failed"),
        status,
        request_id: requestId,
      },
    },
    status,
  );
}
export function httpError(
  code: string,
  message: string,
  status: number,
): Error {
  return Object.assign(new Error(message), { code, status });
}
export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}

export async function readJson(
  request: Request,
  limit = 1_048_576,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit)
    throw httpError(
      "request_too_large",
      `Request body is limited to ${limit} bytes`,
      413,
    );
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

export async function commitMutation(
  c: WorkerContext,
  mutation: {
    action: string;
    entityType: string;
    entityId: string;
    requestBody: unknown;
    status?: number;
    data: unknown;
    statements: D1PreparedStatement[];
  },
): Promise<Response> {
  const key = c.req.header("idempotency-key")?.trim();
  if (!key || key.length > 255)
    throw httpError(
      "idempotency_key_required",
      "Idempotency-Key is required for mutations",
      400,
    );
  const project = c.get("project");
  const hash = await requestHash(mutation.requestBody);
  const replay = await findReplay(c.env.DB, project.projectId, key);
  if (replay) return replayResponse(replay, c.req.method, c.req.path, hash);
  const status = mutation.status ?? 200;
  const responseJson = JSON.stringify({ data: mutation.data });
  const timestamp = new Date().toISOString();
  const idempotency = c.env.DB.prepare(
    `INSERT INTO idempotency_keys (project_id,key,response_json,created_at,method,path,request_hash,status_code) VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(
    project.projectId,
    key,
    responseJson,
    timestamp,
    c.req.method,
    c.req.path,
    hash,
    status,
  );
  const audit = c.env.DB.prepare(
    `INSERT INTO audit_events (id,project_id,action,payload_json,created_at,actor_id,actor_role,project_ref,environment,entity_type,entity_id,request_id,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(),
    project.projectId,
    mutation.action,
    JSON.stringify(mutation.requestBody ?? {}),
    timestamp,
    project.actorId,
    project.role,
    project.projectRef,
    project.environment,
    mutation.entityType,
    mutation.entityId,
    project.requestId,
    timestamp,
  );
  try {
    await c.env.DB.batch([idempotency, ...mutation.statements, audit]);
  } catch (error) {
    const concurrent = await findReplay(c.env.DB, project.projectId, key);
    if (concurrent)
      return replayResponse(concurrent, c.req.method, c.req.path, hash);
    throw normalizeD1Error(error);
  }
  return new Response(responseJson, {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "x-request-id": project.requestId,
    },
  });
}

function normalizeD1Error(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message))
    return httpError(
      "resource_conflict",
      "A resource with the same identifier already exists",
      409,
    );
  if (/FOREIGN KEY constraint failed/i.test(message))
    return httpError(
      "relationship_invalid",
      "A referenced resource is missing or still in use",
      422,
    );
  return error;
}

type Replay = {
  method: string;
  path: string;
  request_hash: string;
  status_code: number;
  response_json: string;
};
async function findReplay(
  db: D1Database,
  projectId: string,
  key: string,
): Promise<Replay | null> {
  return db
    .prepare(
      "SELECT method,path,request_hash,status_code,response_json FROM idempotency_keys WHERE project_id=? AND key=?",
    )
    .bind(projectId, key)
    .first<Replay>();
}
function replayResponse(
  replay: Replay,
  method: string,
  path: string,
  hash: string,
): Response {
  if (
    replay.method !== method ||
    replay.path !== path ||
    replay.request_hash !== hash
  )
    throw httpError(
      "idempotency_conflict",
      "Idempotency-Key was already used for a different request",
      409,
    );
  return new Response(replay.response_json, {
    status: replay.status_code,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "idempotency-replayed": "true",
    },
  });
}
async function requestHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
