import type {
  CustomWorkerJob,
  CustomWorkerJobPage,
  CustomWorkerJobReceipt,
  CustomWorkerJobStatus,
  CustomWorkerScope,
  CustomWorkerStats,
} from "@opengrow/contracts/custom-worker";
import { readJsonObjectLimited } from "@opengrow/contracts/request-body";
import { vocalSamples } from "./locales";
import {
  VocoStarJobError,
  parseJobIdentifier,
  parseMediaConvert,
  parseVoiceClone,
  requestHash,
} from "./validation";

type JobRow = {
  id: string;
  idempotency_key: string;
  request_hash: string;
  project_ref: string;
  capability: "vocostar.voice.clone" | "vocostar.media.convert";
  user_id: string;
  entity_id: string;
  status:
    | "queued"
    | "dispatched"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  credit_cost: number;
  attempts: number;
  last_error: string | null;
  requested_at: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  source_file_id: string | null;
};

type ObservedJob = {
  entity_job: number | null;
  progress: number | null;
  processed_at: string | null;
  entity_error: string | null;
  dispatch_status: string | null;
  dispatch_error: string | null;
};

export async function createJob(
  job: CustomWorkerJob,
  env: Env,
  scope?: CustomWorkerScope,
): Promise<CustomWorkerJobReceipt> {
  if (!scope) throw new VocoStarJobError("scope_required", 403);
  if (job.projectRef !== scope.projectRef) {
    throw new VocoStarJobError("project_mismatch", 403);
  }
  const hash = await requestHash(job);
  const existing = await byIdempotency(env.VOCOSTAR_DB, job.idempotencyKey);
  if (existing) return existingReceipt(existing, hash, env);
  if (job.capability === "vocostar.voice.clone")
    return createVoiceJob(job, scope.subject, hash, env);
  if (job.capability === "vocostar.media.convert")
    return createMediaJob(job, scope.subject, hash, env);
  throw new VocoStarJobError("capability_not_supported");
}

async function createVoiceJob(
  job: CustomWorkerJob,
  owner: string,
  hash: string,
  env: Env,
) {
  const input = parseVoiceClone(job);
  const user = await env.VOCOSTAR_DB.prepare(
    "SELECT id, premium FROM users WHERE id = ?",
  )
    .bind(owner)
    .first<{ id: string; premium: number }>();
  if (!user) throw new VocoStarJobError("user_not_found", 404);
  const id = crypto.randomUUID();
  const entityId = crypto.randomUUID();
  const now = new Date().toISOString();
  const samples = vocalSamples(input.language);
  const payload = {
    user_id: owner,
    user_vocal_id: entityId,
    send_id: id,
    audio_file_id: input.fileId,
    language: input.language,
    text_audio: samples.audio,
    text_unlock: samples.unlock,
    premium: Boolean(user.premium),
  };
  await env.VOCOSTAR_DB.batch([
    env.VOCOSTAR_DB.prepare(
      `
      INSERT OR IGNORE INTO opengrow_custom_jobs
        (id, idempotency_key, request_hash, project_ref, capability, user_id, entity_id, source_file_id,
         status, credit_cost, requested_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
    `,
    ).bind(
      id,
      job.idempotencyKey,
      hash,
      job.projectRef,
      job.capability,
      owner,
      entityId,
      input.fileId,
      job.requestedAt,
      now,
      now,
      owner,
    ),
    env.VOCOSTAR_DB.prepare(
      `
      INSERT INTO users_vocals (id, user_id, refs, language, progress, job, created_at)
      SELECT ?, ?, ?, ?, 0.2, 0, ?
      WHERE EXISTS (SELECT 1 FROM opengrow_custom_jobs WHERE id = ?)
    `,
    ).bind(
      entityId,
      owner,
      `opengrow-file:${input.fileId}`,
      input.language,
      now,
      id,
    ),
    env.VOCOSTAR_DB.prepare(
      `
      INSERT INTO send_users_vocals (id, user_vocal_id, payload, status, attempts, created_at)
      SELECT ?, ?, ?, 'pending', 0, ?
      WHERE EXISTS (SELECT 1 FROM opengrow_custom_jobs WHERE id = ?)
    `,
    ).bind(id, entityId, JSON.stringify(payload), now, id),
  ]);
  return dispatchNewOrExisting(job.idempotencyKey, id, hash, env);
}

