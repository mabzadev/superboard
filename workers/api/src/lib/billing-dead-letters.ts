import type { BillingEnv } from "../types";
import { isBillingQueueJob, type BillingQueueJob } from "./billing-dispatch";

export type BillingDeadLetterMessage = {
  id: string;
  attempts: number;
  body: unknown;
};

export async function quarantineBillingDeadLetter(
  env: BillingEnv,
  queueName: string,
  message: BillingDeadLetterMessage,
) {
  const serialized = serializeJob(message.body);
  const job = isBillingQueueJob(message.body) ? message.body : null;
  const projectId = job ? await billingJobProjectId(env.DB, job) : null;
  const digest = await sha256Hex(serialized.payload);
  const inserted = await env.DB.prepare(
    `
    INSERT OR IGNORE INTO billing_dead_letters (
      id, project_id, queue_name, job_type, job_payload, job_payload_sha256,
      job_valid, delivery_attempts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(
      message.id,
      projectId,
      queueName,
      job?.type || jobType(message.body),
      serialized.payload,
      digest,
      job && serialized.complete ? 1 : 0,
      Math.max(0, Math.floor(Number(message.attempts || 0))),
    )
    .run();
  return {
    id: message.id,
    duplicate: Number(inserted.meta.changes || 0) === 0,
    project_id: projectId,
    job_type: job?.type || jobType(message.body),
    replay_available: Boolean(job && serialized.complete),
  };
}

async function billingJobProjectId(
  db: D1Database,
  job: BillingQueueJob,
): Promise<string | null> {
  if ("projectId" in job) return existingProjectId(db, String(job.projectId));
  switch (job.type) {
    case "billing.webhook.deliver":
      return relatedProjectId(
        db,
        `
        SELECT endpoint.project_id
        FROM billing_webhook_deliveries delivery
        JOIN billing_webhook_endpoints endpoint ON endpoint.id = delivery.endpoint_id
        WHERE delivery.id = ? LIMIT 1
      `,
        job.deliveryId,
      );
    case "billing.subscription.reconcile":
      return relatedProjectId(
        db,
        "SELECT project_id FROM billing_subscriptions WHERE id = ? LIMIT 1",
        job.subscriptionId,
      );
    case "billing.refund.action.execute":
      return relatedProjectId(
        db,
        `
        SELECT refund_case.project_id
        FROM billing_refund_provider_actions action
        JOIN billing_refund_cases refund_case ON refund_case.id = action.case_id
        WHERE action.id = ? LIMIT 1
      `,
        job.actionId,
      );
    case "billing.legacy.inventory.page":
      return relatedProjectId(
        db,
        "SELECT project_id FROM billing_legacy_inventory_runs WHERE id = ? LIMIT 1",
        job.runId,
      );
    case "billing.export":
      return relatedProjectId(
        db,
        "SELECT project_id FROM billing_export_jobs WHERE id = ? LIMIT 1",
        job.exportId,
      );
    case "billing.reconcile":
      return null;
  }
}

async function existingProjectId(db: D1Database, projectId: string) {
  return relatedProjectId(
    db,
    "SELECT id AS project_id FROM projects WHERE id = ? LIMIT 1",
    projectId,
  );
}

async function relatedProjectId(
  db: D1Database,
  sql: string,
  identifier: string,
) {
  const row = await db
    .prepare(sql)
    .bind(identifier)
    .first<{ project_id: string | number }>();
  return row?.project_id == null ? null : String(row.project_id);
}

function serializeJob(body: unknown): { payload: string; complete: boolean } {
  try {
    const payload = JSON.stringify(body);
    if (
      typeof payload === "string" &&
      new TextEncoder().encode(payload).byteLength <= 262_144
    ) {
      return { payload, complete: true };
    }
  } catch {
    // Preserve a bounded quarantine record even when the original body cannot be replayed.
  }
  return {
    payload: JSON.stringify({
      quarantine_error: "Billing queue payload could not be retained safely",
    }),
    complete: false,
  };
}

function jobType(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as { type?: unknown }).type;
  return typeof value === "string" ? value.slice(0, 255) : null;
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
