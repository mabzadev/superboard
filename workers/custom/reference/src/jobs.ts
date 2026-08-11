import type {
  CustomWorkerJob,
  CustomWorkerJobPage,
  CustomWorkerJobReceipt,
  CustomWorkerScope,
  CustomWorkerStats,
} from "@superboard/contracts/custom-worker";

type ReferenceJobRow = {
  id: string;
  idempotency_key: string;
  request_hash: string;
  project_ref: string;
  capability: "reference.echo" | "reference.acceptance";
  user_id: string;
  payload_json: string;
  status: "completed";
  requested_at: string;
  created_at: string;
  updated_at: string;
  completed_at: string;
};

const REFERENCE_CAPABILITIES = new Set([
  "reference.echo",
  "reference.acceptance",
]);

const ACCEPTANCE_JOURNEYS = [
  "bootstrap",
  "sign-in",
  "create-account",
  "password-recovery",
  "home",
  "profile",
  "notifications",
  "files",
  "products",
  "paywall",
  "dynamic-links",
  "support",
  "marketing-consent",
  "onboarding",
  "custom-extension",
  "diagnostics",
] as const;

const NOT_APPLICABLE_JOURNEYS = new Set([
  "notifications",
  "products",
  "paywall",
]);

const SECRET_EVIDENCE_PATTERN =
  /(?:\bbearer\s+|\bghp_|\bgithub_pat_|\bsk-[a-z0-9]|\b(?:token|secret|password|api[_-]?key)\s*[:=])/i;

const JOB_STATUSES = new Set([
  "accepted",
  "queued",
  "dispatched",
  "running",
  "completed",
  "failed",
  "cancelled",
  "rejected",
]);

export class ReferenceJobError extends Error {
  constructor(
    readonly code: string,
    readonly status = 422,
  ) {
    super(code);
  }
}

export async function createReferenceJob(
  job: CustomWorkerJob,
  db: D1Database,
  retentionDays: number,
  scope?: CustomWorkerScope,
  expectedTarget = "",
): Promise<CustomWorkerJobReceipt> {
  if (!REFERENCE_CAPABILITIES.has(job.capability)) {
    throw new ReferenceJobError("capability_not_supported");
  }
  if (!scope) throw new ReferenceJobError("scope_required", 403);
  if (job.projectRef !== scope.projectRef) {
    throw new ReferenceJobError("project_mismatch", 403);
  }
  const userId = scope.subject;
  if (job.capability === "reference.acceptance") {
    validateAcceptancePayload(job.payload, expectedTarget, job.requestedAt);
  }
  const hash = await requestHash(job);
  await pruneExpiredReferenceJobs(db, retentionDays);
  const existing = await byIdempotency(db, job.idempotencyKey);
  if (existing) return idempotentReceipt(existing, hash);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `
    INSERT OR IGNORE INTO reference_custom_jobs
      (id, idempotency_key, request_hash, project_ref, capability, user_id,
       payload_json, status, requested_at, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)
  `,
    )
    .bind(
      id,
      job.idempotencyKey,
      hash,
      job.projectRef,
      job.capability,
      userId,
      JSON.stringify(job.payload),
      job.requestedAt,
      now,
      now,
      now,
    )
    .run();

  const stored = await byIdempotency(db, job.idempotencyKey);
  if (!stored) throw new ReferenceJobError("job_store_failed", 503);
  return idempotentReceipt(stored, hash);
}

export async function pruneExpiredReferenceJobs(
  db: D1Database,
  retentionDays: number,
): Promise<number> {
  if (
    !Number.isSafeInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 3_650
  ) {
    throw new ReferenceJobError("reference_retention_invalid", 503);
  }
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const result = await db
    .prepare("DELETE FROM reference_custom_jobs WHERE created_at < ?")
    .bind(cutoff)
    .run();
  return Number(result.meta.changes || 0);
}

export async function eraseReferenceUser(
  db: D1Database,
  scope: CustomWorkerScope,
): Promise<number> {
  const result = await db
    .prepare(
      "DELETE FROM reference_custom_jobs WHERE project_ref = ? AND user_id = ?",
    )
    .bind(scope.projectRef, scope.subject)
    .run();
  return Number(result.meta.changes || 0);
}