async function createMediaJob(
  job: CustomWorkerJob,
  owner: string,
  hash: string,
  env: Env,
) {
  const input = parseMediaConvert(job);
  const user = await env.VOCOSTAR_DB.prepare(
    "SELECT id, premium, credits FROM users WHERE id = ?",
  )
    .bind(owner)
    .first<{ id: string; premium: number; credits: number }>();
  if (!user) throw new VocoStarJobError("user_not_found", 404);
  if (Number(user.credits || 0) < input.creditCost)
    throw new VocoStarJobError("insufficient_credits", 402);
  const vocalRef =
    input.vocalType === "user"
      ? await env.VOCOSTAR_DB.prepare(
          "SELECT refs FROM users_vocals WHERE id = ? AND user_id = ?",
        )
          .bind(input.vocalId, owner)
          .first<{ refs: string }>()
      : await env.VOCOSTAR_DB.prepare(
          "SELECT refs FROM app_vocals WHERE id = ?",
        )
          .bind(input.vocalId)
          .first<{ refs: string }>();
  if (!vocalRef?.refs) throw new VocoStarJobError("vocal_not_found", 404);

  const id = crypto.randomUUID();
  const entityId = crypto.randomUUID();
  const now = new Date().toISOString();
  const payload = {
    media_type: input.mediaType,
    media_id: entityId,
    send_id: id,
    user_id: owner,
    vocal_ref: vocalRef.refs,
    premium: Boolean(user.premium),
    ...input.input,
  };
  await env.VOCOSTAR_DB.batch([
    env.VOCOSTAR_DB.prepare(
      `
      INSERT OR IGNORE INTO opengrow_custom_jobs
        (id, idempotency_key, request_hash, project_ref, capability, user_id, entity_id, source_file_id,
         status, credit_cost, requested_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?
      FROM users WHERE id = ? AND credits >= ?
    `,
    ).bind(
      id,
      job.idempotencyKey,
      hash,
      job.projectRef,
      job.capability,
      owner,
      entityId,
      input.sourceFileId,
      input.creditCost,
      job.requestedAt,
      now,
      now,
      owner,
      input.creditCost,
    ),
    env.VOCOSTAR_DB.prepare(
      `
      INSERT INTO users_medias
        (id, user_id, vocal_id, vocal_type, media_type, job, progress, input, created_at)
      SELECT ?, ?, ?, ?, ?, 0, 0.2, ?, ?
      WHERE EXISTS (SELECT 1 FROM opengrow_custom_jobs WHERE id = ?)
    `,
    ).bind(
      entityId,
      owner,
      input.vocalId,
      input.vocalType,
      input.mediaType,
      JSON.stringify(input.input),
      now,
      id,
    ),
    env.VOCOSTAR_DB.prepare(
      `
      INSERT INTO send_users_medias
        (id, user_media_id, event_type, payload, status, attempts, created_at)
      SELECT ?, ?, ?, ?, 'pending', 0, ?
      WHERE EXISTS (SELECT 1 FROM opengrow_custom_jobs WHERE id = ?)
    `,
    ).bind(id, entityId, input.mediaType, JSON.stringify(payload), now, id),
    env.VOCOSTAR_DB.prepare(
      `
      UPDATE users SET credits = credits - ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM opengrow_custom_jobs WHERE id = ?)
    `,
    ).bind(input.creditCost, owner, id),
  ]);
  const stored = await byIdempotency(env.VOCOSTAR_DB, job.idempotencyKey);
  if (!stored) throw new VocoStarJobError("insufficient_credits", 402);
  if (stored.id !== id) return existingReceipt(stored, hash, env);
  return dispatchAndRefresh(stored, env);
}

async function dispatchNewOrExisting(
  idempotencyKey: string,
  createdId: string,
  hash: string,
  env: Env,
) {
  const stored = await byIdempotency(env.VOCOSTAR_DB, idempotencyKey);
  if (!stored) throw new VocoStarJobError("user_not_found", 404);
  if (stored.id !== createdId) return existingReceipt(stored, hash, env);
  return dispatchAndRefresh(stored, env);
}

async function existingReceipt(existing: JobRow, hash: string, env: Env) {
  if (existing.request_hash !== hash)
    throw new VocoStarJobError("idempotency_conflict", 409);
  return refreshJob(existing, env);
}

