import type { Env, SupportQueueJob } from './types';
import { decryptSecret } from './secrets';
import { DEAD_LETTER_MAX_RECORDS, deadLetterPayload } from '@opengrow/contracts/dead-letter';
import { isSafePublicHttpsUrl } from '@opengrow/contracts/url-security';

export async function publishSupportEvent(
  env: Pick<Env, 'DB' | 'SUPPORT_QUEUE'>,
  projectId: number,
  eventId: string,
  eventName: string,
  payload: Record<string, unknown>,
) {
  const subscribed = await env.DB.prepare(`
    SELECT id FROM support_configuration_entities entity
    WHERE project_id = ? AND entity_type = 'webhook' AND enabled = 1
      AND EXISTS (SELECT 1 FROM json_each(entity.configuration_json, '$.events') event WHERE event.value = ? OR event.value = '*')
    LIMIT 1
  `).bind(projectId, eventName).first();
  if (!subscribed) return;
  const serialized = JSON.stringify(payload);
  if (serialized.length > 64_000) throw failure('webhook_payload_too_large', 'Webhook payload is limited to 64 KB');
  await env.SUPPORT_QUEUE.send({
    type: 'support.webhook.dispatch', projectId, eventId, eventName,
    payload: JSON.parse(serialized) as Record<string, unknown>,
  }, { contentType: 'json' });
}

export async function handleSupportQueue(batch: MessageBatch<unknown>, env: Env) {
  if (batch.queue === env.DLQ_NAME) {
    for (const message of batch.messages) {
      try {
        const result = await quarantineSupportDeadLetter(env.DB, batch.queue, message);
        console.error(JSON.stringify({
          event: 'support_job_quarantined', message_id: message.id,
          job_type: result.jobType, replayable: result.replayable, duplicate: result.duplicate,
        }));
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: 'support_dead_letter_persistence_failed', message_id: message.id,
          error: error instanceof Error ? error.message : String(error),
        }));
        message.retry({ delaySeconds: 60 });
      }
    }
    return;
  }
  for (const message of batch.messages) {
    try {
      if (!isSupportQueueJob(message.body)) throw failure('queue_job_invalid', 'Support Queue job is invalid');
      await deliverWebhookEvent(env, message.body);
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'support_queue_failed', message_id: message.id,
        error: error instanceof Error ? error.message : String(error),
      }));
      message.retry();
    }
  }
}

export async function quarantineSupportDeadLetter(
  db: D1Database,
  sourceQueue: string,
  message: { id: string; body: unknown; attempts: number },
) {
  const payload = await deadLetterPayload(message.body);
  const id = crypto.randomUUID();
  const result = await db.prepare(`
    INSERT OR IGNORE INTO support_dead_letters
      (id,source_queue,message_id,job_type,payload_json,payload_sha256,payload_bytes,replayable,attempts)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    id, sourceQueue, message.id, payload.jobType, payload.payloadJson,
    payload.payloadSha256, payload.payloadBytes, payload.replayable ? 1 : 0, message.attempts,
  ).run();
  if (isSupportQueueJob(message.body)) {
    await db.prepare(`
      UPDATE support_webhook_deliveries
      SET last_error = 'Delivery moved to dead-letter quarantine',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND event_id = ? AND delivered_at IS NULL
    `).bind(message.body.projectId, message.body.eventId).run();
  }
  await db.prepare(`
    DELETE FROM support_dead_letters WHERE id IN (
      SELECT id FROM support_dead_letters ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?
    )
  `).bind(DEAD_LETTER_MAX_RECORDS).run();
  return { id, duplicate: result.meta.changes === 0, ...payload };
}

export async function deliverWebhookEvent(env: Env, job: SupportQueueJob) {
  const rows = await env.DB.prepare(`
    SELECT entity.id, entity.configuration_json
    FROM support_configuration_entities entity
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
  job: SupportQueueJob,
  webhook: { id: string; configuration_json: string },
) {
  const existing = await env.DB.prepare(`
    SELECT delivered_at FROM support_webhook_deliveries WHERE webhook_id = ? AND event_id = ?
  `).bind(webhook.id, job.eventId).first<{ delivered_at: string | null }>();
  if (existing?.delivered_at) return;
  const configuration = JSON.parse(webhook.configuration_json) as Record<string, unknown>;
  const url = String(configuration.url || '');
  if (!isSafePublicHttpsUrl(url)) throw failure('webhook_configuration_invalid', 'Webhook URL is invalid');
  const storedSecret = await env.DB.prepare(`
    SELECT encrypted_secret FROM support_webhook_secrets WHERE project_id = ? AND webhook_id = ?
  `).bind(job.projectId, webhook.id).first<{ encrypted_secret: string }>();
  if (!storedSecret) throw failure('webhook_secret_unavailable', 'Webhook signing secret is not configured');
  const secret = await decryptSecret(env.SUPPORT_WEBHOOK_ENCRYPTION_KEY, storedSecret.encrypted_secret);
  const envelope = JSON.stringify({
    id: job.eventId,
    type: job.eventName,
    created_at: new Date().toISOString(),
    data: job.payload,
  });
  const signature = await hmac(secret, envelope);
  await env.DB.prepare(`
    INSERT INTO support_webhook_deliveries
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
        'User-Agent': 'OpenGrow-Support-Webhook/1.0',
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
    UPDATE support_webhook_deliveries SET response_status = ?, last_error = NULL,
      delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE webhook_id = ? AND event_id = ?
  `).bind(response.status, webhook.id, job.eventId).run();
}

async function recordFailure(db: D1Database, webhookId: string, eventId: string, status: number | null, error: string) {
  await db.prepare(`
    UPDATE support_webhook_deliveries SET response_status = ?, last_error = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE webhook_id = ? AND event_id = ?
  `).bind(status, error.slice(0, 1000), webhookId, eventId).run();
}

export function isSupportQueueJob(value: unknown): value is SupportQueueJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as Partial<SupportQueueJob>;
  return job.type === 'support.webhook.dispatch'
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