export async function getReferenceJob(
  idValue: unknown,
  db: D1Database,
  scope?: CustomWorkerScope,
): Promise<CustomWorkerJobReceipt> {
  const id = identifier(idValue, "job_id");
  const row = scope
    ? await db
        .prepare(
          "SELECT * FROM reference_custom_jobs WHERE id = ? AND project_ref = ? AND user_id = ?",
        )
        .bind(id, scope.projectRef, scope.subject)
        .first<ReferenceJobRow>()
    : await db
        .prepare("SELECT * FROM reference_custom_jobs WHERE id = ?")
        .bind(id)
        .first<ReferenceJobRow>();
  if (!row) throw new ReferenceJobError("job_not_found", 404);
  return receipt(row);
}

export async function cancelReferenceJob(
  idValue: unknown,
  db: D1Database,
  scope?: CustomWorkerScope,
): Promise<CustomWorkerJobReceipt> {
  const current = await getReferenceJob(idValue, db, scope);
  if (current.status === "cancelled") return current;
  throw new ReferenceJobError("job_not_cancellable", 409);
}

export async function listReferenceJobs(
  url: URL,
  db: D1Database,
  scope?: CustomWorkerScope,
): Promise<CustomWorkerJobPage> {
  const limit = parseLimit(url.searchParams.get("limit"));
  const status = url.searchParams.get("status")?.trim() || "";
  const capability = url.searchParams.get("capability")?.trim() || "";
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (status && !JOB_STATUSES.has(status)) {
    throw new ReferenceJobError("status_invalid");
  }
  if (capability && !REFERENCE_CAPABILITIES.has(capability)) {
    throw new ReferenceJobError("capability_invalid");
  }

  const where: string[] = [];
  const bindings: unknown[] = [];
  if (scope) {
    where.push("project_ref = ?");
    bindings.push(scope.projectRef);
    where.push("user_id = ?");
    bindings.push(scope.subject);
  }
  if (status) {
    where.push("status = ?");
    bindings.push(status);
  }
  if (capability) {
    where.push("capability = ?");
    bindings.push(capability);
  }
  if (cursor) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const result = await db
    .prepare(
      `
    SELECT * FROM reference_custom_jobs
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `,
    )
    .bind(...bindings, limit + 1)
    .all<ReferenceJobRow>();
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  return {
    jobs: rows.map(receipt),
    nextCursor:
      result.results.length > limit && last
        ? encodeCursor(last.created_at, last.id)
        : null,
  };
}

export async function referenceStats(
  db: D1Database,
): Promise<CustomWorkerStats> {
  const [statuses, capabilities] = await db.batch([
    db.prepare(
      "SELECT status, COUNT(*) total FROM reference_custom_jobs GROUP BY status",
    ),
    db.prepare(`
      SELECT capability, status, COUNT(*) total
      FROM reference_custom_jobs
      GROUP BY capability, status
    `),
  ]);
  const jobs = Object.fromEntries(
    (statuses.results as Array<{ status: string; total: number }>).map(
      (row) => [row.status, Number(row.total || 0)],
    ),
  );
  const capabilityStats: Record<string, Record<string, number>> = {};
  for (const row of capabilities.results as Array<{
    capability: string;
    status: string;
    total: number;
  }>) {
    (capabilityStats[row.capability] ??= {})[row.status] = Number(
      row.total || 0,
    );
  }
  return {
    status: "ok",
    generatedAt: new Date().toISOString(),
    jobs,
    capabilities: capabilityStats,
  };
}

async function idempotentReceipt(row: ReferenceJobRow, requestHash: string) {
  if (row.request_hash !== requestHash) {
    throw new ReferenceJobError("idempotency_conflict", 409);
  }
  return receipt(row);
}

function receipt(row: ReferenceJobRow): CustomWorkerJobReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload_json);
  } catch {
    throw new ReferenceJobError("job_payload_corrupt", 503);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ReferenceJobError("job_payload_corrupt", 503);
  }
  const payload = parsed as Record<string, unknown>;
  const result =
    row.capability === "reference.acceptance"
      ? acceptanceResult(payload, row.project_ref)
      : { echo: payload, projectRef: row.project_ref };
  return {
    id: row.id,
    capability: row.capability,
    status: row.status,
    progress: 1,
    attempts: 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    error: null,
    result,
  };
}

