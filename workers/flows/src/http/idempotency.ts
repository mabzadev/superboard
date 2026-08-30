import type { MiddlewareHandler } from "hono";
import {
  readBytesLimited,
  RequestBodyError,
} from "@superboard/contracts/request-body";
import type { FlowApp } from "./auth";
import { failure } from "./errors";

const ADMIN_SCOPE = "project-admin";
const CLAIM_STATUS = 102;
const CLAIM_LEASE_MS = 60_000;
const CLAIM_RENEW_INTERVAL_MS = 20_000;
const REPLAY_POLL_INTERVAL_MS = 20;
const REPLAY_POLL_ATTEMPTS = 100;
const MAX_IDEMPOTENCY_BODY_BYTES = 1_048_576;
const MAX_STORED_RESPONSE_BYTES = 1_048_576;

type IdempotencyRow = {
  request_hash: string;
  response_status: number;
  response_json: string;
  created_at: string;
};

type PendingClaim = {
  kind: "claim";
  version: 1;
  owner: string;
  lease_expires_at: string;
};

type StoredResponse = {
  kind: "response";
  version: 1;
  body_base64: string;
  headers: Array<[string, string]>;
  status_text: string;
};

type ClaimHandle = {
  owner: string;
  serialized: string;
  lost: boolean;
};

type ClaimResult =
  | { kind: "claimed"; handle: ClaimHandle }
  | { kind: "replay"; response: Response };

type ClaimHeartbeat = {
  stop: () => Promise<boolean>;
};

export function replayProjectMutation(): MiddlewareHandler<FlowApp> {
  return async (context, next) => {
    if (!isReplayableMutation(context.req.method, context.req.path)) {
      await next();
      return;
    }
    const key = context.req.header("idempotency-key")?.trim() ?? "";
    if (!key) {
      throw failure(
        "idempotency_key_required",
        "Idempotency-Key is required for mutating requests",
        400,
      );
    }
    if (key.length > 255) {
      throw failure(
        "idempotency_key_invalid",
        "Idempotency-Key must not exceed 255 characters",
        422,
      );
    }

    const projectId = context.get("flowProject").projectId;
    const requestHash = await hashRequest(context.req.raw);
    const acquisition = await acquireClaim(
      context.env.DB,
      projectId,
      key,
      requestHash,
    );
    if (acquisition.kind === "replay") {
      context.res = acquisition.response;
      return;
    }

    const { handle } = acquisition;
    const heartbeat = startClaimHeartbeat(
      context.env.DB,
      projectId,
      key,
      requestHash,
      handle,
    );
    try {
      await next();
    } catch (error) {
      await heartbeat.stop();
      await releaseClaim(
        context.env.DB,
        projectId,
        key,
        requestHash,
        handle.serialized,
      );
      throw error;
    }

    const stillOwned = await heartbeat.stop();
    if (!stillOwned) {
      throw failure(
        "idempotency_claim_lost",
        "The idempotency claim expired before the request completed",
        409,
      );
    }
    if (context.res.status >= 500) {
      await releaseClaim(
        context.env.DB,
        projectId,
        key,
        requestHash,
        handle.serialized,
      );
      return;
    }

    let stored: string;
    try {
      stored = await serializeResponse(context.res.clone());
    } catch (error) {
      await releaseClaim(
        context.env.DB,
        projectId,
        key,
        requestHash,
        handle.serialized,
      );
      if (error instanceof RequestBodyError && error.code === "body_too_large") {
        throw failure(
          "idempotency_response_too_large",
          "The mutation response is too large to store for idempotent replay",
          500,
          { maximum_bytes: MAX_STORED_RESPONSE_BYTES },
        );
      }
      throw error;
    }
    const finalized = await context.env.DB.prepare(
      `UPDATE flow_idempotency_keys
       SET response_status = ?, response_json = ?
       WHERE project_id = ? AND scope = ? AND idempotency_key = ?
         AND request_hash = ? AND response_status = ? AND response_json = ?`,
    ).bind(
      context.res.status,
      stored,
      projectId,
      ADMIN_SCOPE,
      key,
      requestHash,
      CLAIM_STATUS,
      handle.serialized,
    ).run();
    if (Number(finalized.meta.changes ?? 0) !== 1) {
      throw failure(
        "idempotency_claim_lost",
        "The idempotency claim expired before its response was recorded",
        409,
      );
    }
  };
}

function isReplayableMutation(method: string, pathname: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) &&
    !pathname.endsWith("/commerce/resolve");
}

