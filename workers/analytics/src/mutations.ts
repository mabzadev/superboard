import { stableAnalyticsJson } from "@superboard/contracts/analytics";
import type { ProjectContext } from "@superboard/contracts/project-context";
import { sha256Hex } from "./crypto";
import { httpError } from "./http";

type StoredMutation = {
  method: string;
  path: string;
  request_sha256: string;
  status_code: number;
  response_json: string;
};

export type AnalyticsMutation = {
  project: ProjectContext;
  idempotencyKey: string | undefined;
  method: string;
  path: string;
  action: string;
  entityType: string;
  entityId: string;
  requestBody: unknown;
  data: unknown;
  statements: D1PreparedStatement[];
  status?: number;
};

export async function commitAnalyticsMutation(
  db: D1Database,
  mutation: AnalyticsMutation,
): Promise<{ data: unknown; status: number; replayed: boolean }> {
  const key = mutation.idempotencyKey?.trim();
  if (!key || key.length > 255) {
    throw httpError(
      "idempotency_key_required",
      "Idempotency-Key is required for mutations",
      400,
    );
  }
  const projectId = String(mutation.project.projectId);
  const requestHash = await sha256Hex(
    stableAnalyticsJson(mutation.requestBody ?? {}),
  );
  const replay = await findReplay(db, projectId, key);
  if (replay) {
    return replayMutation(replay, mutation.method, mutation.path, requestHash);
  }
  const status = mutation.status ?? 200;
  const responseJson = JSON.stringify({ data: mutation.data });
  const idempotency = db
    .prepare(
      `INSERT INTO analytics_idempotency_keys
        (project_id, key, method, path, request_sha256, status_code, response_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      projectId,
      key,
      mutation.method,
      mutation.path,
      requestHash,
      status,
      responseJson,
    );
  const audit = db
    .prepare(
      `INSERT INTO analytics_audit_events
        (id, project_id, actor_id, actor_role, action, entity_type, entity_id,
         request_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      projectId,
      String(mutation.project.actorId),
      mutation.project.role,
      mutation.action,
      mutation.entityType,
      mutation.entityId,
      mutation.project.requestId,
      stableAnalyticsJson(mutation.requestBody ?? {}),
    );
  try {
    await db.batch([idempotency, ...mutation.statements, audit]);
  } catch (error) {
    const concurrent = await findReplay(db, projectId, key);
    if (concurrent) {
      return replayMutation(
        concurrent,
        mutation.method,
        mutation.path,
        requestHash,
      );
    }
    throw error;
  }
  return { data: mutation.data, status, replayed: false };
}

async function findReplay(
  db: D1Database,
  projectId: string,
  key: string,
): Promise<StoredMutation | null> {
  return db
    .prepare(
      `SELECT method, path, request_sha256, status_code, response_json
       FROM analytics_idempotency_keys WHERE project_id = ? AND key = ?`,
    )
    .bind(projectId, key)
    .first<StoredMutation>();
}

function replayMutation(
  replay: StoredMutation,
  method: string,
  path: string,
  requestHash: string,
): { data: unknown; status: number; replayed: boolean } {
  if (
    replay.method !== method ||
    replay.path !== path ||
    replay.request_sha256 !== requestHash
  ) {
    throw httpError(
      "idempotency_key_conflict",
      "Idempotency-Key has already been used for a different request",
      409,
    );
  }
  const parsed = JSON.parse(replay.response_json) as { data?: unknown };
  return {
    data: parsed.data,
    status: Number(replay.status_code),
    replayed: true,
  };
}
