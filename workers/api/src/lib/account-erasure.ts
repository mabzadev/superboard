import {
  PROJECT_CONTEXT_HEADERS,
  signProjectContext,
  type DomainModuleName,
  type InternalProjectContext,
  type ProjectEnvironment,
} from "@opengrow/contracts/project-context";
import type { Env } from "../types";

export type AccountErasureProject = {
  projectId: number;
  instanceId: number;
  projectRef: string;
  environment: ProjectEnvironment;
};

type ErasureRow = {
  id: string;
  project_id: number;
  instance_id: number;
  project_ref: string;
  application_user_id: string | null;
  application_user_hash: string;
  status: "processing" | "failed" | "completed";
  completed_steps_json: string;
};

type Step = {
  id: string;
  enabled: (env: Env) => boolean;
  run: (
    env: Env,
    operation: ErasureRow,
    project: AccountErasureProject,
    userId: string,
    requestId: string,
  ) => Promise<Response>;
};

export class AccountErasureError extends Error {
  constructor(
    readonly code: string,
    readonly service: string,
    readonly status = 503,
    readonly retryable = true,
  ) {
    super(code);
  }
}

export async function eraseApplicationAccount(
  env: Env,
  project: AccountErasureProject,
  userId: string,
  requestId = crypto.randomUUID(),
): Promise<{
  operationId: string;
  status: "processing" | "completed";
  completedSteps: string[];
}> {
  const subject = validUserId(userId);
  const userHash = await sha256(`${project.projectId}:${subject}`);
  const operation = await ensureOperation(env.DB, project, subject, userHash);
  if (operation.status === "completed") {
    return {
      operationId: operation.id,
      status: "completed",
      completedSteps: parseSteps(operation.completed_steps_json),
    };
  }
  const leaseId = crypto.randomUUID();
  const claimed = await claimOperation(env.DB, operation.id, leaseId);
  if (!claimed) {
    return {
      operationId: operation.id,
      status: "processing",
      completedSteps: parseSteps(operation.completed_steps_json),
    };
  }
  return runClaimedErasure(env, claimed, project, subject, requestId, leaseId);
}

export async function resumePendingAccountErasures(
  env: Env,
  limit = 10,
): Promise<{ inspected: number; completed: number; failed: number }> {
  const rows = await env.DB.prepare(
    `SELECT * FROM application_account_erasures
     WHERE status IN ('processing', 'failed')
       AND application_user_id IS NOT NULL
       AND (lease_expires_at IS NULL OR datetime(lease_expires_at) <= datetime('now'))
     ORDER BY requested_at LIMIT ?`,
  )
    .bind(Math.max(1, Math.min(50, limit)))
    .all<ErasureRow>();
  let completed = 0;
  let failed = 0;
  for (const row of rows.results) {
    try {
      const result = await eraseApplicationAccount(
        env,
        {
          projectId: Number(row.project_id),
          instanceId: Number(row.instance_id),
          projectRef: row.project_ref,
          environment: row.project_ref.endsWith("-test")
            ? "test"
            : "production",
        },
        String(row.application_user_id),
        `account-erasure-resume:${row.id}`,
      );
      if (result.status === "completed") completed += 1;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: "application_account_erasure_resume_failed",
          operation_id: row.id,
          service:
            error instanceof AccountErasureError ? error.service : "gateway",
          code:
            error instanceof AccountErasureError
              ? error.code
              : "account_erasure_internal_error",
        }),
      );
    }
  }
  return { inspected: rows.results.length, completed, failed };
}