async function acquireClaim(
  db: D1Database,
  projectId: number,
  key: string,
  requestHash: string,
): Promise<ClaimResult> {
  const owner = crypto.randomUUID();
  let candidate = serializeClaim(owner);
  const inserted = await insertClaim(
    db,
    projectId,
    key,
    requestHash,
    candidate,
  );
  if (inserted) {
    return {
      kind: "claimed",
      handle: { owner, serialized: candidate, lost: false },
    };
  }

  for (let attempt = 0; attempt < REPLAY_POLL_ATTEMPTS; attempt += 1) {
    const existing = await readReplay(db, projectId, key);
    if (!existing) {
      candidate = serializeClaim(owner);
      if (await insertClaim(db, projectId, key, requestHash, candidate)) {
        return {
          kind: "claimed",
          handle: { owner, serialized: candidate, lost: false },
        };
      }
      continue;
    }
    assertMatchingRequest(existing, requestHash);
    if (existing.response_status !== CLAIM_STATUS) {
      return {
        kind: "replay",
        response: replayResponse(existing.response_status, existing.response_json),
      };
    }

    if (claimExpired(existing)) {
      candidate = serializeClaim(owner);
      const recovered = await db.prepare(
        `UPDATE flow_idempotency_keys
         SET response_json = ?, created_at = ?
         WHERE project_id = ? AND scope = ? AND idempotency_key = ?
           AND request_hash = ? AND response_status = ?
           AND response_json = ? AND created_at = ?`,
      ).bind(
        candidate,
        new Date().toISOString(),
        projectId,
        ADMIN_SCOPE,
        key,
        requestHash,
        CLAIM_STATUS,
        existing.response_json,
        existing.created_at,
      ).run();
      if (Number(recovered.meta.changes ?? 0) === 1) {
        return {
          kind: "claimed",
          handle: { owner, serialized: candidate, lost: false },
        };
      }
      continue;
    }
    await sleep(REPLAY_POLL_INTERVAL_MS);
  }

  throw failure(
    "idempotency_request_in_progress",
    "The request using this Idempotency-Key is still in progress",
    409,
  );
}

async function insertClaim(
  db: D1Database,
  projectId: number,
  key: string,
  requestHash: string,
  serializedClaim: string,
): Promise<boolean> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO flow_idempotency_keys
      (project_id, scope, idempotency_key, request_hash,
       response_status, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    projectId,
    ADMIN_SCOPE,
    key,
    requestHash,
    CLAIM_STATUS,
    serializedClaim,
    new Date().toISOString(),
  ).run();
  return Number(inserted.meta.changes ?? 0) === 1;
}