function validateAcceptancePayload(
  payload: Record<string, unknown>,
  expectedTarget: string,
  requestedAt: string,
): void {
  if (payload.schemaVersion !== 1) {
    throw new ReferenceJobError("acceptance_schema_invalid");
  }
  if (!expectedTarget || payload.target !== expectedTarget) {
    throw new ReferenceJobError("acceptance_target_invalid");
  }
  if (payload.projectEnvironment !== "test") {
    throw new ReferenceJobError("acceptance_environment_invalid");
  }
  for (const field of ["platformRevision", "referenceRevision"] as const) {
    if (
      typeof payload[field] !== "string" ||
      !/^[0-9a-f]{40}$/.test(payload[field])
    ) {
      throw new ReferenceJobError("acceptance_revision_invalid");
    }
  }
  if (
    typeof payload.completedAt !== "string" ||
    Number.isNaN(new Date(payload.completedAt).valueOf()) ||
    Math.abs(
      new Date(payload.completedAt).valueOf() - new Date(requestedAt).valueOf(),
    ) >
      24 * 60 * 60 * 1_000
  ) {
    throw new ReferenceJobError("acceptance_time_invalid");
  }
  if (!Array.isArray(payload.journeys)) {
    throw new ReferenceJobError("acceptance_journeys_invalid");
  }
  const expected = new Set<string>(ACCEPTANCE_JOURNEYS);
  const seen = new Set<string>();
  for (const value of payload.journeys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ReferenceJobError("acceptance_journeys_invalid");
    }
    const journey = value as Record<string, unknown>;
    const id = typeof journey.id === "string" ? journey.id : "";
    const status = typeof journey.status === "string" ? journey.status : "";
    const evidence =
      typeof journey.evidence === "string" ? journey.evidence.trim() : "";
    if (
      !expected.has(id) ||
      seen.has(id) ||
      !new Set(["passed", "failed", "not_applicable"]).has(status) ||
      (status === "not_applicable" && !NOT_APPLICABLE_JOURNEYS.has(id)) ||
      !evidence ||
      evidence.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(evidence) ||
      SECRET_EVIDENCE_PATTERN.test(evidence)
    ) {
      throw new ReferenceJobError("acceptance_journeys_invalid");
    }
    seen.add(id);
  }
  if (seen.size !== expected.size) {
    throw new ReferenceJobError("acceptance_journeys_invalid");
  }
}

function acceptanceResult(
  payload: Record<string, unknown>,
  projectRef: string,
): Record<string, unknown> {
  const journeys = payload.journeys as Array<Record<string, unknown>>;
  const failed = journeys.filter(
    (journey) => journey.status === "failed",
  ).length;
  return {
    acceptance: {
      schemaVersion: payload.schemaVersion,
      target: payload.target,
      projectEnvironment: payload.projectEnvironment,
      platformRevision: payload.platformRevision,
      referenceRevision: payload.referenceRevision,
      completedAt: payload.completedAt,
      decision: failed === 0 ? "accepted" : "rejected",
      failed,
      journeys,
    },
    projectRef,
  };
}

async function byIdempotency(db: D1Database, key: string) {
  return db
    .prepare("SELECT * FROM reference_custom_jobs WHERE idempotency_key = ?")
    .bind(key)
    .first<ReferenceJobRow>();
}

async function requestHash(job: CustomWorkerJob): Promise<string> {
  const canonical = JSON.stringify(
    sortValue({
      projectRef: job.projectRef,
      capability: job.capability,
      payload: job.payload,
    }),
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
  );
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}

function identifier(value: unknown, field: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (
    !result ||
    result.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)
  ) {
    throw new ReferenceJobError(`${field}_invalid`);
  }
  return result;
}

function parseLimit(value: string | null): number {
  if (!value) return 25;
  if (!/^\d{1,3}$/.test(value)) throw new ReferenceJobError("limit_invalid");
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ReferenceJobError("limit_invalid");
  }
  return limit;
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
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed: unknown = JSON.parse(atob(`${normalized}${padding}`));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    const record = parsed as Record<string, unknown>;
    const createdAt =
      typeof record.createdAt === "string" ? record.createdAt : "";
    const id = identifier(record.id, "job_id");
    if (!createdAt || Number.isNaN(new Date(createdAt).valueOf())) {
      throw new Error("invalid");
    }
    return { createdAt, id };
  } catch {
    throw new ReferenceJobError("cursor_invalid");
  }
}