async function runClaimedErasure(
  env: Env,
  operation: ErasureRow,
  project: AccountErasureProject,
  userId: string,
  requestId: string,
  leaseId: string,
) {
  const completed = new Set(parseSteps(operation.completed_steps_json));
  try {
    for (const step of ERASURE_STEPS) {
      if (completed.has(step.id)) continue;
      if (!step.enabled(env)) {
        completed.add(step.id);
        await persistStep(env.DB, operation.id, leaseId, completed);
        continue;
      }
      const response = await step.run(
        env,
        operation,
        project,
        userId,
        requestId,
      );
      if (!response.ok) {
        response.body?.cancel().catch(() => undefined);
        throw new AccountErasureError(
          `${step.id}_erasure_failed`,
          step.id,
          response.status >= 500 ? 503 : 502,
        );
      }
      response.body?.cancel().catch(() => undefined);
      completed.add(step.id);
      await persistStep(env.DB, operation.id, leaseId, completed);
    }
    await env.DB.prepare(
      `UPDATE application_account_erasures SET
         status = 'completed', application_user_id = NULL,
         completed_steps_json = ?, last_error_code = NULL,
         last_error_service = NULL, lease_id = NULL, lease_expires_at = NULL,
         completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND lease_id = ?`,
    )
      .bind(JSON.stringify([...completed]), operation.id, leaseId)
      .run();
    console.log(
      JSON.stringify({
        event: "application_account_erasure_completed",
        operation_id: operation.id,
        project_ref: project.projectRef,
        subject_reference: operation.application_user_hash.slice(0, 12),
        completed_steps: [...completed],
      }),
    );
    return {
      operationId: operation.id,
      status: "completed" as const,
      completedSteps: [...completed],
    };
  } catch (error) {
    const resolved =
      error instanceof AccountErasureError
        ? error
        : new AccountErasureError("account_erasure_internal_error", "gateway");
    await env.DB.prepare(
      `UPDATE application_account_erasures SET
         status = 'failed', completed_steps_json = ?, attempts = attempts + 1,
         last_error_code = ?, last_error_service = ?, lease_id = NULL,
         lease_expires_at = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND lease_id = ?`,
    )
      .bind(
        JSON.stringify([...completed]),
        resolved.code,
        resolved.service,
        operation.id,
        leaseId,
      )
      .run();
    throw resolved;
  }
}