function startClaimHeartbeat(
  db: D1Database,
  projectId: number,
  key: string,
  requestHash: string,
  handle: ClaimHandle,
): ClaimHeartbeat {
  let stopRequested = false;
  let wakeStop: (() => void) | undefined;
  const stopSignal = new Promise<void>((resolve) => {
    wakeStop = resolve;
  });
  const operation = (async () => {
    while (!stopRequested && !handle.lost) {
      const interval = sleep(CLAIM_RENEW_INTERVAL_MS).then(() => "renew" as const);
      const outcome = await Promise.race([
        interval,
        stopSignal.then(() => "stop" as const),
      ]);
      if (outcome === "stop" || stopRequested) break;

      const nextClaim = serializeClaim(handle.owner);
      try {
        const renewed = await db.prepare(
          `UPDATE flow_idempotency_keys
           SET response_json = ?, created_at = ?
           WHERE project_id = ? AND scope = ? AND idempotency_key = ?
             AND request_hash = ? AND response_status = ? AND response_json = ?`,
        ).bind(
          nextClaim,
          new Date().toISOString(),
          projectId,
          ADMIN_SCOPE,
          key,
          requestHash,
          CLAIM_STATUS,
          handle.serialized,
        ).run();
        if (Number(renewed.meta.changes ?? 0) !== 1) {
          handle.lost = true;
          break;
        }
        handle.serialized = nextClaim;
      } catch (error) {
        // A transient D1 error is retried on the next heartbeat. The lease is
        // deliberately three intervals long, so one failed renewal cannot let
        // a second request execute concurrently.
        console.error(JSON.stringify({
          event: "flow_idempotency_lease_renewal_failed",
          project_id: projectId,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  })();

  return {
    stop: async () => {
      stopRequested = true;
      wakeStop?.();
      await operation;
      return !handle.lost;
    },
  };
}

async function releaseClaim(
  db: D1Database,
  projectId: number,
  key: string,
  requestHash: string,
  serializedClaim: string,
): Promise<void> {
  await db.prepare(
    `DELETE FROM flow_idempotency_keys
     WHERE project_id = ? AND scope = ? AND idempotency_key = ?
       AND request_hash = ? AND response_status = ? AND response_json = ?`,
  ).bind(
    projectId,
    ADMIN_SCOPE,
    key,
    requestHash,
    CLAIM_STATUS,
    serializedClaim,
  ).run();
}

async function hashRequest(request: Request): Promise<string> {
  let body: Uint8Array;
  try {
    body = await readBytesLimited(
      request.clone(),
      MAX_IDEMPOTENCY_BODY_BYTES,
    );
  } catch (error) {
    if (error instanceof RequestBodyError && error.code === "body_too_large") {
      throw failure(
        "request_too_large",
        "Request body is too large",
        413,
        { maximum_bytes: MAX_IDEMPOTENCY_BODY_BYTES },
      );
    }
    if (error instanceof RequestBodyError) {
      throw failure("request_invalid", error.message, error.status);
    }
    throw error;
  }
  const url = new URL(request.url);
  const prefix = new TextEncoder().encode(
    `${request.method.toUpperCase()}\n${url.pathname}${url.search}\n`,
  );
  const bytes = new Uint8Array(prefix.byteLength + body.byteLength);
  bytes.set(prefix);
  bytes.set(body, prefix.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function readReplay(
  db: D1Database,
  projectId: number,
  key: string,
): Promise<IdempotencyRow | null> {
  return db.prepare(
    `SELECT request_hash, response_status, response_json, created_at
     FROM flow_idempotency_keys
     WHERE project_id = ? AND scope = ? AND idempotency_key = ?`,
  ).bind(projectId, ADMIN_SCOPE, key).first<IdempotencyRow>();
}

function assertMatchingRequest(
  existing: Pick<IdempotencyRow, "request_hash">,
  requestHash: string,
): void {
  if (existing.request_hash !== requestHash) {
    throw failure(
      "idempotency_key_conflict",
      "Idempotency-Key was already used for a different request",
      409,
    );
  }
}

function serializeClaim(owner: string): string {
  return JSON.stringify({
    kind: "claim",
    version: 1,
    owner,
    lease_expires_at: new Date(Date.now() + CLAIM_LEASE_MS).toISOString(),
  } satisfies PendingClaim);
}

function claimExpired(row: IdempotencyRow): boolean {
  const parsed = parseJson(row.response_json);
  if (isPendingClaim(parsed)) {
    const lease = Date.parse(parsed.lease_expires_at);
    return !Number.isFinite(lease) || lease <= Date.now();
  }
  // Recover claims created by the previous implementation, which stored an
  // empty response body and otherwise remained blocked for the 30-day purge.
  const createdAt = Date.parse(row.created_at);
  return !Number.isFinite(createdAt) || createdAt + CLAIM_LEASE_MS <= Date.now();
}

async function serializeResponse(response: Response): Promise<string> {
  const bytes = await readBytesLimited(response, MAX_STORED_RESPONSE_BYTES);
  return JSON.stringify({
    kind: "response",
    version: 1,
    body_base64: bytesToBase64(bytes),
    headers: [...response.headers.entries()],
    status_text: response.statusText,
  } satisfies StoredResponse);
}

function replayResponse(status: number, stored: string): Response {
  const parsed = parseJson(stored);
  if (isStoredResponse(parsed)) {
    const headers = new Headers(parsed.headers);
    headers.set("idempotency-replayed", "true");
    const bytes = base64ToBytes(parsed.body_base64);
    return new Response(bytes.byteLength ? bytes : null, {
      status,
      statusText: parsed.status_text,
      headers,
    });
  }
  // Backward compatibility for completed records written before responses
  // were stored as byte-preserving envelopes.
  return new Response(stored || null, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=UTF-8",
      "idempotency-replayed": "true",
    },
  });
}

function isPendingClaim(value: unknown): value is PendingClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  return claim.kind === "claim" && claim.version === 1 &&
    typeof claim.owner === "string" &&
    typeof claim.lease_expires_at === "string";
}

function isStoredResponse(value: unknown): value is StoredResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return response.kind === "response" && response.version === 1 &&
    typeof response.body_base64 === "string" &&
    typeof response.status_text === "string" &&
    Array.isArray(response.headers) && response.headers.every(
      (entry) => Array.isArray(entry) && entry.length === 2 &&
        typeof entry[0] === "string" && typeof entry[1] === "string",
    );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