export async function dispatchAndRefresh(
  job: JobRow,
  env: Env,
): Promise<CustomWorkerJobReceipt> {
  await dispatch(job, env);
  return refreshJob((await getJobRow(env.VOCOSTAR_DB, job.id)) ?? job, env);
}

async function dispatch(job: JobRow, env: Env): Promise<void> {
  if (job.status === "completed" || job.status === "cancelled") return;
  const voice = job.capability === "vocostar.voice.clone";
  const table = voice ? "send_users_vocals" : "send_users_medias";
  const idColumn = voice ? "user_vocal_id" : "user_media_id";
  const record = await env.VOCOSTAR_DB.prepare(
    `SELECT id, ${idColumn} entity_id, payload${voice ? "" : ", event_type"} FROM ${table} WHERE id = ?`,
  )
    .bind(job.id)
    .first<Record<string, unknown>>();
  if (!record) {
    await markJob(env.VOCOSTAR_DB, job.id, "failed", "dispatch_record_missing");
    return;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(String(record.payload));
  } catch {
    await markJob(
      env.VOCOSTAR_DB,
      job.id,
      "failed",
      "dispatch_payload_invalid",
    );
    return;
  }
  const now = new Date().toISOString();
  await env.VOCOSTAR_DB.batch([
    env.VOCOSTAR_DB.prepare(
      `UPDATE ${table} SET status = 'processing', attempts = attempts + 1, last_error = NULL WHERE id = ?`,
    ).bind(job.id),
    env.VOCOSTAR_DB.prepare(
      "UPDATE opengrow_custom_jobs SET attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE id = ?",
    ).bind(now, job.id),
  ]);
  try {
    payload = await resolveDispatchPayload(job, payload, env);
    const response = await (
      voice ? env.VOCALS_ORCHESTRATOR : env.MEDIAS_ORCHESTRATOR
    ).fetch(
      new Request("https://orchestrator.internal/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": job.id,
        },
        body: JSON.stringify({
          id: job.id,
          ...(voice
            ? { user_vocal_id: job.entity_id }
            : {
                user_media_id: job.entity_id,
                event_type: record.event_type,
              }),
          payload,
        }),
        signal: AbortSignal.timeout(10_000),
      }),
    );
    if (!response.ok) throw new Error(`orchestrator_http_${response.status}`);
    await env.VOCOSTAR_DB.prepare(
      "UPDATE opengrow_custom_jobs SET status = 'dispatched', last_error = NULL, updated_at = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), job.id)
      .run();
  } catch (error) {
    const message = sanitizeError(error);
    await env.VOCOSTAR_DB.batch([
      env.VOCOSTAR_DB.prepare(
        `UPDATE ${table} SET status = 'pending', last_error = ? WHERE id = ?`,
      ).bind(message, job.id),
      env.VOCOSTAR_DB.prepare(
        "UPDATE opengrow_custom_jobs SET status = 'queued', last_error = ?, updated_at = ? WHERE id = ?",
      ).bind(message, new Date().toISOString(), job.id),
    ]);
  }
}

export async function resolveDispatchPayload(
  job: Pick<JobRow, "source_file_id" | "user_id">,
  payload: Record<string, unknown>,
  env: Pick<
    Env,
    "FILES_SERVICE" | "FILES_INTERNAL_TOKEN" | "FILES_INPUT_ORIGIN"
  >,
): Promise<Record<string, unknown>> {
  const audioFileId = payload.audio_file_id;
  const videoFileId = payload.video_file_id;
  if (audioFileId === undefined && videoFileId === undefined) {
    if (job.source_file_id) throw new Error("dispatch_source_file_missing");
    return payload;
  }
  if (audioFileId !== undefined && videoFileId !== undefined) {
    throw new Error("dispatch_source_file_ambiguous");
  }
  const fileId = String(audioFileId ?? videoFileId ?? "");
  if (!job.source_file_id || fileId !== job.source_file_id) {
    throw new Error("dispatch_source_file_mismatch");
  }
  const response = await env.FILES_SERVICE.fetch(
    new Request(
      `https://files.internal/internal/v1/files/${encodeURIComponent(fileId)}/download-ticket`,
      {
        method: "POST",
        headers: {
          "x-internal-token": env.FILES_INTERNAL_TOKEN,
          "x-file-owner": job.user_id,
        },
        signal: AbortSignal.timeout(5_000),
      },
    ),
  );
  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectLimited(response, 16_384);
  } catch {
    throw new Error("files_ticket_response_invalid");
  }
  if (!response.ok) {
    const error = body.error;
    const code =
      error && typeof error === "object" && !Array.isArray(error)
        ? String((error as Record<string, unknown>).code || "")
        : "";
    throw new Error(
      code === "file_not_found"
        ? "source_file_not_found"
        : `files_ticket_http_${response.status}`,
    );
  }
  const download = body.download;
  const urlValue =
    download && typeof download === "object" && !Array.isArray(download)
      ? (download as Record<string, unknown>).url
      : null;
  if (typeof urlValue !== "string" || urlValue.length > 4_096) {
    throw new Error("files_ticket_response_invalid");
  }
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("files_ticket_response_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("files_ticket_response_invalid");
  }
  if (
    url.origin !== env.FILES_INPUT_ORIGIN ||
    !url.pathname.startsWith("/v1/downloads/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("files_ticket_origin_invalid");
  }
  const resolved = { ...payload };
  delete resolved.audio_file_id;
  delete resolved.video_file_id;
  resolved[audioFileId === undefined ? "video_src" : "audio_src"] =
    url.toString();
  return resolved;
}