const ERASURE_STEPS: readonly Step[] = Object.freeze([
  domainStep("app", "APP_MODULE"),
  domainStep("marketing", "MARKETING_MODULE"),
  domainStep("support", "SUPPORT_MODULE"),
  {
    id: "custom",
    enabled: (env) => Boolean(env.CUSTOM_WORKER),
    run: (env, operation, project, userId, requestId) => {
      if (!env.CUSTOM_WORKER || !env.CUSTOM_WORKER_TOKEN) {
        throw new AccountErasureError("custom_erasure_misconfigured", "custom");
      }
      return env.CUSTOM_WORKER.fetch(
        `https://custom.internal/internal/v1/users/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          headers: {
            "x-custom-worker-token": env.CUSTOM_WORKER_TOKEN,
            "x-custom-worker-project": project.projectRef,
            "x-custom-worker-subject": userId,
            "x-request-id": requestId,
            "idempotency-key": erasureKey(operation.id, "custom"),
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    },
  },
  {
    id: "billing",
    enabled: (env) => Boolean(env.BILLING),
    run: (env, operation, project, userId, requestId) => {
      if (!env.BILLING || !env.MODULE_INTERNAL_TOKEN) {
        throw new AccountErasureError(
          "billing_erasure_misconfigured",
          "billing",
        );
      }
      return env.BILLING.fetch(
        "https://billing.internal/internal/v1/customers/erase",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": env.MODULE_INTERNAL_TOKEN,
            "x-request-id": requestId,
            "idempotency-key": erasureKey(operation.id, "billing"),
          },
          body: JSON.stringify({
            project_id: String(project.projectId),
            application_user_id: userId,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    },
  },
  {
    id: "identity",
    enabled: (env) => Boolean(env.IDENTITY_SERVICE),
    run: (env, operation, _project, userId, requestId) => {
      if (!env.IDENTITY_SERVICE || !env.MODULE_INTERNAL_TOKEN) {
        throw new AccountErasureError(
          "identity_erasure_misconfigured",
          "identity",
        );
      }
      return env.IDENTITY_SERVICE.fetch(
        `https://identity.internal/internal/v1/users/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          headers: {
            "x-internal-token": env.MODULE_INTERNAL_TOKEN,
            "x-request-id": requestId,
            "idempotency-key": erasureKey(operation.id, "identity"),
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    },
  },
]);

function domainStep(
  module: DomainModuleName,
  binding: "APP_MODULE" | "MARKETING_MODULE" | "SUPPORT_MODULE",
): Step {
  return {
    id: module,
    enabled: (env) => Boolean(env[binding]),
    run: async (env, operation, project, userId, requestId) => {
      const service = env[binding];
      const secret = env.MODULE_INTERNAL_TOKEN?.trim();
      if (!service || !secret) {
        throw new AccountErasureError(
          `${module}_erasure_misconfigured`,
          module,
        );
      }
      const path = `/internal/v1/application/users/${encodeURIComponent(userId)}`;
      const context: InternalProjectContext = {
        module,
        method: "DELETE",
        pathname: path,
        projectId: project.projectId,
        projectRef: project.projectRef,
        instanceId: project.instanceId,
        environment: project.environment,
        actorId: 0,
        role: "application",
        requestId,
        issuedAt: Math.floor(Date.now() / 1_000),
      };
      const signature = await signProjectContext(context, secret);
      return service.fetch(`https://${module}.internal${path}`, {
        method: "DELETE",
        headers: {
          [PROJECT_CONTEXT_HEADERS.token]: secret,
          [PROJECT_CONTEXT_HEADERS.projectId]: String(context.projectId),
          [PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
          [PROJECT_CONTEXT_HEADERS.instanceId]: String(context.instanceId),
          [PROJECT_CONTEXT_HEADERS.environment]: context.environment,
          [PROJECT_CONTEXT_HEADERS.actorId]: "0",
          [PROJECT_CONTEXT_HEADERS.role]: context.role,
          [PROJECT_CONTEXT_HEADERS.requestId]: requestId,
          [PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
          [PROJECT_CONTEXT_HEADERS.version]: "1",
          [PROJECT_CONTEXT_HEADERS.signature]: signature,
          "x-opengrow-application-user-id": userId,
          "x-opengrow-application-email": "erasure@invalid.opengrow",
          "idempotency-key": erasureKey(operation.id, module),
        },
        signal: AbortSignal.timeout(10_000),
      });
    },
  };
}

async function ensureOperation(
  db: D1Database,
  project: AccountErasureProject,
  userId: string,
  userHash: string,
): Promise<ErasureRow> {
  await db
    .prepare(
      `INSERT INTO application_account_erasures
       (id, project_id, instance_id, project_ref, application_user_id,
        application_user_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, 'processing')
     ON CONFLICT(project_id, application_user_hash) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      project.projectId,
      project.instanceId,
      project.projectRef,
      userId,
      userHash,
    )
    .run();
  const row = await db
    .prepare(
      `SELECT * FROM application_account_erasures
     WHERE project_id = ? AND application_user_hash = ? LIMIT 1`,
    )
    .bind(project.projectId, userHash)
    .first<ErasureRow>();
  if (!row) {
    throw new AccountErasureError(
      "account_erasure_store_unavailable",
      "gateway",
    );
  }
  return row;
}

async function claimOperation(
  db: D1Database,
  operationId: string,
  leaseId: string,
): Promise<ErasureRow | null> {
  return db
    .prepare(
      `UPDATE application_account_erasures SET
       status = 'processing', lease_id = ?,
       lease_expires_at = datetime('now', '+2 minutes'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND status <> 'completed'
       AND (lease_expires_at IS NULL OR datetime(lease_expires_at) <= datetime('now'))
     RETURNING *`,
    )
    .bind(leaseId, operationId)
    .first<ErasureRow>();
}

async function persistStep(
  db: D1Database,
  operationId: string,
  leaseId: string,
  completed: Set<string>,
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE application_account_erasures SET
       completed_steps_json = ?, lease_expires_at = datetime('now', '+2 minutes'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND lease_id = ?`,
    )
    .bind(JSON.stringify([...completed]), operationId, leaseId)
    .run();
  if (Number(result.meta.changes || 0) !== 1) {
    throw new AccountErasureError("account_erasure_lease_lost", "gateway");
  }
}

function parseSteps(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function validUserId(value: string): string {
  const resolved = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(resolved)) {
    throw new AccountErasureError(
      "application_user_id_invalid",
      "identity",
      422,
      false,
    );
  }
  return resolved;
}

function erasureKey(operationId: string, service: string): string {
  return `account-erasure:${operationId}:${service}`;
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
