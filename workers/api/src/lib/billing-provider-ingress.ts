import type { BillingEnv } from '../types';
import type { BillingQueueJob } from './billing-dispatch';
import { verifyAppleNotification } from './store-verification';

type ProviderJob =
  | Omit<Extract<BillingQueueJob, { type: 'billing.apple.notification' }>, 'eventId'>
  | Omit<Extract<BillingQueueJob, { type: 'billing.google.notification' }>, 'eventId'>
  | Omit<Extract<BillingQueueJob, { type: 'billing.stripe.notification' }>, 'eventId'>;

export type BillingProviderIngressRequest = {
  projectId: string;
  store: 'apple' | 'google' | 'stripe';
  environment: 'sandbox' | 'production';
  externalEventId: string;
  eventType?: string;
  payload: string;
  job: ProviderJob;
};

export async function ingestBillingProviderEvent(env: BillingEnv, request: BillingProviderIngressRequest) {
  validateRequest(request);
  if (request.job.type === 'billing.apple.notification') {
    try {
      await verifyAppleNotification(env, {
        projectId: request.projectId,
        signedPayload: request.job.signedPayload,
        environment: request.environment,
      });
    } catch {
      throw ingressError('apple_notification_invalid', 'Apple notification signature is invalid', 401, false);
    }
  }

  const eventId = crypto.randomUUID();
  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_webhook_events (
      id, project_id, store, environment, external_event_id, event_type, status, payload
    ) VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
  `).bind(
    eventId,
    request.projectId,
    request.store,
    request.environment,
    request.externalEventId,
    request.eventType || null,
    request.payload,
  ).run();
  const persisted = await env.DB.prepare(`
    SELECT id, status FROM billing_webhook_events
    WHERE project_id = ? AND store = ? AND environment = ? AND external_event_id = ? LIMIT 1
  `).bind(request.projectId, request.store, request.environment, request.externalEventId)
    .first<{ id: string; status: string }>();
  if (!persisted) throw ingressError('provider_event_persistence_failed', 'Provider event persistence failed', 503, true);
  if (persisted.status === 'processed') {
    return { event_id: persisted.id, duplicate: true, queued: false, processed: true };
  }
  if (!env.BILLING_QUEUE) {
    await markQueueFailure(env.DB, persisted.id);
    throw ingressError('billing_queue_unavailable', 'Billing queue is unavailable', 503, true);
  }
  try {
    await env.BILLING_QUEUE.send({ ...request.job, eventId: persisted.id } as BillingQueueJob);
    if (persisted.status === 'failed') {
      await env.DB.prepare(`
        UPDATE billing_webhook_events SET status = 'received', error_message = NULL WHERE id = ?
      `).bind(persisted.id).run();
    }
  } catch {
    await markQueueFailure(env.DB, persisted.id);
    throw ingressError('billing_queue_unavailable', 'Billing queue is unavailable', 503, true);
  }
  return {
    event_id: persisted.id,
    duplicate: Number(inserted.meta.changes || 0) === 0,
    queued: true,
    processed: false,
  };
}

function validateRequest(request: BillingProviderIngressRequest) {
  if (!request.projectId || request.projectId.length > 255) {
    throw ingressError('provider_event_project_invalid', 'Provider event project is invalid');
  }
  if (!['apple', 'google', 'stripe'].includes(request.store)) {
    throw ingressError('provider_event_store_invalid', 'Provider event store is invalid');
  }
  if (!['sandbox', 'production'].includes(request.environment)) {
    throw ingressError('provider_event_environment_invalid', 'Provider event environment is invalid');
  }
  if (!request.externalEventId || request.externalEventId.length > 512) {
    throw ingressError('provider_event_id_invalid', 'Provider event ID is invalid');
  }
  if ((request.eventType || '').length > 255 || !request.payload || request.payload.length > 1_048_576) {
    throw ingressError('provider_event_payload_invalid', 'Provider event payload is invalid', 413);
  }
  const expectedType = `billing.${request.store}.notification`;
  if (request.job.type !== expectedType) {
    throw ingressError('provider_event_job_invalid', 'Provider event job does not match its store');
  }
  if ('projectId' in request.job && request.job.projectId !== request.projectId) {
    throw ingressError('provider_event_job_invalid', 'Provider event job does not match its project');
  }
  if (request.store === 'apple' && request.job.type === 'billing.apple.notification'
    && request.job.environment !== request.environment) {
    throw ingressError('provider_event_job_invalid', 'Provider event job does not match its environment');
  }
}

async function markQueueFailure(db: D1Database, eventId: string) {
  await db.prepare(`
    UPDATE billing_webhook_events SET status = 'failed', error_message = 'Queue delivery failed' WHERE id = ?
  `).bind(eventId).run();
}

function ingressError(code: string, message: string, status = 422, retryable = false) {
  return Object.assign(new Error(message), { code, status, retryable });
}