export async function getJob(
  idValue: unknown,
  env: Env,
  scope?: CustomWorkerScope,
): Promise<CustomWorkerJobReceipt> {
  const id = parseJobIdentifier(idValue);
  const row = await getJobRow(env.VOCOSTAR_DB, id, scope);
  if (!row) throw new VocoStarJobError("job_not_found", 404);
  return refreshJob(row, env);
}

export async function cancelJob(
  idValue: unknown,
  env: Env,
  scope?: CustomWorkerScope,
): Promise<CustomWorkerJobReceipt> {
  const id = parseJobIdentifier(idValue);
  const row = await getJobRow(env.VOCOSTAR_DB, id, scope);
  if (!row) throw new VocoStarJobError("job_not_found", 404);
  const current = await refreshJob(row, env);
  if (current.status === "cancelled") return current;
  if (current.status !== "queued" && current.status !== "failed") {
    throw new VocoStarJobError("job_not_cancellable", 409);
  }

  const table =
    row.capability === "vocostar.voice.clone"
      ? "send_users_vocals"
      : "send_users_medias";
  const now = new Date().toISOString();
  const results = await env.VOCOSTAR_DB.batch([
    env.VOCOSTAR_DB.prepare(
      `UPDATE opengrow_custom_jobs
       SET status = 'cancelled', last_error = NULL, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'failed')`,
    ).bind(now, id),
    env.VOCOSTAR_DB.prepare(
      `INSERT OR IGNORE INTO opengrow_custom_job_credit_refunds
         (job_id, user_id, amount, created_at)
       SELECT id, user_id, credit_cost, ?
       FROM opengrow_custom_jobs
       WHERE id = ? AND status = 'cancelled' AND credit_cost > 0`,
    ).bind(now, id),
    env.VOCOSTAR_DB.prepare(
      `UPDATE users
       SET credits = credits + COALESCE((
         SELECT amount FROM opengrow_custom_job_credit_refunds
         WHERE job_id = ? AND applied_at IS NULL
       ), 0)
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM opengrow_custom_job_credit_refunds
         WHERE job_id = ? AND applied_at IS NULL
       )`,
    ).bind(id, row.user_id, id),
    env.VOCOSTAR_DB.prepare(
      `UPDATE opengrow_custom_job_credit_refunds
       SET applied_at = ?
       WHERE job_id = ? AND applied_at IS NULL`,
    ).bind(now, id),
    env.VOCOSTAR_DB.prepare(
      `UPDATE ${table}
       SET status = 'cancelled', last_error = NULL
       WHERE id = ? AND status IN ('pending', 'failed')`,
    ).bind(id),
  ]);
  if (Number(results[0].meta.changes || 0) !== 1) {
    const latest = await getJobRow(env.VOCOSTAR_DB, id, scope);
    if (!latest) throw new VocoStarJobError("job_not_found", 404);
    const receipt = await refreshJob(latest, env);
    if (receipt.status === "cancelled") return receipt;
    throw new VocoStarJobError("job_not_cancellable", 409);
  }
  const cancelled = await getJobRow(env.VOCOSTAR_DB, id, scope);
  if (!cancelled) throw new VocoStarJobError("job_not_found", 404);
  return refreshJob(cancelled, env);
}

