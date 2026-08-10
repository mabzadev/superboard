import type { Env, MessagingQueueJob } from './types';
import { DEAD_LETTER_MAX_RECORDS, deadLetterPayload } from '@superboard/contracts/dead-letter';
import { isSafePublicHttpsUrl } from '@superboard/contracts/url-security';

export async function publishMessagingEvent(
  env: Pick<Env, 'DB' | 'MESSAGING_QUEUE'>,
  projectId: number,
  eventId: string,
  eventName: string,
  payload: Record<string, unknown>,
) {
  const subscribed = await env.DB.prepare(`
    SELECT id FROM messaging_configuration_entities entity
    WHERE project_id = ? AND entity_type = 'webhook' AND enabled = 1
      AND EXISTS (SELECT 1 FROM json_each(entity.configuration_json, '$.events') event WHERE event.value = ? OR event.value = '*')
    LIMIT 1
  `).bind(projectId, eventName).first();
  if (!subscribed) return;
  const serialized = JSON.stringify(payload);
  if (serialized.length > 64_000) throw failure('webhook_payload_too_large', 'Webhook payload is limited to 64 KB');
  await env.MESSAGING_QUEUE.send({
    type: 'messaging.webhook.dispatch', projectId, eventId, eventName,
    payload: JSON.parse(serialized) as Record<string, unknown>,
  }, { contentType: 'json' });
}

export async function handleMessagingQueue(batch: MessageBatch<unknown>, env: Env) {
  if (batch.queue === env.DLQ_NAME) {
    for (const message of batch.messages) {
      try {
        const result = await quarantineMessagingDeadLetter(env.DB, batch.queue, message);
        console.error(JSON.stringify({
          event: 'messaging_job_quarantined', message_id: message.id,
          job_type: result.jobType, replayable: result.replayable, duplicate: result.duplicate,
        }));
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: 'messaging_dead_letter_persistence_failed', message_id: message.id,
          error: error instanceof Error ? error.message : String(error),
        }));
        message.retry({ delaySeconds: 60 });
      }
    }
    return;
  }
  for (const message of batch.messages) {
    try {
      if (!isMessagingQueueJob(message.body)) throw failure('queue_job_invalid', 'Messaging Queue job is invalid');
      await deliverWebhookEvent(env, message.body);
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'messaging_queue_failed', message_id: message.id,
        error: error instanceof Error ? error.message : String(error),
      }));
      message.retry();
    }
  }
}

