export const CUSTOM_WORKER_PROTOCOL_VERSION = 2;
export const CUSTOM_WORKER_MANIFEST_PATH = "/internal/v1/manifest";
export const CUSTOM_WORKER_JOB_PATH = "/internal/v1/jobs";
export const CUSTOM_WORKER_JOB_CANCEL_SUFFIX = "/cancel";
export const CUSTOM_WORKER_STATS_PATH = "/internal/v1/stats";
export const CUSTOM_WORKER_SUBJECT_HEADER = "x-custom-worker-subject";
export const CUSTOM_WORKER_PROJECT_HEADER = "x-custom-worker-project";

export interface CustomWorkerScope {
  projectRef: string;
  subject: string;
}

export interface CustomWorkerManifest {
  protocolVersion: typeof CUSTOM_WORKER_PROTOCOL_VERSION;
  appKey: string;
  service: string;
  version: string;
  description: string;
  capabilities: Array<{
    id: string;
    description: string;
    mode: "request" | "queue" | "scheduled";
  }>;
}

export interface CustomWorkerJob {
  idempotencyKey: string;
  projectRef: string;
  capability: string;
  payload: Record<string, unknown>;
  requestedAt: string;
}

export interface CustomWorkerJobReceipt {
  id: string;
  capability: string;
  status: CustomWorkerJobStatus;
  entityId?: string;
  progress?: number;
  attempts?: number;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  error?: string | null;
  result?: Record<string, unknown>;
}

export type CustomWorkerJobStatus =
  | "accepted"
  | "queued"
  | "dispatched"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected";

export interface CustomWorkerJobPage {
  jobs: CustomWorkerJobReceipt[];
  nextCursor: string | null;
}

export interface CustomWorkerStats {
  status: "ok" | "degraded";
  generatedAt: string;
  users?: { total: number; premium: number; anonymous: number };
  jobs: Record<string, number>;
  capabilities: Record<string, Record<string, number>>;
  cancellations?: {
    jobs: number;
    refundsPending: number;
    refundsApplied: number;
    creditsRefunded: number;
  };
}

export function parseCustomWorkerJob(
  value: unknown,
  now = Date.now(),
): CustomWorkerJob {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CustomWorkerProtocolError("job_invalid");
  const input = value as Record<string, unknown>;
  const idempotencyKey = bounded(
    input.idempotencyKey,
    "idempotency_key",
    128,
    /^[A-Za-z0-9._:-]+$/,
  );
  const projectRef = bounded(
    input.projectRef,
    "project_ref",
    64,
    /^\d+-(?:prod|test)$/,
  );
  const capability = bounded(
    input.capability,
    "capability",
    128,
    /^[a-z][a-z0-9.-]+$/,
  );
  if (
    !input.payload ||
    typeof input.payload !== "object" ||
    Array.isArray(input.payload)
  ) {
    throw new CustomWorkerProtocolError("payload_invalid");
  }
  const payload = input.payload as Record<string, unknown>;
  if (JSON.stringify(payload).length > 64_000)
    throw new CustomWorkerProtocolError("payload_invalid");
  const requestedAt = String(input.requestedAt || "");
  const date = new Date(requestedAt);
  if (
    !requestedAt ||
    Number.isNaN(date.valueOf()) ||
    Math.abs(now - date.valueOf()) > 5 * 60_000
  ) {
    throw new CustomWorkerProtocolError("requested_at_invalid");
  }
  return {
    idempotencyKey,
    projectRef,
    capability,
    payload,
    requestedAt: date.toISOString(),
  };
}

export async function customWorkerAuthorized(
  request: Request,
  expected: SecretCandidates,
): Promise<boolean> {
  const provided = request.headers.get("x-custom-worker-token") || "";
  return matchesAnySecret(provided, expected);
}

export function parseCustomWorkerScope(
  request: Request,
): CustomWorkerScope | null {
  const subjectValue = request.headers.get(CUSTOM_WORKER_SUBJECT_HEADER);
  const projectValue = request.headers.get(CUSTOM_WORKER_PROJECT_HEADER);
  if (!subjectValue && !projectValue) return null;
  if (!subjectValue || !projectValue) {
    throw new CustomWorkerProtocolError("scope_invalid");
  }
  return {
    projectRef: bounded(projectValue, "project_ref", 64, /^\d+-(?:prod|test)$/),
    subject: bounded(
      subjectValue,
      "subject",
      128,
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    ),
  };
}

export class CustomWorkerProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function bounded(
  value: unknown,
  field: string,
  maximum: number,
  pattern: RegExp,
): string {
  const result = String(value || "").trim();
  if (!result || result.length > maximum || !pattern.test(result)) {
    throw new CustomWorkerProtocolError(`${field}_invalid`);
  }
  return result;
}
import { matchesAnySecret, type SecretCandidates } from "./secret";