export async function eraseApplicationUser(
  env: Env,
  scope: CustomWorkerScope,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const erasedUserId = `erased:${(await sha256(`${scope.projectRef}:${scope.subject}`)).slice(0, 32)}`;
  const results = await env.VOCOSTAR_DB.batch([
    env.VOCOSTAR_DB.prepare(
      `DELETE FROM send_users_vocals
       WHERE user_vocal_id IN (
         SELECT id FROM users_vocals WHERE user_id = ?
       )`,
    ).bind(scope.subject),
    env.VOCOSTAR_DB.prepare(
      `DELETE FROM send_users_medias
       WHERE user_media_id IN (
         SELECT id FROM users_medias WHERE user_id = ?
       )`,
    ).bind(scope.subject),
    env.VOCOSTAR_DB.prepare("DELETE FROM users_vocals WHERE user_id = ?").bind(
      scope.subject,
    ),
    env.VOCOSTAR_DB.prepare("DELETE FROM users_medias WHERE user_id = ?").bind(
      scope.subject,
    ),
    env.VOCOSTAR_DB.prepare(
      `UPDATE opengrow_custom_job_credit_refunds
       SET user_id = ?
       WHERE job_id IN (
         SELECT id FROM opengrow_custom_jobs
         WHERE project_ref = ? AND user_id = ?
       )`,
    ).bind(erasedUserId, scope.projectRef, scope.subject),
    env.VOCOSTAR_DB.prepare(
      `UPDATE opengrow_custom_jobs
       SET user_id = ?, source_file_id = NULL, status = 'cancelled',
           last_error = 'account_erased', completed_at = COALESCE(completed_at, ?),
           updated_at = ?
       WHERE project_ref = ? AND user_id = ?`,
    ).bind(erasedUserId, now, now, scope.projectRef, scope.subject),
    env.VOCOSTAR_DB.prepare("DELETE FROM users WHERE id = ?").bind(
      scope.subject,
    ),
  ]);
  return {
    erased: true,
    jobs_redacted: Number(results[5].meta.changes || 0),
    vocals_deleted: Number(results[2].meta.changes || 0),
    medias_deleted: Number(results[3].meta.changes || 0),
    dispatches_deleted:
      Number(results[0].meta.changes || 0) +
      Number(results[1].meta.changes || 0),
    users_deleted: Number(results[6].meta.changes || 0),
  };
}

export async function retryJob(
  idValue: unknown,
  env: Env,
): Promise<CustomWorkerJobReceipt> {
  const id = parseJobIdentifier(idValue);
  const row = await getJobRow(env.VOCOSTAR_DB, id);
  if (!row) throw new VocoStarJobError("job_not_found", 404);
  const current = await refreshJob(row, env);
  if (current.status !== "queued" && current.status !== "failed") {
    throw new VocoStarJobError("job_not_retryable", 409);
  }
  const table =
    row.capability === "vocostar.voice.clone"
      ? "send_users_vocals"
      : "send_users_medias";
  const now = new Date().toISOString();
  await env.VOCOSTAR_DB.batch([
    env.VOCOSTAR_DB.prepare(
      `UPDATE ${table} SET status = 'pending', last_error = NULL WHERE id = ?`,
    ).bind(id),
    env.VOCOSTAR_DB.prepare(
      "UPDATE opengrow_custom_jobs SET status = 'queued', last_error = NULL, updated_at = ? WHERE id = ?",
    ).bind(now, id),
  ]);
  return dispatchAndRefresh(
    { ...row, status: "queued", last_error: null, updated_at: now },
    env,
  );
}