export async function quarantineMessagingDeadLetter(
  db: D1Database,
  sourceQueue: string,
  message: { id: string; body: unknown; attempts: number },
) {
  const payload = await deadLetterPayload(message.body);
  const id = crypto.randomUUID();
  const result = await db.prepare(`
    INSERT OR IGNORE INTO messaging_dead_letters
      (id,source_queue,message_id,job_type,payload_json,payload_sha256,payload_bytes,replayable,attempts)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    id, sourceQueue, message.id, payload.jobType, payload.payloadJson,
    payload.payloadSha256, payload.payloadBytes, payload.replayable ? 1 : 0, message.attempts,
  ).run();
  if (isMessagingQueueJob(message.body)) {
    await db.prepare(`
      UPDATE messaging_webhook_deliveries
      SET last_error = 'Delivery moved to dead-letter quarantine',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND event_id = ? AND delivered_at IS NULL
    `).bind(message.body.projectId, message.body.eventId).run();
  }
  await db.prepare(`
    DELETE FROM messaging_dead_letters WHERE id IN (
      SELECT id FROM messaging_dead_letters ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?
    )
  `).bind(DEAD_LETTER_MAX_RECORDS).run();
  return { id, duplicate: result.meta.changes === 0, ...payload };
}

export async function deliverWebhookEvent(env: Env, job: MessagingQueueJob) {
  const rows = await env.DB.prepare(`
    SELECT entity.id, entity.configuration_json
    FROM messaging_configuration_entities entity
    WHERE entity.project_id = ? AND entity.entity_type = 'webhook' AND entity.enabled = 1
      AND EXISTS (
        SELECT 1 FROM json_each(entity.configuration_json, '$.events') event
        WHERE event.value = ? OR event.value = '*'
      )
    ORDER BY entity.position, entity.created_at
  `).bind(job.projectId, job.eventName).all<{ id: string; configuration_json: string }>();
  for (const row of rows.results) await deliverOne(env, job, row);
}

async function deliverOne(
  env: Env,
  job: MessagingQueueJob,
  webhook: { id: string; configuration_json: string },
) {
  const existing = await env.DB.prepare(`
    SELECT delivered_at FROM messaging_webhook_deliveries WHERE webhook_id = ? AND event_id = ?
  `).bind(webhook.id, job.eventId).first<{ delivered_at: string | null }>();
  if (existing?.delivered_at) return;
  const configuration = JSON.parse(webhook.configuration_json) as Record<string, unknown>;
  const url = String(configuration.url || '');
  const secretReference = String(configuration.secret_reference || '');
  if (!isSafePublicHttpsUrl(url) || !/^[A-Z][A-Z0-9_]{0,127}$/.test(secretReference)) {
    throw failure('webhook_configuration_invalid', 'Webhook URL or secret reference is invalid');
  }
  const secret = Reflect.get(env, secretReference);
  if (typeof secret !== 'string' || !secret) throw failure('webhook_secret_unavailable', `Webhook secret binding ${secretReference} is unavailable`);
  const envelope = JSON.stringify({
    id: job.eventId,
    type: job.eventName,
    created_at: new Date().toISOString(),
    data: job.payload,
  });
  const signature = await hmac(secret, envelope);
  await env.DB.prepare(`
    INSERT INTO messaging_webhook_deliveries
      (id, project_id, webhook_id, event_id, event_name, attempt_count)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(webhook_id, event_id) DO UPDATE SET
      attempt_count = attempt_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(crypto.randomUUID(), job.projectId, webhook.id, job.eventId, job.eventName).run();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OpenGrow-Messaging-Webhook/1.0',
        'X-OpenGrow-Event-Id': job.eventId,
        'X-OpenGrow-Event-Type': job.eventName,
        'X-OpenGrow-Signature': `sha256=${signature}`,
      },
      body: envelope,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    await recordFailure(env.DB, webhook.id, job.eventId, null, error instanceof Error ? error.message : 'Network failure');
    throw error;
  }
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) {
    await recordFailure(env.DB, webhook.id, job.eventId, response.status, `HTTP ${response.status}`);
    throw failure('webhook_delivery_failed', `Webhook returned HTTP ${response.status}`);
  }
  await env.DB.prepare(`
    UPDATE messaging_webhook_deliveries SET response_status = ?, last_error = NULL,
      delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE webhook_id = ? AND event_id = ?
  `).bind(response.status, webhook.id, job.eventId).run();
}

async function recordFailure(db: D1Database, webhookId: string, eventId: string, status: number | null, error: string) {
  await db.prepare(`
    UPDATE messaging_webhook_deliveries SET response_status = ?, last_error = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE webhook_id = ? AND event_id = ?
  `).bind(status, error.slice(0, 1000), webhookId, eventId).run();
}

export function isMessagingQueueJob(value: unknown): value is MessagingQueueJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as Partial<MessagingQueueJob>;
  return job.type === 'messaging.webhook.dispatch'
    && Number.isInteger(job.projectId) && Number(job.projectId) > 0
    && typeof job.eventId === 'string' && job.eventId.length > 0 && job.eventId.length <= 255
    && typeof job.eventName === 'string' && job.eventName.length > 0 && job.eventName.length <= 128
    && !!job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload);
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function failure(code: string, message: string) { return Object.assign(new Error(message), { code }); }