export async function listJobs(
  url: URL,
  env: Env,
  scope?: CustomWorkerScope,
): Promise<CustomWorkerJobPage> {
  const limit = Math.min(
    Math.max(
      Number.parseInt(url.searchParams.get("limit") || "25", 10) || 25,
      1,
    ),
    100,
  );
  const status = url.searchParams.get("status");
  const capability = url.searchParams.get("capability");
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const where: string[] = [];
  const bindings: unknown[] = [];
  if (scope) {
    where.push("project_ref = ?");
    bindings.push(scope.projectRef);
    where.push("user_id = ?");
    bindings.push(scope.subject);
  }
  if (status) {
    if (
      !new Set([
        "queued",
        "dispatched",
        "running",
        "completed",
        "failed",
        "cancelled",
      ]).has(status)
    ) {
      throw new VocoStarJobError("status_invalid");
    }
    where.push("status = ?");
    bindings.push(status);
  }
  if (capability) {
    if (
      !new Set(["vocostar.voice.clone", "vocostar.media.convert"]).has(
        capability,
      )
    ) {
      throw new VocoStarJobError("capability_invalid");
    }
    where.push("capability = ?");
    bindings.push(capability);
  }
  if (cursor) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const result = await env.VOCOSTAR_DB.prepare(
    `SELECT * FROM opengrow_custom_jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(...bindings, limit + 1)
    .all<JobRow>();
  const rows = result.results.slice(0, limit);
  const jobs = await Promise.all(rows.map((row) => refreshJob(row, env)));
  const last = rows.at(-1);
  return {
    jobs,
    nextCursor:
      result.results.length > limit && last
        ? encodeCursor(last.created_at, last.id)
        : null,
  };
}

export async function stats(env: Env): Promise<CustomWorkerStats> {
  const [user, statusRows, capabilityRows, cancellationRow] = await Promise.all(
    [
      env.VOCOSTAR_DB.prepare(
        `
      SELECT COUNT(*) total,
        SUM(CASE WHEN premium = 1 THEN 1 ELSE 0 END) premium,
        SUM(CASE WHEN is_anonymous = 1 THEN 1 ELSE 0 END) anonymous
      FROM users
    `,
      ).first<{ total: number; premium: number; anonymous: number }>(),
      env.VOCOSTAR_DB.prepare(
        "SELECT status, COUNT(*) total FROM opengrow_custom_jobs GROUP BY status",
      ).all<{ status: string; total: number }>(),
      env.VOCOSTAR_DB.prepare(
        "SELECT capability, status, COUNT(*) total FROM opengrow_custom_jobs GROUP BY capability, status",
      ).all<{ capability: string; status: string; total: number }>(),
      env.VOCOSTAR_DB.prepare(
        `SELECT
         COALESCE(SUM(CASE WHEN applied_at IS NULL THEN 1 ELSE 0 END), 0) refunds_pending,
         COALESCE(SUM(CASE WHEN applied_at IS NOT NULL THEN 1 ELSE 0 END), 0) refunds_applied,
         COALESCE(SUM(CASE WHEN applied_at IS NOT NULL THEN amount ELSE 0 END), 0) credits_refunded
       FROM opengrow_custom_job_credit_refunds`,
      ).first<{
        refunds_pending: number;
        refunds_applied: number;
        credits_refunded: number;
      }>(),
    ],
  );
  const jobs = Object.fromEntries(
    statusRows.results.map((row) => [row.status, Number(row.total || 0)]),
  );
  const capabilities: Record<string, Record<string, number>> = {};
  for (const row of capabilityRows.results) {
    (capabilities[row.capability] ??= {})[row.status] = Number(row.total || 0);
  }
  return {
    status: "ok",
    generatedAt: new Date().toISOString(),
    users: {
      total: Number(user?.total || 0),
      premium: Number(user?.premium || 0),
      anonymous: Number(user?.anonymous || 0),
    },
    jobs,
    capabilities,
    cancellations: {
      jobs: Number(jobs.cancelled || 0),
      refundsPending: Number(cancellationRow?.refunds_pending || 0),
      refundsApplied: Number(cancellationRow?.refunds_applied || 0),
      creditsRefunded: Number(cancellationRow?.credits_refunded || 0),
    },
  };
}

export async function reconcile(env: Env): Promise<void> {
  const active = await env.VOCOSTAR_DB.prepare(
    `
    SELECT * FROM opengrow_custom_jobs
    WHERE status IN ('queued', 'dispatched', 'running')
    ORDER BY updated_at ASC LIMIT 50
  `,
  ).all<JobRow>();
  for (const row of active.results) {
    const receipt = await refreshJob(row, env);
    const maximum = Math.min(
      Math.max(
        Number.parseInt(env.MAX_AUTOMATIC_DISPATCH_ATTEMPTS || "5", 10) || 5,
        1,
      ),
      20,
    );
    if (
      receipt.status === "queued" &&
      Number(receipt.attempts || 0) < maximum
    ) {
      await dispatch(row, env);
    }
  }
}

async function refreshJob(
  row: JobRow,
  env: Env,
): Promise<CustomWorkerJobReceipt> {
  const voice = row.capability === "vocostar.voice.clone";
  const observed = await env.VOCOSTAR_DB.prepare(
    voice
      ? `
    SELECT v.job entity_job, v.progress, v.processed_at, v.error entity_error,
      s.status dispatch_status, s.last_error dispatch_error
    FROM users_vocals v LEFT JOIN send_users_vocals s ON s.id = ?
    WHERE v.id = ?
  `
      : `
    SELECT m.job entity_job, m.progress, m.processed_at, NULL entity_error,
      s.status dispatch_status, s.last_error dispatch_error
    FROM users_medias m LEFT JOIN send_users_medias s ON s.id = ?
    WHERE m.id = ?
  `,
  )
    .bind(row.id, row.entity_id)
    .first<ObservedJob>();
  const next = observedStatus(row.status, observed);
  const error = sanitizeNullable(
    observed?.dispatch_error || observed?.entity_error || row.last_error,
  );
  const completedAt =
    next === "completed"
      ? observed?.processed_at || row.completed_at || new Date().toISOString()
      : row.completed_at;
  if (
    next !== row.status ||
    error !== row.last_error ||
    completedAt !== row.completed_at
  ) {
    await env.VOCOSTAR_DB.prepare(
      `
      UPDATE opengrow_custom_jobs
      SET status = ?, last_error = ?, completed_at = ?, updated_at = ? WHERE id = ?
    `,
    )
      .bind(next, error, completedAt, new Date().toISOString(), row.id)
      .run();
  }
  return receipt(
    {
      ...row,
      status: next as JobRow["status"],
      last_error: error,
      completed_at: completedAt,
    },
    observed?.progress,
  );
}

export function observedStatus(
  current: JobRow["status"],
  observed: ObservedJob | null,
): CustomWorkerJobStatus {
  if (current === "cancelled") return current;
  if (!observed) return "failed";
  if (Number(observed.entity_job || 0) === 1) return "completed";
  if (observed.dispatch_status === "failed" || observed.entity_error)
    return "failed";
  if (
    observed.dispatch_status === "processing" ||
    Number(observed.progress || 0) > 0.2
  )
    return "running";
  if (current === "dispatched") return "dispatched";
  return "queued";
}

function receipt(
  row: JobRow,
  progress?: number | null,
): CustomWorkerJobReceipt {
  return {
    id: row.id,
    capability: row.capability,
    status: row.status,
    entityId: row.entity_id,
    progress: progress == null ? undefined : Number(progress),
    attempts: Number(row.attempts || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    error: row.last_error,
  };
}

async function byIdempotency(db: D1Database, key: string) {
  return db
    .prepare("SELECT * FROM opengrow_custom_jobs WHERE idempotency_key = ?")
    .bind(key)
    .first<JobRow>();
}

async function getJobRow(
  db: D1Database,
  id: string,
  scope?: CustomWorkerScope,
) {
  return scope
    ? db
        .prepare(
          "SELECT * FROM opengrow_custom_jobs WHERE id = ? AND project_ref = ? AND user_id = ?",
        )
        .bind(id, scope.projectRef, scope.subject)
        .first<JobRow>()
    : db
        .prepare("SELECT * FROM opengrow_custom_jobs WHERE id = ?")
        .bind(id)
        .first<JobRow>();
}

async function markJob(
  db: D1Database,
  id: string,
  status: JobRow["status"],
  error: string | null,
) {
  await db
    .prepare(
      "UPDATE opengrow_custom_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?",
    )
    .bind(status, error, new Date().toISOString(), id)
    .run();
}

function sanitizeError(error: unknown): string {
  return (
    sanitizeNullable(error instanceof Error ? error.message : String(error)) ||
    "dispatch_failed"
  );
}

function sanitizeNullable(value: unknown): string | null {
  if (!value) return null;
  const text = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
  return text || null;
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify({ createdAt, id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeCursor(
  value: string | null,
): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    );
    const createdAt = String(parsed.createdAt || "");
    const id = parseJobIdentifier(parsed.id);
    if (Number.isNaN(new Date(createdAt).valueOf())) throw new Error("invalid");
    return { createdAt, id };
  } catch {
    throw new VocoStarJobError("cursor_invalid");
  }
}
