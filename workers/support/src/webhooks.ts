import type { Env, SupportQueueJob } from './types';
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
} from './secrets';
import { DEAD_LETTER_MAX_RECORDS, deadLetterPayload } from '@superboard/contracts/dead-letter';
import { readTextLimited } from '@superboard/contracts/request-body';
import { isSafePublicHttpsUrl } from '@superboard/contracts/url-security';
import {
  chunkText,
  embedSupportText,
  supportKnowledgeContext,
} from './knowledge';
import {
  evaluateAppliedSla,
  initializeConversationPolicies,
} from './service-levels';
import { runConversationAutomations } from './workflows';
import {
  deliverSupportNotification,
  failSupportNotificationDelivery,
} from './notifications';
import { executeNativeIntegration } from './integrations';
import {
  canAutomaticallyDeliverCaptainResult,
  captainErrorCode,
  isAutomaticCaptainTrigger,
  type AutomaticCaptainAuthorization,
} from './captain';

export async function publishSupportEvent(
  env: Pick<Env, 'DB' | 'SUPPORT_QUEUE'>,
  projectId: number,
  eventId: string,
  eventName: string,
  payload: Record<string, unknown>,
) {
  const subscribed = await env.DB.prepare(`
    SELECT id FROM support_integrations integration
    WHERE project_id = ? AND provider = 'webhook'
      AND status IN ('configured', 'validated', 'live_validated')
      AND EXISTS (SELECT 1 FROM json_each(integration.settings_json, '$.events') event WHERE event.value = ? OR event.value = '*')
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
  if (isDeadLetterQueue(batch.queue, env)) {
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
      await dispatchSupportJob(env, message.body);
      message.ack();
    } catch (error) {
      if (isSupportQueueJob(message.body)
        && message.body.type === 'support.provider.event.received.v1'
        && String((error as { code?: unknown })?.code || '') !== 'provider_event_in_progress') {
        const code = String((error as { code?: unknown })?.code || 'provider_event_failed');
        await env.DB.prepare(`
          UPDATE support_provider_events SET status = 'failed', last_error = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND project_id = ? AND endpoint_id = ? AND status = 'processing'
        `).bind(
          (/^[a-z0-9_]{1,128}$/u.test(code) ? code : 'provider_event_failed'),
          message.body.eventRecordId,
          message.body.projectId,
          message.body.endpointId,
        ).run().catch(() => undefined);
      }
      console.error(JSON.stringify({
        event: 'support_queue_failed', message_id: message.id,
        error: error instanceof Error ? error.message : String(error),
      }));
      const status = Number((error as { status?: number }).status || 500);
      const retryable = status === 429 || status >= 500;
      const errorCode = captainErrorCode(error, 'captain_processing_failed');
      if (isSupportQueueJob(message.body) && message.body.type === 'support.captain.task.v1'
        && errorCode !== 'captain_task_in_progress') {
        await env.DB.prepare(`
          UPDATE support_assistant_tasks
          SET status = ?, last_error = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND project_id = ? AND status = 'running'
        `).bind(
          retryable ? 'queued' : 'failed',
          errorCode,
          message.body.taskId,
          message.body.projectId,
        ).run().catch(() => undefined);
      }
      if (retryable) {
        message.retry({
          delaySeconds: Math.min(900, Math.max(5, 2 ** Math.min(message.attempts, 9))),
        });
      } else {
        // Invalid jobs are acknowledged only after durable quarantine.
        try {
          await quarantineSupportDeadLetter(env.DB, batch.queue, message);
          message.ack();
        } catch {
          message.retry({ delaySeconds: 60 });
        }
      }
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
  if (isSupportQueueJob(message.body) && message.body.type === 'support.webhook.dispatch') {
    await db.prepare(`
      UPDATE support_webhook_deliveries
      SET last_error = 'Delivery moved to dead-letter quarantine',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND event_id = ? AND delivered_at IS NULL
    `).bind(message.body.projectId, message.body.eventId).run();
  }
  if (isSupportQueueJob(message.body) && message.body.type === 'support.notification.deliver.v1') {
    await failSupportNotificationDelivery(
      db,
      message.body.projectId,
      message.body.notificationId,
    );
  }
  if (isSupportQueueJob(message.body) && message.body.type === 'support.provider.delivery.send.v1') {
    const delivery = await db.prepare(`
      UPDATE support_provider_deliveries SET status = 'failed',
        last_error = COALESCE(last_error, 'delivery_exhausted'), next_attempt_at = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?
      RETURNING endpoint_id, conversation_id, message_id, idempotency_key, last_error
    `).bind(message.body.deliveryId, message.body.projectId).first<{
      endpoint_id: string;
      conversation_id: string | null;
      message_id: string | null;
      idempotency_key: string;
      last_error: string;
    }>();
    if (delivery?.conversation_id && delivery.message_id) {
      await db.prepare(`
        UPDATE messages SET delivery_status = 'failed', failure_reason = ?
        WHERE id = ? AND conversation_id = ?
      `).bind(delivery.last_error, delivery.message_id, delivery.conversation_id).run();
      const campaign = await db.prepare(`
        UPDATE support_campaign_deliveries SET status = 'failed', last_error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ? AND endpoint_id = ? AND idempotency_key = ?
        RETURNING campaign_id
      `).bind(
        delivery.last_error,
        message.body.projectId,
        delivery.endpoint_id,
        delivery.idempotency_key,
      ).first<{ campaign_id: string }>();
      if (campaign) await reconcileCampaign(db, message.body.projectId, campaign.campaign_id);
    }
  }
  if (isSupportQueueJob(message.body)) {
    if (message.body.scheduledJobId) {
      await db.prepare(`UPDATE support_scheduled_jobs SET status = 'failed',
        last_error = 'dead_letter_quarantine', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND project_id = ? AND status NOT IN ('completed', 'cancelled')`)
        .bind(message.body.scheduledJobId, message.body.projectId).run();
    }
    if (message.body.type === 'support.captain.task.v1') {
      await db.prepare(`UPDATE support_assistant_tasks SET status = 'failed',
        last_error = COALESCE(last_error, 'processing_exhausted'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND project_id = ? AND status NOT IN ('completed', 'cancelled')`)
        .bind(message.body.taskId, message.body.projectId).run();
    } else if (message.body.type === 'support.knowledge.index.v1') {
      await db.prepare(`UPDATE support_knowledge_documents SET status = 'failed',
        last_error = 'indexing_exhausted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ? AND source_type = ? AND source_id = ?`)
        .bind(message.body.projectId, message.body.sourceType, message.body.sourceId).run();
    } else if (message.body.type === 'support.export.requested.v1') {
      await db.prepare(`UPDATE support_export_jobs SET status = 'failed', last_error = 'processing_exhausted',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?`)
        .bind(message.body.exportId, message.body.projectId).run();
    } else if (message.body.type === 'support.import.requested.v1') {
      await db.prepare(`UPDATE support_import_jobs SET status = 'failed', last_error = 'processing_exhausted',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?`)
        .bind(message.body.importId, message.body.projectId).run();
    }
  }
  await db.prepare(`
    DELETE FROM support_dead_letters WHERE id IN (
      SELECT id FROM support_dead_letters ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?
    )
  `).bind(DEAD_LETTER_MAX_RECORDS).run();
  return { id, duplicate: result.meta.changes === 0, ...payload };
}

export async function deliverWebhookEvent(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.webhook.dispatch' }>,
) {
  const rows = await env.DB.prepare(`
    SELECT integration.id, integration.settings_json configuration_json
    FROM support_integrations integration
    WHERE integration.project_id = ? AND integration.provider = 'webhook'
      AND integration.status IN ('configured', 'validated', 'live_validated')
      AND EXISTS (
        SELECT 1 FROM json_each(integration.settings_json, '$.events') event
        WHERE event.value = ? OR event.value = '*'
      )
    ORDER BY integration.created_at, integration.id
  `).bind(job.projectId, job.eventName).all<{ id: string; configuration_json: string }>();
  for (const row of rows.results) await deliverOne(env, job, row);
}

async function deliverOne(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.webhook.dispatch' }>,
  webhook: { id: string; configuration_json: string },
) {
  const existing = await env.DB.prepare(`
    SELECT delivered_at FROM support_webhook_deliveries WHERE webhook_id = ? AND event_id = ?
  `).bind(webhook.id, job.eventId).first<{ delivered_at: string | null }>();
  if (existing?.delivered_at) return;
  const configuration = JSON.parse(webhook.configuration_json) as Record<string, unknown>;
  const url = String(configuration.endpoint_url || '');
  if (!isSafePublicHttpsUrl(url)) throw failure('webhook_configuration_invalid', 'Webhook URL is invalid');
  const storedSecret = await env.DB.prepare(`
    SELECT encrypted_payload FROM support_integration_credentials
    WHERE project_id = ? AND integration_id = ?
  `).bind(job.projectId, webhook.id).first<{ encrypted_payload: string }>();
  if (!storedSecret) throw failure('webhook_secret_unavailable', 'Webhook signing secret is not configured');
  const decrypted = await decryptCredentialPayload([
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], storedSecret.encrypted_payload);
  const secret = String(decrypted.payload.signing_secret || '');
  if (!secret) throw failure('webhook_secret_unavailable', 'Webhook signing secret is not configured');
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
        'User-Agent': 'SuperBoard-Support-Webhook/1.0',
        'X-SuperBoard-Event-Id': job.eventId,
        'X-SuperBoard-Event-Type': job.eventName,
        'X-SuperBoard-Signature': `sha256=${signature}`,
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
  const job = value as Record<string, unknown>;
  if (!Number.isInteger(job.projectId) || Number(job.projectId) <= 0 || typeof job.type !== 'string') return false;
  if (job.type === 'support.webhook.dispatch') {
    return boundedString(job.eventId, 255) && boundedString(job.eventName, 128)
      && !!job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload);
  }
  if (job.type === 'support.provider.event.received.v1') {
    return boundedString(job.endpointId, 255) && boundedString(job.provider, 64)
      && boundedString(job.eventRecordId, 255);
  }
  if (job.type === 'support.provider.oauth.exchange.v1') {
    return boundedString(job.endpointId, 255) && boundedString(job.provider, 64)
      && boundedString(job.oauthStateId, 255) && boundedString(job.authorizationCode, 4_096);
  }
  if (job.type === 'support.message.retry.v1') {
    return boundedString(job.conversationId, 255) && boundedString(job.messageId, 255);
  }
  if (job.type === 'support.notification.deliver.v1') {
    return boundedString(job.notificationId, 255);
  }
  if (job.type === 'support.provider.delivery.send.v1') {
    return boundedString(job.deliveryId, 255);
  }
  if (job.type === 'support.knowledge.index.v1') {
    return boundedString(job.sourceType, 64) && boundedString(job.sourceId, 255);
  }
  if (job.type === 'support.captain.task.v1') return boundedString(job.taskId, 255);
  if (job.type === 'support.campaign.dispatch.v1') return boundedString(job.campaignId, 255);
  if (job.type === 'support.import.requested.v1') return boundedString(job.importId, 255);
  if (job.type === 'support.export.requested.v1') return boundedString(job.exportId, 255);
  if (job.type === 'support.sla.evaluate.v1' || job.type === 'support.report.rollup.v1') {
    return boundedString(job.resourceId, 255);
  }
  if (job.type === 'support.workflow.action.v1') {
    return boundedString(job.resourceId, 255) && boundedString(job.target, 255)
      && boundedString(job.conversationId, 255)
      && ['webhook', 'integration'].includes(String(job.action));
  }
  return false;
}

async function dispatchSupportJob(env: Env, job: SupportQueueJob) {
  if (job.type === 'support.webhook.dispatch') await deliverWebhookEvent(env, job);
  else if (job.type === 'support.notification.deliver.v1') await deliverSupportNotification(env, job);
  else if (job.type === 'support.provider.event.received.v1') await processProviderEvent(env, job);
  else if (job.type === 'support.provider.oauth.exchange.v1') await exchangeProviderOAuth(env, job);
  else if (job.type === 'support.message.retry.v1') await retryProviderMessage(env, job);
  else if (job.type === 'support.provider.delivery.send.v1') await sendProviderDelivery(env, job);
  else if (job.type === 'support.knowledge.index.v1') await indexKnowledge(env, job);
  else if (job.type === 'support.captain.task.v1') await runCaptainTask(env, job);
  else if (job.type === 'support.campaign.dispatch.v1') await dispatchCampaign(env, job);
  else if (job.type === 'support.import.requested.v1') await processImport(env, job);
  else if (job.type === 'support.export.requested.v1') await processExport(env, job);
  else if (job.type === 'support.sla.evaluate.v1') await evaluateSla(env, job.projectId, job.resourceId);
  else if (job.type === 'support.report.rollup.v1') await rollupReports(env.DB, job.projectId, job.resourceId);
  else if (job.type === 'support.workflow.action.v1') await runWorkflowAction(env, job);
  if (job.scheduledJobId) {
    await env.DB.prepare(`UPDATE support_scheduled_jobs SET status = 'completed', last_error = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?`)
      .bind(job.scheduledJobId, job.projectId).run();
  }
}

async function runWorkflowAction(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.workflow.action.v1' }>,
) {
  if (job.action === 'webhook') {
    const webhook = await env.DB.prepare(`SELECT id, settings_json configuration_json FROM support_integrations
      WHERE id = ? AND project_id = ? AND provider = 'webhook'
        AND status IN ('configured', 'validated', 'live_validated')`)
      .bind(job.target, job.projectId).first<{ id: string; configuration_json: string }>();
    if (!webhook) throw Object.assign(failure('configuration_required', 'Workflow webhook is not configured'), { status: 422 });
    return deliverOne(env, {
      type: 'support.webhook.dispatch', projectId: job.projectId,
      eventId: job.resourceId, eventName: 'automation.triggered',
      payload: { conversation_id: job.conversationId, webhook_id: job.target },
    }, webhook);
  }
  return executeNativeIntegration(env, {
    projectId: job.projectId,
    integrationId: job.target,
    conversationId: job.conversationId,
    idempotencyKey: job.resourceId,
  });
}

async function processProviderEvent(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.provider.event.received.v1' }>,
) {
  const event = await env.DB.prepare(`
    UPDATE support_provider_events SET status = 'processing', attempts = attempts + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND endpoint_id = ?
      AND (status IN ('queued', 'failed')
        OR (status = 'processing' AND julianday(updated_at) <= julianday('now', '-5 minutes')))
    RETURNING id, event_type, payload_json
  `).bind(job.eventRecordId, job.projectId, job.endpointId).first<{
    id: string; event_type: string; payload_json: string;
  }>();
  if (!event) {
    const pending = await env.DB.prepare(`
      SELECT status FROM support_provider_events
      WHERE id = ? AND project_id = ? AND endpoint_id = ?
    `).bind(job.eventRecordId, job.projectId, job.endpointId).first<{ status: string }>();
    if (pending?.status === 'processing') {
      throw failure('provider_event_in_progress', 'Provider event is already being processed', 503);
    }
    return;
  }
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(event.payload_json) as Record<string, unknown>; } catch { /* validated on ingress */ }
  const receipts = normalizeProviderDeliveryReceipts(job.provider, payload);
  for (const receipt of receipts) await applyProviderDeliveryReceipt(env, job, receipt);
  const normalized = normalizeInboundProviderEvent(job.provider, payload);
  if (!normalized.externalUserId || !normalized.messageBody) {
    await finishProviderEvent(env.DB, event.id, receipts.length ? 'processed' : 'ignored');
    return;
  }
  const endpoint = await env.DB.prepare(
    'SELECT inbox_id FROM support_provider_endpoints WHERE id = ? AND project_id = ?',
  ).bind(job.endpointId, job.projectId).first<{ inbox_id: string | null }>();
  if (!endpoint?.inbox_id) {
    throw failure('configuration_required', 'Provider endpoint is not connected to a Support inbox', 422);
  }
  await env.DB.prepare(`
    INSERT INTO support_contacts (id, project_id, external_user_id, name, email, last_seen_at)
    VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(project_id, external_user_id) DO UPDATE SET
      name = COALESCE(excluded.name, support_contacts.name),
      email = COALESCE(excluded.email, support_contacts.email),
      last_seen_at = excluded.last_seen_at,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(
    crypto.randomUUID(), job.projectId, normalized.externalUserId,
    normalized.senderName || null, normalized.senderEmail || null,
  ).run();
  const contact = await env.DB.prepare(`
    SELECT id FROM support_contacts WHERE project_id = ? AND external_user_id = ?
  `).bind(job.projectId, normalized.externalUserId).first<{ id: string }>();
  if (!contact) throw failure('provider_contact_failed', 'Provider contact could not be persisted');
  await env.DB.prepare(`
    INSERT INTO support_contact_inboxes
      (id, project_id, contact_id, inbox_id, source_id, verified, metadata_json)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(project_id, inbox_id, source_id) DO UPDATE SET
      contact_id = excluded.contact_id,
      metadata_json = excluded.metadata_json,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(
    crypto.randomUUID(), job.projectId, contact.id, endpoint.inbox_id,
    normalized.externalUserId,
    JSON.stringify({ provider: job.provider, endpoint_id: job.endpointId }),
  ).run();
  const conversationId = crypto.randomUUID();
  const clientConversationId = `${job.provider}:${normalized.threadId || normalized.externalUserId}`.slice(0, 128);
  const conversation = await env.DB.prepare(`
    INSERT INTO conversations
      (id, project_id, external_user_id, client_conversation_id, subject, inbox_id, external_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, external_user_id, client_conversation_id) DO UPDATE SET
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') RETURNING id, created_at
  `).bind(
    conversationId, job.projectId, normalized.externalUserId, clientConversationId,
    normalized.subject || null, endpoint.inbox_id, normalized.threadId || null,
  ).first<{ id: string; created_at?: string }>();
  if (!conversation) throw failure('provider_conversation_failed', 'Provider conversation could not be persisted');
  if (conversation.id === conversationId) {
    await runConversationAutomations(
      env,
      job.projectId,
      conversation.id,
      'conversation_created',
      `provider:${event.id}:conversation_created`,
    );
    const initialized = await initializeConversationPolicies(
      env.DB,
      job.projectId,
      conversation.id,
      conversation.created_at ? new Date(conversation.created_at) : new Date(),
    );
    if (initialized.assignment.assigned) {
      await publishSupportEvent(
        env,
        job.projectId,
        `assignment.updated:${conversation.id}:${initialized.assignment.policyId}`,
        'assignment.updated',
        {
          conversation_id: conversation.id,
          policy_id: initialized.assignment.policyId,
          policy_type: initialized.assignment.policyType,
          membership_id: initialized.assignment.membershipId,
          assigned_user_id: initialized.assignment.userId,
          assigned_team_id: initialized.assignment.teamId,
          reason: initialized.assignment.reason,
        },
      );
    }
    if (initialized.sla.applied && initialized.sla.reason === 'applied') {
      await publishSupportEvent(
        env,
        job.projectId,
        `sla.applied:${conversation.id}:${initialized.sla.appliedSlaId}`,
        'sla.applied',
        {
          conversation_id: conversation.id,
          applied_sla_id: initialized.sla.appliedSlaId,
          policy_id: initialized.sla.policyId,
          first_response_due_at: initialized.sla.firstResponseDueAt,
          resolution_due_at: initialized.sla.resolutionDueAt,
        },
      );
    }
    await publishSupportEvent(
      env,
      job.projectId,
      `conversation.created:${conversation.id}`,
      'conversation.created',
      { conversation_id: conversation.id, inbox_id: endpoint.inbox_id, source: job.provider },
    );
  }
  const result = await roomJson(
    env,
    conversation.id,
    { kind: 'user', id: normalized.externalUserId },
    '/messages',
    {
      body: normalized.messageBody,
      client_message_id: `${job.provider}:${normalized.messageId || event.id}`.slice(0, 128),
      visibility: 'public',
      content_type: 'text',
      metadata: boundedProviderMetadata({
        provider: job.provider,
        endpoint_id: job.endpointId,
        provider_message_id: normalized.messageId,
        attachment_count: normalized.attachments.length,
        authenticity: normalized.authenticity,
      }),
    },
  );
  const message = asObject(result.data);
  if (normalized.messageId && message.id) {
    await env.DB.prepare(`
      UPDATE messages SET provider_message_id = COALESCE(provider_message_id, ?)
      WHERE id = ? AND conversation_id = ?
    `).bind(normalized.messageId, String(message.id), conversation.id).run();
  }
  await finishProviderEvent(env.DB, event.id, 'processed');
}

type ProviderDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';
type ProviderDeliveryReceipt = {
  providerReference?: string;
  deliveryId?: string;
  status: ProviderDeliveryStatus;
  reasonCode?: string;
};

async function applyProviderDeliveryReceipt(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.provider.event.received.v1' }>,
  receipt: ProviderDeliveryReceipt,
) {
  const delivery = await env.DB.prepare(`
    SELECT delivery.id, delivery.conversation_id, delivery.message_id, delivery.idempotency_key,
      delivery.status, campaign.campaign_id
    FROM support_provider_deliveries delivery
    LEFT JOIN messages message ON message.id = delivery.message_id
    LEFT JOIN support_campaign_deliveries campaign
      ON campaign.project_id = delivery.project_id
      AND campaign.endpoint_id = delivery.endpoint_id
      AND campaign.idempotency_key = delivery.idempotency_key
    WHERE delivery.project_id = ? AND delivery.endpoint_id = ?
      AND ((? <> '' AND delivery.id = ?)
        OR (? <> '' AND (delivery.provider_reference = ? OR message.provider_message_id = ?)))
    ORDER BY delivery.created_at DESC, delivery.id DESC LIMIT 1
  `).bind(
    job.projectId,
    job.endpointId,
    receipt.deliveryId || '',
    receipt.deliveryId || '',
    receipt.providerReference || '',
    receipt.providerReference || '',
    receipt.providerReference || '',
  ).first<{
    id: string;
    conversation_id: string | null;
    message_id: string | null;
    idempotency_key: string;
    status: string;
    campaign_id: string | null;
  }>();
  if (!delivery?.conversation_id || !delivery.message_id) return;
  if (!providerStatusAdvances(delivery.status, receipt.status)) return;
  await roomJson(
    env,
    delivery.conversation_id,
    { kind: 'system', id: `provider:${job.provider}`.slice(0, 255) },
    `/messages/${encodeURIComponent(delivery.message_id)}/delivery`,
    {
      delivery_id: delivery.id,
      status: receipt.status,
      ...(receipt.reasonCode ? { reason_code: receipt.reasonCode } : {}),
    },
    'PATCH',
  );
  if (receipt.providerReference) {
    await env.DB.prepare(`
      UPDATE messages SET provider_message_id = COALESCE(provider_message_id, ?)
      WHERE id = ? AND conversation_id = ?
    `).bind(receipt.providerReference, delivery.message_id, delivery.conversation_id).run();
  }
  await env.DB.prepare(`
    UPDATE support_campaign_deliveries SET
      status = ?, provider_reference = COALESCE(provider_reference, ?),
      last_error = ?,
      sent_at = CASE WHEN ? IN ('sent', 'delivered', 'read')
        THEN COALESCE(sent_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE sent_at END,
      delivered_at = CASE WHEN ? IN ('delivered', 'read')
        THEN COALESCE(delivered_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE delivered_at END,
      read_at = CASE WHEN ? = 'read'
        THEN COALESCE(read_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE read_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND endpoint_id = ? AND idempotency_key = ?
  `).bind(
    receipt.status,
    receipt.providerReference || null,
    receipt.reasonCode || null,
    receipt.status,
    receipt.status,
    receipt.status,
    job.projectId,
    job.endpointId,
    delivery.idempotency_key,
  ).run();
  if (delivery.campaign_id) {
    await reconcileCampaign(env.DB, job.projectId, delivery.campaign_id);
  }
}

async function roomJson(
  env: Env,
  conversationId: string,
  actor: { kind: 'user' | 'agent' | 'system'; id: string },
  path: string,
  body: Record<string, unknown>,
  method: 'POST' | 'PATCH' = 'POST',
) {
  const stub = env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(conversationId));
  const response = await stub.fetch(new Request(`https://support-room.internal${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-room-capability': env.INTERNAL_API_TOKEN,
      'x-conversation-id': conversationId,
      'x-actor-id': actor.id,
      'x-actor-kind': actor.kind,
      'x-identity-expires-at': String(Date.now() + 60_000),
    },
    body: JSON.stringify(body),
  }));
  let payload: Record<string, unknown> = {};
  try {
    payload = asObject(JSON.parse(await readTextLimited(response, 64_000)));
  } catch {
    // Normalized below.
  }
  if (!response.ok) {
    const error = asObject(payload.error);
    throw failure(
      String(error.code || payload.code || 'support_room_request_failed').slice(0, 128),
      String(error.message || payload.message || 'Support conversation operation failed').slice(0, 1_000),
      response.status,
    );
  }
  return payload;
}

function boundedProviderMetadata(value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength <= 16_000) return value;
  return {
    provider: value.provider,
    endpoint_id: value.endpoint_id,
    provider_message_id: value.provider_message_id,
    attachment_count: value.attachment_count,
  };
}

function providerStatusAdvances(current: string, next: ProviderDeliveryStatus) {
  if (current === next || current === 'read') return false;
  if (current === 'delivered') return next === 'read';
  if (current === 'failed') return next === 'delivered' || next === 'read';
  return true;
}

async function exchangeProviderOAuth(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.provider.oauth.exchange.v1' }>,
) {
  const row = await env.DB.prepare(`
    SELECT endpoint.settings_json, credential.encrypted_payload, state.verifier_encrypted,
      state.callback_uri
    FROM support_provider_endpoints endpoint
    INNER JOIN support_provider_credentials credential ON credential.endpoint_id = endpoint.id
    INNER JOIN support_oauth_states state ON state.id = ? AND state.endpoint_id = endpoint.id
    WHERE endpoint.id = ? AND endpoint.project_id = ? AND endpoint.provider = ?
  `).bind(job.oauthStateId, job.endpointId, job.projectId, job.provider).first<{
    settings_json: string;
    encrypted_payload: string;
    verifier_encrypted: string | null;
    callback_uri: string;
  }>();
  if (!row) throw failure('configuration_required', 'OAuth provider configuration is unavailable');
  const decrypted = await decryptCredentialPayload([
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], row.encrypted_payload);
  const verifier = row.verifier_encrypted
    ? (await decryptCredentialPayload([
        env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
        env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
      ], row.verifier_encrypted)).payload.verifier
    : null;
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(row.settings_json) as Record<string, unknown>; } catch { /* validated at persistence */ }
  const adapter = oauthTokenAdapter(job.provider, settings, decrypted.payload);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: job.authorizationCode,
    redirect_uri: row.callback_uri,
    client_id: String(decrypted.payload.client_id || decrypted.payload.client_key || ''),
    ...(adapter.includeSecret
      ? { client_secret: String(decrypted.payload.client_secret || '') }
      : {}),
    ...(verifier ? { code_verifier: String(verifier) } : {}),
  });
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' });
  if (adapter.basicAuth) {
    headers.set('authorization', `Basic ${btoa(`${String(decrypted.payload.client_id || '')}:${String(decrypted.payload.client_secret || '')}`)}`);
  }
  const response = await fetch(adapter.tokenUrl, {
    method: 'POST', headers, body: form.toString(), redirect: 'manual', signal: AbortSignal.timeout(15_000),
  });
  const responseText = await readTextLimited(response, 64_000);
  let token: Record<string, unknown> = {};
  try { token = JSON.parse(responseText) as Record<string, unknown>; } catch { /* handled below */ }
  if (!response.ok || !String(token.access_token || '').trim()) {
    await env.DB.prepare(`UPDATE support_provider_endpoints SET status = 'configuration_required',
      last_error_code = 'oauth_token_exchange_failed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?`).bind(job.endpointId, job.projectId).run();
    throw failure('oauth_token_exchange_failed', 'OAuth authorization could not be completed');
  }
  const expiresIn = Number(token.expires_in || 0);
  const persisted = {
    ...decrypted.payload,
    access_token: String(token.access_token),
    ...(token.refresh_token ? { refresh_token: String(token.refresh_token) } : {}),
    ...(token.token_type ? { token_type: String(token.token_type) } : {}),
    ...(token.scope ? { scope: String(token.scope) } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0
      ? { expires_at: new Date(Date.now() + expiresIn * 1_000).toISOString() }
      : {}),
  };
  const encrypted = await encryptCredentialPayload(env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY, persisted);
  await env.DB.batch([
    env.DB.prepare(`UPDATE support_provider_credentials SET encrypted_payload = ?,
      credential_version = credential_version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE endpoint_id = ? AND project_id = ?`).bind(encrypted, job.endpointId, job.projectId),
    env.DB.prepare(`UPDATE support_provider_endpoints SET status = 'validated',
      last_validated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error_code = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?`).bind(job.endpointId, job.projectId),
  ]);
}

async function retryProviderMessage(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.message.retry.v1' }>,
) {
  const delivery = await env.DB.prepare(`
    UPDATE support_provider_deliveries SET status = 'queued', last_error = NULL,
      next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND conversation_id = ? AND message_id = ?
    RETURNING id
  `).bind(job.projectId, job.conversationId, job.messageId).first<{ id: string }>();
  if (!delivery) throw failure('message_delivery_not_found', 'Message delivery was not found');
  await env.SUPPORT_QUEUE.send({
    type: 'support.provider.delivery.send.v1',
    projectId: job.projectId,
    deliveryId: delivery.id,
  }, { contentType: 'json' });
}

async function sendProviderDelivery(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.provider.delivery.send.v1' }>,
) {
  const terminal = await env.DB.prepare(`
    SELECT id, endpoint_id, conversation_id, message_id, idempotency_key, request_json,
      status, provider_reference
    FROM support_provider_deliveries
    WHERE id = ? AND project_id = ? AND status IN ('sent', 'delivered', 'read', 'cancelled')
  `).bind(job.deliveryId, job.projectId).first<ProviderDeliveryRecord>();
  if (terminal) {
    await syncCampaignDelivery(env.DB, job.projectId, terminal, terminal.status, null);
    return;
  }
  const delivery = await env.DB.prepare(`
    UPDATE support_provider_deliveries SET status = 'sending', attempt_count = attempt_count + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND (
      status IN ('queued', 'failed')
      OR (status = 'sending' AND julianday(updated_at) <= julianday('now', '-5 minutes'))
    )
    RETURNING id, endpoint_id, conversation_id, message_id, idempotency_key, request_json,
      status, provider_reference
  `).bind(job.deliveryId, job.projectId).first<ProviderDeliveryRecord>();
  if (!delivery) {
    const pending = await env.DB.prepare(`
      SELECT status FROM support_provider_deliveries WHERE id = ? AND project_id = ?
    `).bind(job.deliveryId, job.projectId).first<{ status: string }>();
    if (pending?.status === 'sending') {
      throw failure('provider_delivery_in_progress', 'Provider delivery is already in progress', 503);
    }
    return;
  }
  await env.DB.prepare(`
    UPDATE support_campaign_deliveries SET status = 'sending',
      attempt_count = attempt_count + 1, last_error = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND endpoint_id = ? AND idempotency_key = ?
      AND status IN ('queued', 'sending', 'failed')
  `).bind(job.projectId, delivery.endpoint_id, delivery.idempotency_key).run();
  const endpoint = await env.DB.prepare(`
    SELECT endpoint.provider, endpoint.settings_json, credential.encrypted_payload,
      credential.credential_version, conversation.external_user_id, conversation.subject
    FROM support_provider_endpoints endpoint
    INNER JOIN support_provider_credentials credential ON credential.endpoint_id = endpoint.id
    INNER JOIN conversations conversation ON conversation.id = ? AND conversation.project_id = endpoint.project_id
    WHERE endpoint.id = ? AND endpoint.project_id = ?
      AND endpoint.status IN ('configured', 'validated', 'live_validated', 'degraded')
  `).bind(delivery.conversation_id, delivery.endpoint_id, job.projectId).first<{
    provider: string; settings_json: string; encrypted_payload: string;
    credential_version: number;
    external_user_id: string; subject: string | null;
  }>();
  if (!endpoint) {
    await failProviderDelivery(env, job.projectId, delivery, 'configuration_required', true);
    throw failure('configuration_required', 'Provider credentials are not configured', 422);
  }
  const decrypted = await decryptCredentialPayload([
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], endpoint.encrypted_payload);
  const settings = parseRecord(endpoint.settings_json);
  const request = parseRecord(delivery.request_json);
  let response: Response;
  try {
    const credentials = await refreshProviderCredentialsIfNeeded(env, {
      projectId: job.projectId,
      endpointId: delivery.endpoint_id,
      provider: endpoint.provider,
      settings,
      credentials: decrypted.payload,
      credentialVersion: endpoint.credential_version,
    });
    response = await outboundProviderRequest(env, {
      provider: endpoint.provider,
      projectId: job.projectId,
      deliveryId: delivery.id,
      idempotencyKey: delivery.idempotency_key,
      recipient: String(request.recipient || endpoint.external_user_id),
      subject: endpoint.subject || 'Support update',
      body: String(request.body || ''),
      settings,
      credentials,
    });
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status || 0);
    const terminalFailure = status >= 400 && status < 500 && status !== 429;
    const rawCode = String((error as { code?: unknown })?.code || 'provider_unavailable');
    const reasonCode = /^[a-z0-9_]{1,128}$/u.test(rawCode)
      ? rawCode
      : 'provider_unavailable';
    await failProviderDelivery(env, job.projectId, delivery, reasonCode, terminalFailure);
    throw error;
  }
  const responseText = await readTextLimited(response, 64_000);
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(responseText) as Record<string, unknown>; } catch { /* provider-specific plain response */ }
  const logicalFailure = providerResponseFailure(endpoint.provider, payload);
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    await failProviderDelivery(
      env,
      job.projectId,
      delivery,
      `provider_http_${response.status}`,
      !retryable,
    );
    const error = failure('provider_delivery_failed', `Provider returned HTTP ${response.status}`);
    Object.assign(error, { status: retryable ? response.status : 422 });
    throw error;
  }
  if (logicalFailure) {
    await failProviderDelivery(env, job.projectId, delivery, logicalFailure.code, true);
    throw failure('provider_delivery_failed', logicalFailure.message, 422);
  }
  const providerReference = providerReferenceFrom(payload);
  await env.DB.prepare(`
    UPDATE support_provider_deliveries SET response_status = ?, provider_reference = ?,
      last_error = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
  `).bind(response.status, providerReference, delivery.id).run();
  await env.DB.prepare(`
    UPDATE messages SET provider_message_id = ?, failure_reason = NULL WHERE id = ? AND conversation_id = ?
  `).bind(providerReference, delivery.message_id, delivery.conversation_id).run();
  if (providerOutboundValidatesLive(endpoint.provider, payload)) {
    await env.DB.prepare(`
      UPDATE support_provider_endpoints SET status = 'live_validated',
        last_validated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error_code = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?
        AND status IN ('configured', 'validated', 'live_validated', 'degraded')
    `).bind(delivery.endpoint_id, job.projectId).run();
  }
  await roomJson(
    env,
    delivery.conversation_id,
    { kind: 'system', id: `provider:${endpoint.provider}`.slice(0, 255) },
    `/messages/${encodeURIComponent(delivery.message_id)}/delivery`,
    { delivery_id: delivery.id, status: 'sent' },
    'PATCH',
  );
  await syncCampaignDelivery(
    env.DB,
    job.projectId,
    { ...delivery, provider_reference: providerReference },
    'sent',
    null,
  );
}

type ProviderDeliveryRecord = {
  id: string;
  endpoint_id: string;
  conversation_id: string;
  message_id: string;
  idempotency_key: string;
  request_json: string;
  status: string;
  provider_reference?: string | null;
};

export async function outboundProviderRequest(
  env: Env,
  input: {
    provider: string;
    projectId: number;
    deliveryId: string;
    idempotencyKey: string;
    recipient: string;
    subject: string;
    body: string;
    settings: Record<string, unknown>;
    credentials: Record<string, unknown>;
  },
) {
  const signal = AbortSignal.timeout(15_000);
  if (['email_google', 'email_microsoft'].includes(input.provider)) {
    configurationValue(input.credentials.access_token, 'OAuth authorization is required before sending email');
    return env.EMAIL_SERVICE.fetch('https://email.internal/internal/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': env.EMAIL_INTERNAL_TOKEN },
      body: JSON.stringify({
        kind: 'transactional', to: input.recipient, subject: input.subject,
        text: input.body, idempotencyKey: input.idempotencyKey,
        projectId: input.projectId, templateKey: 'support.conversation.message',
        metadata: { source: 'support', delivery_id: input.deliveryId },
      }),
      signal,
    });
  }
  if (input.provider === 'smtp') {
    return env.EMAIL_SERVICE.fetch('https://email.internal/internal/v1/transport/smtp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': env.EMAIL_INTERNAL_TOKEN },
      body: JSON.stringify({
        idempotencyKey: input.idempotencyKey,
        source: 'support', projectId: input.projectId, referenceId: input.deliveryId,
        profileId: String(input.settings.profile_id || input.deliveryId),
        publicConfig: {
          host: String(input.credentials.host || ''), port: Number(input.credentials.port || 587),
          security: String(input.credentials.security || 'starttls'),
          username: input.credentials.username ? String(input.credentials.username) : null,
          from_email: String(input.credentials.from_email || ''),
          from_name: input.credentials.from_name ? String(input.credentials.from_name) : null,
          reply_to: input.credentials.reply_to ? String(input.credentials.reply_to) : null,
        },
        secret: { password: input.credentials.password ? String(input.credentials.password) : null },
        message: { to: input.recipient, subject: input.subject, text: input.body, html: null },
      }),
      signal,
    });
  }
  if (input.provider === 'telegram') {
    const botToken = configurationValue(input.credentials.bot_token, 'Messaging credentials are incomplete');
    return fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: input.recipient, text: input.body }), signal,
    });
  }
  if (input.provider === 'whatsapp_cloud') {
    const sourceId = providerObjectId(
      input.settings.phone_number_id || input.settings.source_id || input.credentials.phone_number_id,
    );
    const accessToken = configurationValue(input.credentials.access_token, 'Messaging credentials are incomplete');
    const recipient = phoneRecipient(input.recipient);
    return fetch(`https://graph.facebook.com/v22.0/${sourceId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: recipient, type: 'text', text: { body: input.body },
      }),
      signal,
    });
  }
  if (input.provider === 'facebook_messenger') {
    const pageId = providerObjectId(input.settings.page_id || input.settings.source_id || input.credentials.page_id);
    const accessToken = configurationValue(
      input.credentials.page_access_token || input.credentials.access_token,
      'Messaging credentials are incomplete',
    );
    return fetch(`https://graph.facebook.com/v22.0/${pageId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        recipient: { id: providerObjectId(input.recipient) },
        messaging_type: 'RESPONSE',
        message: { text: input.body },
      }),
      signal,
    });
  }
  if (input.provider === 'instagram') {
    const accountId = providerObjectId(
      input.settings.instagram_id || input.settings.source_id || input.credentials.instagram_id,
    );
    const accessToken = configurationValue(
      input.credentials.access_token || input.credentials.page_access_token,
      'Messaging credentials are incomplete',
    );
    return fetch(`https://graph.facebook.com/v22.0/${accountId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        recipient: { id: providerObjectId(input.recipient) },
        message: { text: input.body },
      }),
      signal,
    });
  }
  if (input.provider === 'line') {
    const accessToken = configurationValue(input.credentials.channel_access_token, 'Messaging credentials are incomplete');
    return fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to: input.recipient, messages: [{ type: 'text', text: input.body }] }), signal,
    });
  }
  if (input.provider === 'slack') {
    const accessToken = configurationValue(
      input.credentials.access_token || input.credentials.bot_token,
      'Messaging credentials are incomplete',
    );
    return fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ channel: input.recipient, text: input.body }), signal,
    });
  }
  if (input.provider === 'twilio_sms') {
    const accountSid = twilioAccountSid(input.credentials.account_sid);
    const authToken = configurationValue(input.credentials.auth_token, 'Telephony credentials are incomplete');
    const from = configurationValue(input.settings.from_number || input.credentials.from_number, 'A sending number is required');
    const form = new URLSearchParams({ To: input.recipient, From: from, Body: input.body });
    return fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` },
      body: form.toString(), signal,
    });
  }
  if (input.provider === 'twilio_voice') {
    const accountSid = twilioAccountSid(input.credentials.account_sid);
    const authToken = configurationValue(input.credentials.auth_token, 'Telephony credentials are incomplete');
    const from = configurationValue(input.settings.from_number || input.credentials.from_number, 'A calling number is required');
    const form = new URLSearchParams({
      To: configurationValue(input.recipient, 'A call recipient is required'),
      From: from,
      Twiml: `<Response><Say>${xmlText(input.body)}</Say></Response>`,
    });
    const callback = configurationValue(
      input.settings.status_callback_url || input.credentials.status_callback_url,
      'A call status callback is required before outbound calling can be enabled',
    );
    if (!isSafePublicHttpsUrl(callback)) {
      throw failure('configuration_required', 'The call status callback configuration is invalid', 422);
    }
    form.set('StatusCallback', callback);
    form.set('StatusCallbackMethod', 'POST');
    const configuredEvents = Array.isArray(input.settings.status_callback_events)
      ? input.settings.status_callback_events.map(String)
      : ['initiated', 'ringing', 'answered', 'completed'];
    const events = [...new Set(configuredEvents)].filter((event) =>
      ['initiated', 'ringing', 'answered', 'completed'].includes(event));
    if (events.length === 0 || events.length !== configuredEvents.length) {
      throw failure('configuration_required', 'The call status callback configuration is invalid', 422);
    }
    for (const event of events) form.append('StatusCallbackEvent', event);
    return fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      },
      body: form.toString(),
      signal,
    });
  }
  if (input.provider === 'twitter') {
    const accessToken = configurationValue(input.credentials.access_token, 'OAuth authorization is required before sending messages');
    const recipient = providerObjectId(input.recipient);
    return fetch(`https://api.x.com/2/dm_conversations/with/${recipient}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ text: input.body }),
      signal,
    });
  }
  if (input.provider === 'whatsapp_calls' || input.provider === 'tiktok') {
    throw failure(
      'configuration_required',
      'This Support channel requires an approved provider messaging contract before outbound delivery can be enabled',
      422,
    );
  }
  throw Object.assign(failure('configuration_required', 'Outbound adapter is not configured for this Support provider'), { status: 422 });
}

type OAuthRefreshInput = {
  projectId: number;
  endpointId: string;
  provider: string;
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
  credentialVersion: number;
};

export function providerOAuthRefreshRequest(
  provider: string,
  settings: Record<string, unknown>,
  credentials: Record<string, unknown>,
) {
  if (!['email_google', 'email_microsoft', 'slack', 'twitter'].includes(provider)) {
    throw failure('configuration_required', 'OAuth authorization must be renewed before delivery', 422);
  }
  const refreshToken = configurationValue(
    credentials.refresh_token,
    'OAuth authorization must be renewed before delivery',
  );
  const clientId = configurationValue(
    credentials.client_id || credentials.client_key,
    'OAuth client configuration is incomplete',
  );
  const clientSecret = configurationValue(
    credentials.client_secret,
    'OAuth client configuration is incomplete',
  );
  const adapter = oauthTokenAdapter(provider, settings, credentials);
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  });
  if (provider === 'twitter') {
    headers.set('authorization', `Basic ${btoa(`${clientId}:${clientSecret}`)}`);
  } else {
    form.set('client_id', clientId);
    form.set('client_secret', clientSecret);
  }
  return { tokenUrl: adapter.tokenUrl, headers, body: form.toString() };
}

export async function refreshProviderCredentialsIfNeeded(
  env: Pick<Env, 'DB' | 'SUPPORT_CREDENTIAL_ENCRYPTION_KEY' | 'SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS'>,
  input: OAuthRefreshInput,
  now = Date.now(),
) {
  const expiresAt = input.credentials.expires_at;
  if (expiresAt == null || String(expiresAt).trim() === '') return input.credentials;
  const expiry = Date.parse(String(expiresAt));
  if (!Number.isFinite(expiry)) {
    await markProviderAuthorizationRequired(env.DB, input, 'oauth_expiry_invalid');
    throw failure('configuration_required', 'OAuth authorization must be renewed before delivery', 422);
  }
  if (expiry - now > 5 * 60_000) return input.credentials;

  let refresh: ReturnType<typeof providerOAuthRefreshRequest>;
  try {
    refresh = providerOAuthRefreshRequest(input.provider, input.settings, input.credentials);
  } catch (error) {
    await markProviderAuthorizationRequired(env.DB, input, 'oauth_refresh_required');
    throw error;
  }
  let response: Response;
  try {
    response = await fetch(refresh.tokenUrl, {
      method: 'POST',
      headers: refresh.headers,
      body: refresh.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw failure('oauth_refresh_unavailable', 'OAuth authorization could not be refreshed', 503);
  }
  const responseText = await readTextLimited(response, 64_000);
  let token: Record<string, unknown> = {};
  try { token = JSON.parse(responseText) as Record<string, unknown>; } catch { /* normalized below */ }
  const slackFailure = input.provider === 'slack' && token.ok === false;
  if (!response.ok || slackFailure || !String(token.access_token || '').trim()) {
    if (response.status === 429 || response.status >= 500) {
      throw failure('oauth_refresh_unavailable', 'OAuth authorization could not be refreshed', response.status);
    }
    const concurrentlyRefreshed = await providerCredentialsAfterVersionChange(env, input);
    if (concurrentlyRefreshed) return concurrentlyRefreshed;
    await markProviderAuthorizationRequired(env.DB, input, 'oauth_refresh_failed');
    throw failure('configuration_required', 'OAuth authorization must be renewed before delivery', 422);
  }

  const current = { ...input.credentials };
  delete current.expires_at;
  const expiresIn = Number(token.expires_in || 0);
  const persisted: Record<string, unknown> = {
    ...current,
    access_token: String(token.access_token),
    ...(token.refresh_token ? { refresh_token: String(token.refresh_token) } : {}),
    ...(token.token_type ? { token_type: String(token.token_type) } : {}),
    ...(token.scope ? { scope: String(token.scope) } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0
      ? { expires_at: new Date(now + expiresIn * 1_000).toISOString() }
      : {}),
  };
  const encrypted = await encryptCredentialPayload(env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY, persisted);
  const updated = await env.DB.prepare(`
    UPDATE support_provider_credentials SET encrypted_payload = ?,
      credential_version = credential_version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE endpoint_id = ? AND project_id = ? AND credential_version = ?
  `).bind(encrypted, input.endpointId, input.projectId, input.credentialVersion).run();
  if (Number(updated.meta.changes || 0) === 0) {
    const currentCredentials = await providerCredentialsAfterVersionChange(env, input, false);
    if (!currentCredentials) {
      throw failure('configuration_required', 'Provider credentials are not configured', 422);
    }
    return currentCredentials;
  }
  await env.DB.prepare(`
    UPDATE support_provider_endpoints SET
      status = CASE WHEN status IN ('configuration_required', 'configured') THEN 'validated' ELSE status END,
      last_error_code = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND status <> 'disabled'
  `).bind(input.endpointId, input.projectId).run();
  return persisted;
}

async function providerCredentialsAfterVersionChange(
  env: Pick<Env, 'DB' | 'SUPPORT_CREDENTIAL_ENCRYPTION_KEY' | 'SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS'>,
  input: Pick<OAuthRefreshInput, 'projectId' | 'endpointId' | 'credentialVersion'>,
  requireChange = true,
) {
  const currentRow = await env.DB.prepare(`
    SELECT encrypted_payload, credential_version FROM support_provider_credentials
    WHERE endpoint_id = ? AND project_id = ?
  `).bind(input.endpointId, input.projectId).first<{
    encrypted_payload: string;
    credential_version: number;
  }>();
  if (!currentRow || (requireChange && currentRow.credential_version === input.credentialVersion)) return null;
  return (await decryptCredentialPayload([
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], currentRow.encrypted_payload)).payload;
}

async function markProviderAuthorizationRequired(
  db: D1Database,
  input: Pick<OAuthRefreshInput, 'projectId' | 'endpointId'>,
  errorCode: string,
) {
  await db.prepare(`
    UPDATE support_provider_endpoints SET status = 'configuration_required', last_error_code = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND status <> 'disabled'
  `).bind(errorCode, input.endpointId, input.projectId).run();
}

function configurationValue(value: unknown, message: string) {
  const resolved = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  if (!resolved || resolved.length > 16_384) {
    throw failure('configuration_required', message, 422);
  }
  return resolved;
}

function providerObjectId(value: unknown) {
  const resolved = configurationValue(value, 'A provider account or recipient identifier is required');
  if (!/^[1-9][0-9]{0,31}$/u.test(resolved)) {
    throw failure('configuration_required', 'A provider account or recipient identifier is invalid', 422);
  }
  return resolved;
}

function phoneRecipient(value: unknown) {
  const resolved = configurationValue(value, 'A messaging recipient is required')
    .replace(/[\s()+.-]/gu, '');
  if (!/^[0-9]{5,20}$/u.test(resolved)) {
    throw failure('configuration_required', 'A messaging recipient is invalid', 422);
  }
  return resolved;
}

function twilioAccountSid(value: unknown) {
  const resolved = configurationValue(value, 'Telephony credentials are incomplete');
  if (!/^AC[0-9a-f]{32}$/iu.test(resolved)) {
    throw failure('configuration_required', 'Telephony credentials are invalid', 422);
  }
  return resolved;
}

function xmlText(value: unknown) {
  return String(value || '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

async function failProviderDelivery(
  env: Env,
  projectId: number,
  delivery: ProviderDeliveryRecord,
  reasonCode: string,
  terminal: boolean,
) {
  const reason = reasonCode.slice(0, 255);
  await env.DB.prepare(`UPDATE support_provider_deliveries SET status = 'failed', last_error = ?,
    next_attempt_at = CASE WHEN ? = 1 THEN NULL ELSE datetime('now', '+5 minutes') END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ?`).bind(reason, terminal ? 1 : 0, delivery.id, projectId).run();
  if (!terminal) return;
  try {
    await roomJson(
      env,
      delivery.conversation_id,
      { kind: 'system', id: 'provider:delivery' },
      `/messages/${encodeURIComponent(delivery.message_id)}/delivery`,
      { delivery_id: delivery.id, status: 'failed', reason_code: reason },
      'PATCH',
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: 'support_delivery_failure_publication_failed',
      delivery_id: delivery.id,
      error: error instanceof Error ? error.message : String(error),
    }));
    await env.DB.prepare(`
      UPDATE messages SET delivery_status = 'failed', failure_reason = ?
      WHERE id = ? AND conversation_id = ?
    `).bind(reason, delivery.message_id, delivery.conversation_id).run();
  }
  await syncCampaignDelivery(env.DB, projectId, delivery, 'failed', reason);
}

async function syncCampaignDelivery(
  db: D1Database,
  projectId: number,
  delivery: Pick<ProviderDeliveryRecord, 'endpoint_id' | 'idempotency_key' | 'provider_reference'>,
  status: string,
  lastError: string | null,
) {
  const campaign = await db.prepare(`
    UPDATE support_campaign_deliveries SET status = ?, provider_reference = COALESCE(?, provider_reference),
      last_error = ?,
      sent_at = CASE WHEN ? IN ('sent', 'delivered', 'read')
        THEN COALESCE(sent_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE sent_at END,
      delivered_at = CASE WHEN ? IN ('delivered', 'read')
        THEN COALESCE(delivered_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE delivered_at END,
      read_at = CASE WHEN ? = 'read'
        THEN COALESCE(read_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE read_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND endpoint_id = ? AND idempotency_key = ?
    RETURNING campaign_id
  `).bind(
    status,
    delivery.provider_reference || null,
    lastError,
    status,
    status,
    status,
    projectId,
    delivery.endpoint_id,
    delivery.idempotency_key,
  ).first<{ campaign_id: string }>();
  if (campaign) await reconcileCampaign(db, projectId, campaign.campaign_id);
}

async function indexKnowledge(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.knowledge.index.v1' }>,
) {
  const document = await env.DB.prepare(`
    UPDATE support_knowledge_documents SET status = 'indexing', last_error = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND source_type = ? AND source_id = ?
    RETURNING id, title, vector_namespace, chunk_count
  `).bind(job.projectId, job.sourceType, job.sourceId).first<{
    id: string; title: string; vector_namespace: string; chunk_count: number;
  }>();
  if (!document) return;
  const source = job.sourceType === 'article'
    ? await env.DB.prepare(`SELECT article.content || '\n' || COALESCE((
          SELECT group_concat(translation.title || '\n' || translation.content, '\n')
          FROM support_article_translations translation
          WHERE translation.article_id = article.id AND translation.project_id = article.project_id
            AND translation.status = 'published'
        ), '') content
        FROM support_articles article WHERE article.id = ? AND article.project_id = ? AND article.status = 'published'`)
      .bind(job.sourceId, job.projectId).first<{ content: string }>()
    : null;
  if (!source?.content) throw failure('knowledge_source_unavailable', 'Knowledge source is unavailable');
  const chunks = chunkText(source.content, 3_000).slice(0, 200);
  const records: VectorizeVector[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const values = await embedSupportText(env, chunks[index]);
    records.push({
      id: `${document.id}:${index}`,
      values,
      namespace: document.vector_namespace,
      metadata: { project_id: job.projectId, document_id: document.id, source_id: job.sourceId, chunk: index },
    });
  }
  for (let index = 0; index < records.length; index += 100) {
    await env.SUPPORT_KNOWLEDGE.upsert(records.slice(index, index + 100));
  }
  if (document.chunk_count > chunks.length) {
    const staleIds = Array.from(
      { length: document.chunk_count - chunks.length },
      (_, offset) => `${document.id}:${chunks.length + offset}`,
    );
    for (let index = 0; index < staleIds.length; index += 100) {
      await env.SUPPORT_KNOWLEDGE.deleteByIds(staleIds.slice(index, index + 100));
    }
  }
  await env.DB.prepare(`
    UPDATE support_knowledge_documents SET status = 'indexed', chunk_count = ?,
      indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
  `).bind(chunks.length, document.id, job.projectId).run();
}

async function runCaptainTask(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.captain.task.v1' }>,
) {
  const task = await env.DB.prepare(`
    UPDATE support_assistant_tasks SET status = 'running', last_error = NULL,
      started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND (
      status = 'queued' OR (
        status = 'running'
        AND julianday(started_at) <= julianday('now', '-5 minutes')
      )
    )
    RETURNING id, task_type, input_json, result_json, assistant_id, conversation_id
  `).bind(job.taskId, job.projectId).first<{
    id: string; task_type: string; input_json: string; result_json: string;
    assistant_id: string | null; conversation_id: string | null;
  }>();
  if (!task) {
    const state = await env.DB.prepare(`
      SELECT status FROM support_assistant_tasks WHERE id = ? AND project_id = ?
    `).bind(job.taskId, job.projectId).first<{ status: string }>();
    if (state?.status === 'running') {
      throw failure('captain_task_in_progress', 'Support intelligence task is already running', 503);
    }
    return;
  }
  const input = parseRecord(task.input_json);
  if (task.task_type === 'handoff') {
    if (!task.conversation_id || !task.assistant_id) {
      throw failure('captain_handoff_invalid', 'Human handoff requires an active assistant and conversation', 422);
    }
    const permitted = await env.DB.prepare(`
      SELECT assistant.id
      FROM support_assistants assistant
      INNER JOIN conversations conversation
        ON conversation.id = ? AND conversation.project_id = assistant.project_id
      WHERE assistant.id = ? AND assistant.project_id = ?
        AND assistant.active = 1 AND assistant.handoff_enabled = 1
    `).bind(task.conversation_id, task.assistant_id, job.projectId).first<{ id: string }>();
    if (!permitted) {
      throw failure('captain_handoff_disabled', 'Human handoff is not enabled for this assistant', 422);
    }
    const assigned = await env.DB.prepare(`UPDATE conversations
      SET status = 'open', assigned_user_id = NULL, snoozed_until = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ? RETURNING id`).bind(task.conversation_id, job.projectId)
      .first<{ id: string }>();
    if (!assigned) throw failure('captain_handoff_invalid', 'Human handoff conversation was not found');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_assignment_events
        (id, project_id, conversation_id, reason, payload_json)
        VALUES (?, ?, ?, 'captain_handoff', ?)`)
        .bind(crypto.randomUUID(), job.projectId, task.conversation_id,
          JSON.stringify({ assistant_id: task.assistant_id })),
      env.DB.prepare(`UPDATE support_assistant_tasks
        SET status = 'cancelled', last_error = 'human_handoff',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ? AND conversation_id = ? AND assistant_id = ?
          AND id <> ? AND task_type = 'suggest_reply'
          AND status IN ('queued', 'running')
          AND json_extract(input_json, '$.automatic_trigger') = 1`)
        .bind(job.projectId, task.conversation_id, task.assistant_id, task.id),
      env.DB.prepare(`UPDATE support_assistant_tasks SET status = 'completed', result_json = ?,
        completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?`)
        .bind(JSON.stringify({ handoff: true, conversation_id: task.conversation_id }), task.id, job.projectId),
    ]);
    await publishSupportEvent(
      env,
      job.projectId,
      `captain.handoff:${task.id}`,
      'assignment.updated',
      {
        conversation_id: task.conversation_id,
        assistant_id: task.assistant_id,
        reason: 'human_handoff',
      },
    );
    return;
  }
  if (task.task_type === 'run_tool') {
    if (!task.assistant_id) throw failure('captain_tool_invalid', 'Tool execution requires an assistant');
    const toolId = String(input.tool_id || '');
    const argumentsValue = asObject(input.arguments);
    const tool = await env.DB.prepare(`SELECT id, endpoint_url, method, input_schema_json, headers_json
      FROM support_assistant_tools WHERE id = ? AND project_id = ? AND assistant_id = ? AND allowed = 1`)
      .bind(toolId, job.projectId, task.assistant_id).first<{
        id: string; endpoint_url: string; method: 'GET' | 'POST';
        input_schema_json: string; headers_json: string;
      }>();
    if (!tool || !isSafePublicHttpsUrl(tool.endpoint_url)) {
      throw failure('captain_tool_not_allowed', 'Assistant tool is not allowlisted', 403);
    }
    validateCaptainToolInput(parseRecord(tool.input_schema_json), argumentsValue);
    const headers = parseRecord(tool.headers_json);
    if (Object.keys(headers).some((name) => !['accept', 'content-type'].includes(name.toLowerCase()))) {
      throw failure('captain_tool_headers_invalid', 'Assistant tool headers are invalid');
    }
    const target = new URL(tool.endpoint_url);
    if (tool.method === 'GET') target.searchParams.set('input', JSON.stringify(argumentsValue));
    let response: Response;
    try {
      response = await fetch(target, {
        method: tool.method,
        headers: {
          accept: String(headers.accept || 'application/json'),
          ...(tool.method === 'POST' ? { 'content-type': String(headers['content-type'] || 'application/json') } : {}),
          'x-superboard-task-id': task.id,
        },
        body: tool.method === 'POST' ? JSON.stringify(argumentsValue) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw failure('captain_tool_unavailable', 'Assistant tool is temporarily unavailable');
    }
    const resultText = await readTextLimited(response, 64_000);
    if (!response.ok) throw failure('captain_tool_failed', `Assistant tool returned HTTP ${response.status}`);
    let toolResult: unknown = resultText;
    try { toolResult = JSON.parse(resultText); } catch { /* bounded text result */ }
    await env.DB.prepare(`UPDATE support_assistant_tasks SET status = 'completed', result_json = ?,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?`)
      .bind(JSON.stringify({ tool_id: tool.id, output: toolResult }), task.id, job.projectId).run();
    return;
  }
  const assistant = task.assistant_id
    ? await env.DB.prepare(`SELECT instructions, response_mode, handoff_enabled FROM support_assistants
        WHERE id = ? AND project_id = ? AND active = 1`).bind(task.assistant_id, job.projectId)
      .first<{ instructions: string; response_mode: string; handoff_enabled: number }>()
    : null;
  if (isAutomaticCaptainTrigger(input) && !assistant) {
    throw failure('captain_assistant_unavailable', 'Automatic Support assistant is not active', 422);
  }
  const conversation = task.conversation_id
    ? await captainConversationContext(env.DB, job.projectId, task.conversation_id)
    : null;
  let resultPayload = parseRecord(task.result_json);
  if (typeof resultPayload.text !== 'string' || !resultPayload.text) {
    const query = captainKnowledgeQuery(input, conversation);
    let sources: Awaited<ReturnType<typeof supportKnowledgeContext>> = [];
    try {
      sources = await supportKnowledgeContext(env, job.projectId, query, 5);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'support_captain_knowledge_degraded', project_id: job.projectId, task_id: task.id,
        error_code: captainErrorCode(error, 'knowledge_query_unavailable'),
      }));
    }
    const scenarios = task.assistant_id
      ? await env.DB.prepare(`SELECT name, instructions FROM support_assistant_scenarios
          WHERE project_id = ? AND assistant_id = ? AND active = 1 ORDER BY position, created_at LIMIT 20`)
        .bind(job.projectId, task.assistant_id).all<{ name: string; instructions: string }>()
      : { results: [] as Array<{ name: string; instructions: string }> };
    const tools = task.assistant_id
      ? await env.DB.prepare(`SELECT id, name, description, method, input_schema_json FROM support_assistant_tools
          WHERE project_id = ? AND assistant_id = ? AND allowed = 1 ORDER BY created_at LIMIT 20`)
        .bind(job.projectId, task.assistant_id).all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    const prompt = boundedPrompt({
      request: input,
      conversation,
      sources: sources.map((source) => ({ id: source.id, title: source.title, excerpt: source.excerpt })),
      scenarios: scenarios.results,
      allowed_tools: tools.results.map((tool) => ({
        id: tool.id, name: tool.name, description: tool.description, method: tool.method,
        input_schema: parseRecord(String(tool.input_schema_json || '{}')),
      })),
      handoff_available: assistant?.handoff_enabled === 1,
    }, task.task_type);
    const response = await env.AI.run(env.SUPPORT_GENERATION_MODEL as Parameters<Ai['run']>[0], {
      messages: [
        { role: 'system', content: `${assistant?.instructions || 'Return a concise, factual Support result.'}\nUse only the supplied sources and conversation context. Do not claim that an external tool was executed. Cite source IDs when relevant.` },
        { role: 'user', content: prompt },
      ],
    }) as { response?: string };
    const result = String(response.response || '').slice(0, 64_000);
    if (!result) throw failure('captain_result_invalid', 'Support intelligence result is invalid');
    resultPayload = {
      text: result,
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
        slug: source.slug,
        score: source.score,
      })),
      allowed_tools: tools.results.map((tool) => ({ id: tool.id, name: tool.name })),
      response_mode: assistant?.response_mode || 'suggestion',
    };
    // Cache the generated result before any downstream delivery. A retry then
    // reuses byte-identical content and the room's client_message_id remains
    // a true idempotency key even if generation is non-deterministic.
    await env.DB.prepare(`
      UPDATE support_assistant_tasks SET result_json = ?, last_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ? AND status = 'running'
    `).bind(JSON.stringify(resultPayload), task.id, job.projectId).run();
  }

  if (
    task.task_type === 'suggest_reply' &&
    task.assistant_id &&
    task.conversation_id &&
    isAutomaticCaptainTrigger(input)
  ) {
    const authorization = await automaticCaptainAuthorization(
      env.DB,
      job.projectId,
      task.assistant_id,
      task.conversation_id,
    );
    if (canAutomaticallyDeliverCaptainResult(authorization)) {
      const sourceTrace = captainSourceTrace(resultPayload.sources);
      const delivered = await roomJson(
        env,
        task.conversation_id,
        { kind: 'system', id: `captain:${task.assistant_id}`.slice(0, 255) },
        '/messages',
        {
          body: String(resultPayload.text),
          client_message_id: `captain:${task.id}`,
          visibility: 'public',
          content_type: 'text',
          metadata: {
            captain_task_id: task.id,
            assistant_id: task.assistant_id,
            source_message_id: input.source_message_id,
            sources: sourceTrace,
            delivery_pending: Number(authorization?.outbound_endpoints || 0) > 0,
          },
        },
      );
      resultPayload = {
        ...resultPayload,
        automatic_delivery: {
          status: 'sent',
          message_id: String(asObject(delivered.data).id || ''),
        },
      };
    } else {
      resultPayload = {
        ...resultPayload,
        automatic_delivery: { status: 'not_sent' },
      };
    }
  }

  await env.DB.prepare(`
    UPDATE support_assistant_tasks SET status = 'completed', result_json = ?,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND status = 'running'
  `).bind(JSON.stringify(resultPayload), task.id, job.projectId).run();
}

async function dispatchCampaign(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.campaign.dispatch.v1' }>,
) {
  const campaign = await env.DB.prepare(`
    SELECT id, inbox_id, name, message, audience_json FROM support_campaigns
    WHERE id = ? AND project_id = ? AND status IN ('scheduled', 'running')
      AND (status = 'running' OR scheduled_at IS NULL
        OR scheduled_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).bind(job.campaignId, job.projectId).first<{
    id: string; inbox_id: string; name: string; message: string; audience_json: string;
  }>();
  if (!campaign) return;
  const audience = JSON.parse(campaign.audience_json) as Record<string, unknown>;
  const externalUser = typeof audience.external_user_id === 'string' ? audience.external_user_id : null;
  const contacts = externalUser
    ? await env.DB.prepare(`
        SELECT contact.id, contact.external_user_id, contact.email, contact.phone,
          (SELECT relation.source_id FROM support_contact_inboxes relation
           WHERE relation.project_id = contact.project_id AND relation.contact_id = contact.id
             AND relation.inbox_id = ? ORDER BY relation.updated_at DESC LIMIT 1) source_id
        FROM support_contacts contact
        WHERE contact.project_id = ? AND contact.external_user_id = ? AND contact.blocked = 0 LIMIT 1000
      `).bind(campaign.inbox_id, job.projectId, externalUser).all<CampaignContact>()
    : await env.DB.prepare(`
        SELECT contact.id, contact.external_user_id, contact.email, contact.phone,
          (SELECT relation.source_id FROM support_contact_inboxes relation
           WHERE relation.project_id = contact.project_id AND relation.contact_id = contact.id
             AND relation.inbox_id = ? ORDER BY relation.updated_at DESC LIMIT 1) source_id
        FROM support_contacts contact
        WHERE contact.project_id = ? AND contact.blocked = 0
        ORDER BY contact.created_at, contact.id LIMIT 1000
      `).bind(campaign.inbox_id, job.projectId).all<CampaignContact>();
  await env.DB.prepare(`
    UPDATE support_campaigns SET status = 'running', started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
  `).bind(campaign.id, job.projectId).run();
  if (!contacts.results.length) {
    await env.DB.prepare(`
      UPDATE support_campaigns SET status = 'completed',
        completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ? AND status = 'running'
    `).bind(campaign.id, job.projectId).run();
    return;
  }
  const endpoint = await env.DB.prepare(`
    SELECT endpoint.id, endpoint.provider
    FROM support_provider_endpoints endpoint
    INNER JOIN support_provider_credentials credential
      ON credential.endpoint_id = endpoint.id AND credential.project_id = endpoint.project_id
    WHERE endpoint.project_id = ? AND endpoint.inbox_id = ?
      AND endpoint.status IN ('configured', 'validated', 'live_validated')
      AND endpoint.provider NOT IN ('widget', 'api')
    ORDER BY CASE endpoint.status WHEN 'live_validated' THEN 0 WHEN 'validated' THEN 1 ELSE 2 END,
      endpoint.created_at, endpoint.id LIMIT 1
  `).bind(job.projectId, campaign.inbox_id).first<{ id: string; provider: string }>();
  if (!endpoint) {
    for (const contact of contacts.results) {
      const idempotencyKey = `${campaign.id}:${contact.id}`;
      await env.DB.prepare(`
        INSERT INTO support_campaign_deliveries
          (id, project_id, campaign_id, contact_id, idempotency_key, status, last_error)
        VALUES (?, ?, ?, ?, ?, 'failed', 'configuration_required')
        ON CONFLICT(campaign_id, idempotency_key) DO UPDATE SET
          status = 'failed', last_error = 'configuration_required',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `).bind(crypto.randomUUID(), job.projectId, campaign.id, contact.id, idempotencyKey).run();
    }
    await reconcileCampaign(env.DB, job.projectId, campaign.id);
    return;
  }
  for (const contact of contacts.results) {
    await dispatchCampaignContact(env, job.projectId, campaign, endpoint, contact);
  }
  await reconcileCampaign(env.DB, job.projectId, campaign.id);
}

type CampaignContact = {
  id: string;
  external_user_id: string;
  email: string | null;
  phone: string | null;
  source_id: string | null;
};

async function dispatchCampaignContact(
  env: Env,
  projectId: number,
  campaign: { id: string; inbox_id: string; name: string; message: string },
  endpoint: { id: string; provider: string },
  contact: CampaignContact,
) {
  const idempotencyKey = `${campaign.id}:${contact.id}`;
  const deliveryId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO support_campaign_deliveries
      (id, project_id, campaign_id, contact_id, endpoint_id, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, idempotency_key) DO NOTHING
  `).bind(deliveryId, projectId, campaign.id, contact.id, endpoint.id, idempotencyKey).run();
  const campaignDelivery = await env.DB.prepare(`
    SELECT id, status FROM support_campaign_deliveries
    WHERE project_id = ? AND campaign_id = ? AND idempotency_key = ?
  `).bind(projectId, campaign.id, idempotencyKey).first<{ id: string; status: string }>();
  if (!campaignDelivery || ['sent', 'delivered', 'read', 'cancelled'].includes(campaignDelivery.status)) return;
  const recipient = campaignRecipient(endpoint.provider, contact);
  if (!recipient) {
    await env.DB.prepare(`
      UPDATE support_campaign_deliveries SET endpoint_id = ?, status = 'failed',
        last_error = 'recipient_unavailable',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?
    `).bind(endpoint.id, campaignDelivery.id, projectId).run();
    return;
  }
  const conversation = await campaignConversation(env, projectId, campaign, contact);
  const messageResult = await roomJson(
    env,
    conversation.id,
    { kind: 'system', id: `campaign:${campaign.id}`.slice(0, 255) },
    '/messages',
    {
      body: campaign.message,
      client_message_id: `campaign:${campaign.id}:${contact.id}`.slice(0, 128),
      visibility: 'public',
      content_type: 'text',
      metadata: {
        campaign_id: campaign.id,
        campaign_delivery_id: campaignDelivery.id,
        delivery_pending: true,
      },
    },
  );
  const message = asObject(messageResult.data);
  if (!message.id) throw failure('campaign_message_failed', 'Proactive Support message could not be persisted');
  const providerDeliveryId = crypto.randomUUID();
  const inserted = await env.DB.prepare(`
    INSERT INTO support_provider_deliveries
      (id, project_id, endpoint_id, conversation_id, message_id, operation,
       idempotency_key, request_json, status)
    VALUES (?, ?, ?, ?, ?, 'campaign.message.send', ?, ?, 'queued')
    ON CONFLICT(endpoint_id, idempotency_key) DO NOTHING RETURNING id, status
  `).bind(
    providerDeliveryId,
    projectId,
    endpoint.id,
    conversation.id,
    String(message.id),
    idempotencyKey,
    JSON.stringify({
      body: campaign.message,
      recipient,
      campaign_id: campaign.id,
      campaign_delivery_id: campaignDelivery.id,
    }),
  ).first<{ id: string; status: string }>();
  const providerDelivery: { id: string; status: string } | null = inserted || await env.DB.prepare(`
    SELECT id, status FROM support_provider_deliveries
    WHERE project_id = ? AND endpoint_id = ? AND idempotency_key = ?
  `).bind(projectId, endpoint.id, idempotencyKey).first<{ id: string; status: string }>();
  if (!providerDelivery) throw failure('campaign_delivery_failed', 'Proactive Support delivery could not be persisted');
  await env.DB.prepare(`
    UPDATE support_campaign_deliveries SET conversation_id = ?, endpoint_id = ?,
      status = 'queued', last_error = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND status IN ('queued', 'sending', 'failed')
  `).bind(conversation.id, endpoint.id, campaignDelivery.id, projectId).run();
  if (!inserted && providerDelivery.status === 'failed') {
    await env.DB.prepare(`
      UPDATE support_provider_deliveries SET status = 'queued', last_error = NULL,
        next_attempt_at = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
    `).bind(providerDelivery.id, projectId).run();
  }
  if (inserted || providerDelivery.status === 'failed' || providerDelivery.status === 'queued') {
    await env.SUPPORT_QUEUE.send({
      type: 'support.provider.delivery.send.v1',
      projectId,
      deliveryId: providerDelivery.id,
    }, { contentType: 'json' });
  }
}

async function campaignConversation(
  env: Env,
  projectId: number,
  campaign: { id: string; inbox_id: string; name: string },
  contact: CampaignContact,
) {
  const existing = await env.DB.prepare(`
    SELECT id, created_at FROM conversations
    WHERE project_id = ? AND inbox_id = ? AND external_user_id = ?
    ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      updated_at DESC, id DESC LIMIT 1
  `).bind(projectId, campaign.inbox_id, contact.external_user_id)
    .first<{ id: string; created_at: string }>();
  if (existing) {
    await env.DB.prepare(`
      UPDATE conversations SET status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
        snoozed_until = NULL, resolved_at = CASE WHEN status = 'closed' THEN NULL ELSE resolved_at END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?
    `).bind(existing.id, projectId).run();
    return { ...existing, created: false };
  }
  const id = crypto.randomUUID();
  const created = await env.DB.prepare(`
    INSERT INTO conversations
      (id, project_id, external_user_id, client_conversation_id, subject, inbox_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, external_user_id, client_conversation_id) DO UPDATE SET
      status = 'open', snoozed_until = NULL, resolved_at = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    RETURNING id, created_at
  `).bind(
    id,
    projectId,
    contact.external_user_id,
    `proactive:${campaign.inbox_id}:${contact.id}`.slice(0, 128),
    campaign.name,
    campaign.inbox_id,
  ).first<{ id: string; created_at: string }>();
  if (!created) throw failure('campaign_conversation_failed', 'Proactive Support conversation could not be persisted');
  if (created.id === id) {
    await runConversationAutomations(
      env,
      projectId,
      created.id,
      'conversation_created',
      `campaign:${campaign.id}:${contact.id}:conversation_created`,
    );
    const initialized = await initializeConversationPolicies(
      env.DB,
      projectId,
      created.id,
      new Date(created.created_at),
    );
    await publishSupportEvent(
      env,
      projectId,
      `conversation.created:${created.id}`,
      'conversation.created',
      {
        conversation_id: created.id,
        inbox_id: campaign.inbox_id,
        assignment_policy_id: initialized.assignment.policyId,
        sla_policy_id: initialized.sla.policyId,
      },
    );
  }
  return { ...created, created: created.id === id };
}

function campaignRecipient(provider: string, contact: CampaignContact) {
  if (contact.source_id) return contact.source_id;
  if (['email_google', 'email_microsoft', 'smtp'].includes(provider)) return contact.email;
  if (provider.startsWith('twilio_')) return contact.phone;
  return contact.external_user_id || null;
}

async function reconcileCampaign(db: D1Database, projectId: number, campaignId: string) {
  const summary = await db.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN status IN ('queued', 'sending') THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END) succeeded
    FROM support_campaign_deliveries WHERE project_id = ? AND campaign_id = ?
  `).bind(projectId, campaignId).first<{ total: number; active: number | null; succeeded: number | null }>();
  const total = Number(summary?.total || 0);
  const active = Number(summary?.active || 0);
  const succeeded = Number(summary?.succeeded || 0);
  const status = active > 0 ? 'running' : succeeded > 0 || total === 0 ? 'completed' : 'failed';
  await db.prepare(`
    UPDATE support_campaigns SET status = ?,
      completed_at = CASE WHEN ? IN ('completed', 'failed')
        THEN COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE NULL END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND status IN ('scheduled', 'running')
  `).bind(status, status, campaignId, projectId).run();
}

async function processExport(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.export.requested.v1' }>,
) {
  const request = await env.DB.prepare(`
    UPDATE support_export_jobs SET status = 'processing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND status IN ('queued', 'processing')
    RETURNING id, resource_type
  `).bind(job.exportId, job.projectId).first<{ id: string; resource_type: string }>();
  if (!request) return;
  const rows = request.resource_type === 'reports'
    ? await env.DB.prepare('SELECT event_type, occurred_at, dimensions_json, metrics_json FROM support_report_events WHERE project_id = ? ORDER BY occurred_at DESC LIMIT 10000')
      .bind(job.projectId).all()
    : await env.DB.prepare('SELECT id, external_user_id, name, email, phone, created_at FROM support_contacts WHERE project_id = ? ORDER BY created_at DESC LIMIT 10000')
      .bind(job.projectId).all();
  const key = `exports/${job.projectId}/${job.exportId}.json`;
  await env.ATTACHMENTS.put(key, JSON.stringify({ data: rows.results }), { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare(`
    UPDATE support_export_jobs SET status = 'completed', storage_key = ?, result_json = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
  `).bind(key, JSON.stringify({ count: rows.results.length }), request.id, job.projectId).run();
}

async function processImport(
  env: Env,
  job: Extract<SupportQueueJob, { type: 'support.import.requested.v1' }>,
) {
  const request = await env.DB.prepare(`
    UPDATE support_import_jobs SET status = 'processing',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND resource_type = 'contacts'
      AND status = 'queued'
    RETURNING id, storage_key, created_by
  `).bind(job.importId, job.projectId).first<{
    id: string; storage_key: string; created_by: string;
  }>();
  if (!request) return;
  try {
    const object = await env.ATTACHMENTS.get(request.storage_key);
    if (!object) throw failure('contact_import_file_not_found', 'Contact import file was not found', 422);
    if (object.size > 10 * 1024 * 1024) {
      throw failure('contact_import_file_too_large', 'Contact import file exceeds 10 MB', 422);
    }
    const text = await object.text();
    const rows = contactImportRows(text);
    const statements: D1PreparedStatement[] = [];
    let accepted = 0;
    for (const row of rows) {
      if (!row.external_user_id) continue;
      accepted += 1;
      statements.push(env.DB.prepare(`
        INSERT INTO support_contacts
          (id, project_id, external_user_id, name, email, phone, custom_attributes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, external_user_id) DO UPDATE SET
          name = COALESCE(excluded.name, support_contacts.name),
          email = COALESCE(excluded.email, support_contacts.email),
          phone = COALESCE(excluded.phone, support_contacts.phone),
          custom_attributes_json = excluded.custom_attributes_json,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `).bind(crypto.randomUUID(), job.projectId, row.external_user_id,
        row.name, row.email, row.phone, JSON.stringify(row.custom_attributes)));
      if (statements.length === 100) {
        await env.DB.batch(statements.splice(0));
      }
    }
    if (statements.length) await env.DB.batch(statements);
    await env.DB.prepare(`
      UPDATE support_import_jobs SET status = 'completed',
        checkpoint_json = ?, result_json = ?, last_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?
    `).bind(JSON.stringify({ rows_read: rows.length }),
      JSON.stringify({ imported: accepted, skipped: rows.length - accepted }),
      request.id, job.projectId).run();
  } catch (error) {
    await env.DB.prepare(`
      UPDATE support_import_jobs SET status = 'failed', last_error = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?
    `).bind(safeImportError(error), request.id, job.projectId).run();
    throw error;
  }
}

function contactImportRows(text: string) {
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) {
    throw failure('contact_import_file_too_large', 'Contact import file exceeds 10 MB', 422);
  }
  let source: unknown;
  try {
    source = JSON.parse(text);
  } catch {
    source = csvRecords(text);
  }
  const values = Array.isArray(source)
    ? source
    : source && typeof source === 'object' && Array.isArray((source as { data?: unknown }).data)
      ? (source as { data: unknown[] }).data
      : [];
  if (!values.length || values.length > 10_000) {
    throw failure('contact_import_invalid', 'Contact import must contain between 1 and 10000 rows', 422);
  }
  return values.map((value) => {
    const row = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const external = safeCell(row.external_user_id ?? row.external_id, 255);
    const custom = row.custom_attributes && typeof row.custom_attributes === 'object'
      && !Array.isArray(row.custom_attributes)
      ? row.custom_attributes as Record<string, unknown>
      : {};
    if (JSON.stringify(custom).length > 8_000) {
      throw failure('contact_import_invalid', 'Contact custom attributes exceed 8 KB', 422);
    }
    return {
      external_user_id: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(external) ? external : '',
      name: nullableCell(row.name, 255),
      email: nullableEmailCell(row.email),
      phone: nullableCell(row.phone, 64),
      custom_attributes: custom,
    };
  });
}

function csvRecords(text: string): Record<string, string>[] {
  const table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"'; index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = ''; if (row.some((value) => value.trim())) table.push(row); row = [];
    } else cell += character;
  }
  if (quoted) throw failure('contact_import_invalid', 'Contact CSV contains an unterminated field', 422);
  row.push(cell); if (row.some((value) => value.trim())) table.push(row);
  const header = table.shift()?.map((value) => value.trim().toLowerCase()) || [];
  if (!header.includes('external_user_id') && !header.includes('external_id')) {
    throw failure('contact_import_invalid', 'Contact import requires external_user_id', 422);
  }
  return table.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index]?.trim() || ''])));
}

function safeCell(value: unknown, maximum: number) {
  const result = String(value || '').trim();
  return result.length <= maximum ? result : '';
}

function nullableCell(value: unknown, maximum: number) {
  const result = safeCell(value, maximum);
  return result || null;
}

function nullableEmailCell(value: unknown) {
  const result = safeCell(value, 320).toLowerCase();
  return !result || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result) ? result || null : null;
}

function safeImportError(error: unknown) {
  const code = String((error as { code?: unknown })?.code || 'contact_import_failed');
  return code.slice(0, 128);
}

async function evaluateSla(env: Env, projectId: number, appliedSlaId: string) {
  const result = await evaluateAppliedSla(env.DB, projectId, appliedSlaId);
  if (!result.conversationId || result.breachedTargets.length === 0) return;
  await publishSupportEvent(
    env,
    projectId,
    `sla.breached:${appliedSlaId}:${result.breachedTargets.sort().join(',')}`,
    'sla.breached',
    {
      conversation_id: result.conversationId,
      applied_sla_id: appliedSlaId,
      targets: result.breachedTargets,
      status: result.status,
    },
  );
}

async function rollupReports(db: D1Database, projectId: number, bucket: string) {
  await db.prepare(`
    INSERT INTO support_report_rollups
      (project_id, bucket_start, interval, dimension_type, dimension_value, metrics_json)
    SELECT ?, ?, 'day', 'event', event_type, json_object('count', COUNT(*))
    FROM support_report_events WHERE project_id = ? AND occurred_at >= ?
      AND occurred_at < datetime(?, '+1 day') GROUP BY event_type
    ON CONFLICT(project_id, bucket_start, interval, dimension_type, dimension_value)
    DO UPDATE SET metrics_json = excluded.metrics_json,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(projectId, bucket, projectId, bucket, bucket).run();
}

export function normalizeInboundProviderEvent(provider: string, payload: Record<string, unknown>) {
  if (['email_google', 'email_microsoft', 'smtp'].includes(provider)) {
    const from = asObject(payload.from);
    const body = asObject(payload.body);
    const thread = asObject(payload.thread);
    const text = textValue(body.text);
    const html = textValue(body.html);
    return inboundMessage({
      externalUserId: textValue(from.email),
      threadId: textValue(thread.in_reply_to || thread.message_id || payload.provider_message_id),
      messageId: textValue(payload.provider_message_id),
      messageBody: text || html,
      subject: textValue(payload.subject),
      senderName: textValue(from.name),
      senderEmail: textValue(from.email),
      attachments: Array.isArray(payload.attachments) ? payload.attachments.slice(0, 50) : [],
      authenticity: asObject(payload.authenticity),
    });
  }
  if (provider === 'telegram') {
    const message = asObject(payload.message || payload.edited_message);
    const sender = asObject(message.from);
    const chat = asObject(message.chat);
    return inboundMessage({
      externalUserId: textValue(sender.id || chat.id),
      threadId: textValue(chat.id),
      messageId: textValue(message.message_id),
      messageBody: textValue(message.text || message.caption),
      subject: textValue(sender.username || sender.first_name),
      senderName: textValue(sender.username || sender.first_name),
    });
  }
  if (provider.startsWith('twilio_')) {
    return inboundMessage({
      externalUserId: textValue(payload.From),
      threadId: textValue(payload.From),
      messageId: textValue(payload.MessageSid || payload.CallSid),
      messageBody: textValue(payload.Body || payload.SpeechResult),
    });
  }
  if (provider === 'whatsapp_cloud') {
    const entry = firstObject(payload.entry);
    const change = firstObject(entry.changes);
    const value = asObject(change.value);
    const message = firstObject(value.messages);
    const contact = firstObject(value.contacts);
    const profile = asObject(contact.profile);
    const text = asObject(message.text);
    const interactive = asObject(message.interactive);
    const buttonReply = asObject(interactive.button_reply);
    const listReply = asObject(interactive.list_reply);
    return inboundMessage({
      externalUserId: textValue(message.from || contact.wa_id),
      threadId: textValue(message.from || contact.wa_id),
      messageId: textValue(message.id),
      messageBody: textValue(
        text.body || message.caption || buttonReply.title || listReply.title,
      ),
      senderName: textValue(profile.name),
    });
  }
  if (provider === 'line') {
    const event = firstObject(payload.events);
    const source = asObject(event.source);
    const message = asObject(event.message);
    return inboundMessage({
      externalUserId: textValue(source.userId || source.groupId || source.roomId),
      threadId: textValue(source.groupId || source.roomId || source.userId),
      messageId: textValue(message.id || event.webhookEventId),
      messageBody: textValue(message.text),
    });
  }
  if (provider === 'slack') {
    const event = asObject(payload.event);
    if (event.bot_id || event.subtype === 'message_changed' || event.subtype === 'message_deleted') {
      return inboundMessage({});
    }
    return inboundMessage({
      externalUserId: textValue(event.user),
      threadId: textValue(event.thread_ts || event.channel),
      messageId: textValue(event.client_msg_id || event.ts),
      messageBody: textValue(event.text),
    });
  }
  if (provider === 'twitter') {
    const event = firstObject(payload.direct_message_events);
    const create = asObject(event.message_create);
    const target = asObject(create.target);
    const data = asObject(create.message_data);
    return inboundMessage({
      externalUserId: textValue(create.sender_id),
      threadId: textValue(target.recipient_id || create.sender_id),
      messageId: textValue(event.id),
      messageBody: textValue(data.text),
    });
  }
  const entry = firstObject(payload.entry);
  const messaging = firstObject(entry.messaging);
  const sender = asObject(messaging.sender);
  const message = asObject(messaging.message);
  return inboundMessage({
    externalUserId: textValue(payload.external_user_id || sender.id || payload.user_id || payload.from),
    threadId: textValue(payload.thread_id || sender.id || entry.id || payload.chat_id),
    messageId: textValue(payload.message_id || message.mid || payload.id),
    messageBody: textValue(
      typeof payload.message === 'string' ? payload.message : payload.text || message.text || payload.body,
    ),
    subject: textValue(payload.subject),
  });
}

export function normalizeProviderDeliveryReceipts(
  provider: string,
  payload: Record<string, unknown>,
): ProviderDeliveryReceipt[] {
  const receipts: ProviderDeliveryReceipt[] = [];
  const add = (
    reference: unknown,
    rawStatus: unknown,
    rawReason?: unknown,
    rawDeliveryId?: unknown,
  ) => {
    const providerReference = textValue(reference)?.trim().slice(0, 255) || '';
    const deliveryId = textValue(rawDeliveryId)?.trim().slice(0, 255) || '';
    const status = normalizeProviderDeliveryStatus(rawStatus);
    if ((!providerReference && !deliveryId) || !status) return;
    const reason = textValue(rawReason)?.trim().slice(0, 255);
    receipts.push({
      ...(providerReference ? { providerReference } : {}),
      ...(deliveryId ? { deliveryId } : {}),
      status,
      ...(status === 'failed' && reason ? { reasonCode: reason } : {}),
    });
  };

  if (provider === 'whatsapp_cloud') {
    for (const rawEntry of arrayValues(payload.entry).slice(0, 50)) {
      for (const rawChange of arrayValues(asObject(rawEntry).changes).slice(0, 50)) {
        const value = asObject(asObject(rawChange).value);
        for (const rawStatus of arrayValues(value.statuses).slice(0, 50)) {
          const status = asObject(rawStatus);
          const error = firstObject(status.errors);
          add(status.id, status.status, error.code || error.title || error.message);
        }
      }
    }
  } else if (provider === 'facebook_messenger' || provider === 'instagram') {
    for (const rawEntry of arrayValues(payload.entry).slice(0, 50)) {
      for (const rawMessaging of arrayValues(asObject(rawEntry).messaging).slice(0, 50)) {
        const messaging = asObject(rawMessaging);
        const delivery = asObject(messaging.delivery);
        for (const mid of arrayValues(delivery.mids).slice(0, 50)) add(mid, 'delivered');
        const read = asObject(messaging.read);
        if (read.mid) add(read.mid, 'read');
      }
    }
  } else if (provider.startsWith('twilio_')) {
    add(
      payload.MessageSid || payload.SmsSid || payload.CallSid,
      payload.MessageStatus || payload.SmsStatus || payload.CallStatus,
      payload.ErrorCode || payload.ErrorMessage,
    );
  } else if (['email_google', 'email_microsoft', 'smtp'].includes(provider)) {
    add(
      payload.providerMessageId || payload.provider_message_id,
      payload.eventType || payload.event_type || payload.delivery_status,
      asObject(payload.metadata).reason || payload.reason,
      payload.referenceId || payload.reference_id,
    );
  }

  const genericStatuses = arrayValues(payload.statuses);
  for (const rawStatus of genericStatuses.slice(0, 50)) {
    const status = asObject(rawStatus);
    const error = firstObject(status.errors);
    add(
      status.provider_message_id || status.message_id || status.id,
      status.delivery_status || status.status || status.event_type,
      status.reason || status.error_code || error.code || error.message,
    );
  }
  add(
    payload.provider_message_id || payload.message_id || payload.MessageSid || payload.SmsSid || payload.CallSid,
    payload.delivery_status || payload.MessageStatus || payload.SmsStatus || payload.CallStatus,
    payload.reason || payload.error_code || payload.ErrorCode || payload.ErrorMessage,
  );

  const deduplicated = new Map<string, ProviderDeliveryReceipt>();
  for (const receipt of receipts) {
    deduplicated.set(
      `${receipt.deliveryId || ''}:${receipt.providerReference || ''}:${receipt.status}`,
      receipt,
    );
  }
  return [...deduplicated.values()].slice(0, 50);
}

export function providerResponseFailure(
  provider: string,
  payload: Record<string, unknown>,
): { code: string; message: string } | null {
  if (provider === 'slack' && payload.ok === false) {
    const raw = String(payload.error || 'provider_rejected_request');
    const code = /^[a-z0-9_]{1,128}$/u.test(raw) ? raw : 'provider_rejected_request';
    return { code, message: `Provider rejected the request (${code})` };
  }
  if (provider === 'twitter') {
    const data = asObject(payload.data);
    const errors = arrayValues(payload.errors);
    if (!data.dm_event_id && errors.length > 0) {
      const first = asObject(errors[0]);
      const raw = String(first.type || first.title || first.detail || 'provider_rejected_request');
      const normalized = raw.toLowerCase().replace(/[^a-z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '');
      const code = /^[a-z0-9_]{1,128}$/u.test(normalized) ? normalized : 'provider_rejected_request';
      return { code, message: `Provider rejected the request (${code})` };
    }
  }
  return null;
}

export function providerOutboundValidatesLive(
  provider: string,
  payload: Record<string, unknown>,
) {
  if (!['email_google', 'email_microsoft', 'smtp'].includes(provider)) return true;
  return String(payload.status || '').toLowerCase() === 'sent'
    && Boolean(payload.providerMessageId || payload.provider_message_id || payload.id);
}

function normalizeProviderDeliveryStatus(value: unknown): ProviderDeliveryStatus | null {
  const status = String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
  if (['sent', 'accepted', 'submitted', 'sending', 'queued', 'initiated', 'ringing', 'answered',
    'in_progress'].includes(status)) return 'sent';
  if (['delivered', 'completed', 'complete', 'success', 'succeeded'].includes(status)) return 'delivered';
  if (['read', 'seen'].includes(status)) return 'read';
  if (['failed', 'undelivered', 'rejected', 'cancelled', 'canceled', 'busy', 'no_answer', 'error',
    'soft_bounce', 'hard_bounce', 'complaint'].includes(status)) return 'failed';
  if (status === 'delivery_delayed') return 'sent';
  return null;
}

function inboundMessage(value: Partial<{
  externalUserId: string | null;
  threadId: string | null;
  messageId: string | null;
  messageBody: string | null;
  subject: string | null;
  senderName: string | null;
  senderEmail: string | null;
  attachments: unknown[];
  authenticity: Record<string, unknown>;
}>) {
  return {
    externalUserId: value.externalUserId || null,
    threadId: value.threadId || null,
    messageId: value.messageId || null,
    messageBody: value.messageBody || null,
    subject: value.subject || null,
    senderName: value.senderName || null,
    senderEmail: value.senderEmail || null,
    contentType: 'text' as const,
    attachments: value.attachments || [],
    authenticity: value.authenticity || {},
  };
}

async function finishProviderEvent(db: D1Database, id: string, status: 'processed' | 'ignored') {
  await db.prepare(`UPDATE support_provider_events SET status = ?, last_error = NULL,
    processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).bind(status, id).run();
}

function isDeadLetterQueue(queue: string, env: Env) {
  return [env.DLQ_NAME, env.SUPPORT_EVENTS_DLQ_NAME, env.SUPPORT_AI_DLQ_NAME, env.SUPPORT_BULK_DLQ_NAME]
    .filter(Boolean).includes(queue);
}
function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}
function asObject(value: unknown) { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function arrayValues(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function firstObject(value: unknown) { return asObject(arrayValues(value)[0]); }
function textValue(value: unknown) { return value == null ? null : String(value).slice(0, 8_000); }
function boundedPrompt(input: Record<string, unknown>, taskType: string) { const value = JSON.stringify({ task: taskType, input }); if (value.length > 32_000) throw failure('captain_input_too_large', 'Support intelligence input is too large'); return value; }
async function automaticCaptainAuthorization(
  db: D1Database,
  projectId: number,
  assistantId: string,
  conversationId: string,
) {
  return db.prepare(`
    SELECT assistant.active, assistant.response_mode, link.automatic_enabled,
      conversation.status conversation_status,
      (SELECT COUNT(*) FROM support_assistant_tasks handoff
       WHERE handoff.project_id = conversation.project_id
         AND handoff.conversation_id = conversation.id
         AND handoff.assistant_id = assistant.id
         AND handoff.task_type = 'handoff'
         AND handoff.status = 'completed') completed_handoffs,
      (SELECT COUNT(*) FROM support_provider_endpoints endpoint
       WHERE endpoint.project_id = conversation.project_id
         AND endpoint.inbox_id = conversation.inbox_id
         AND endpoint.provider NOT IN ('widget', 'api')
         AND endpoint.status IN ('configured', 'validated', 'live_validated')) outbound_endpoints
    FROM support_assistants assistant
    INNER JOIN conversations conversation
      ON conversation.id = ? AND conversation.project_id = assistant.project_id
    INNER JOIN support_assistant_inboxes link
      ON link.project_id = assistant.project_id
      AND link.assistant_id = assistant.id
      AND link.inbox_id = conversation.inbox_id
    WHERE assistant.id = ? AND assistant.project_id = ?
  `).bind(conversationId, assistantId, projectId)
    .first<AutomaticCaptainAuthorization>();
}
function captainSourceTrace(value: unknown) {
  return arrayValues(value).slice(0, 5).flatMap((entry) => {
    const source = asObject(entry);
    const id = textValue(source.id)?.trim();
    if (!id || id.length > 255) return [];
    const score = Number(source.score);
    return [{
      id,
      ...(textValue(source.title) ? { title: String(textValue(source.title)).slice(0, 255) } : {}),
      ...(textValue(source.slug) ? { slug: String(textValue(source.slug)).slice(0, 255) } : {}),
      ...(Number.isFinite(score) ? { score } : {}),
    }];
  });
}
async function captainConversationContext(db: D1Database, projectId: number, conversationId: string) {
  const conversation = await db.prepare(`SELECT id, subject, status, priority, inbox_id,
      last_message_preview, custom_attributes_json FROM conversations
    WHERE id = ? AND project_id = ?`).bind(conversationId, projectId)
    .first<Record<string, unknown>>();
  if (!conversation) throw failure('captain_conversation_not_found', 'Support conversation was not found');
  const messages = await db.prepare(`SELECT sender_kind, visibility, body, created_at FROM messages
    WHERE conversation_id = ? AND deleted_at IS NULL
    ORDER BY sequence DESC LIMIT 50`).bind(conversationId).all<Record<string, unknown>>();
  return {
    id: conversation.id,
    subject: conversation.subject,
    status: conversation.status,
    priority: conversation.priority,
    inbox_id: conversation.inbox_id,
    last_message_preview: conversation.last_message_preview,
    custom_attributes: parseRecord(String(conversation.custom_attributes_json || '{}')),
    messages: messages.results.reverse().map((message) => ({
      sender_kind: message.sender_kind,
      visibility: message.visibility,
      body: String(message.body || '').slice(0, 4_000),
      created_at: message.created_at,
    })),
  };
}
function captainKnowledgeQuery(input: Record<string, unknown>, conversation: unknown) {
  const explicit = [input.query, input.prompt, input.text].find((value) => typeof value === 'string' && value.trim());
  if (explicit) return String(explicit).slice(0, 32_000);
  const source = asObject(conversation);
  const messages = Array.isArray(source.messages) ? source.messages : [];
  const messageText = messages.slice(-10).map((message) => String(asObject(message).body || '')).join('\n');
  return `${String(source.subject || '')}\n${String(source.last_message_preview || '')}\n${messageText}`.trim().slice(0, 32_000)
    || 'Support conversation assistance';
}
function validateCaptainToolInput(schema: Record<string, unknown>, input: Record<string, unknown>) {
  const serialized = JSON.stringify(input);
  if (new TextEncoder().encode(serialized).byteLength > 32_000 || Object.keys(input).length > 100) {
    throw failure('captain_tool_input_invalid', 'Assistant tool input exceeds supported limits', 422);
  }
  const properties = asObject(schema.properties);
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  for (const name of required) {
    if (!(name in input)) throw failure('captain_tool_input_invalid', `Assistant tool input requires ${name}`, 422);
  }
  if (schema.additionalProperties === false) {
    const unknown = Object.keys(input).find((name) => !(name in properties));
    if (unknown) throw failure('captain_tool_input_invalid', `Assistant tool input does not accept ${unknown}`, 422);
  }
  for (const [name, value] of Object.entries(input)) {
    const expected = String(asObject(properties[name]).type || '');
    if ((expected === 'string' && typeof value !== 'string') ||
      (expected === 'number' && typeof value !== 'number') ||
      (expected === 'integer' && !Number.isInteger(value)) ||
      (expected === 'boolean' && typeof value !== 'boolean') ||
      (expected === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) ||
      (expected === 'array' && !Array.isArray(value))) {
      throw failure('captain_tool_input_invalid', `Assistant tool input ${name} has an invalid type`, 422);
    }
  }
}
function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
function providerReferenceFrom(payload: Record<string, unknown>) {
  const message = asObject(payload.message);
  const messages = firstObject(payload.messages);
  const sentMessage = firstObject(payload.sentMessages || payload.sent_messages);
  const resultBody = asObject(payload.result);
  const data = asObject(payload.data);
  const reference = payload.providerMessageId || payload.messageId || payload.message_id || payload.sid
    || payload.id || payload.ts || message.id || messages.id || sentMessage.id
    || resultBody.message_id || resultBody.id || data.dm_event_id;
  return reference == null ? null : String(reference).slice(0, 255);
}
function oauthTokenAdapter(
  provider: string,
  settings: Record<string, unknown>,
  credentials: Record<string, unknown>,
) {
  const tenant = String(settings.tenant || 'common').replace(/[^A-Za-z0-9._-]/g, '') || 'common';
  const shop = String(settings.shop_domain || credentials.shop_domain || '').toLowerCase();
  const adapters: Record<string, { tokenUrl: string; includeSecret: boolean; basicAuth?: boolean }> = {
    email_google: { tokenUrl: 'https://oauth2.googleapis.com/token', includeSecret: true },
    email_microsoft: { tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, includeSecret: true },
    facebook_messenger: { tokenUrl: 'https://graph.facebook.com/v22.0/oauth/access_token', includeSecret: true },
    instagram: { tokenUrl: 'https://graph.facebook.com/v22.0/oauth/access_token', includeSecret: true },
    slack: { tokenUrl: 'https://slack.com/api/oauth.v2.access', includeSecret: true },
    linear: { tokenUrl: 'https://api.linear.app/oauth/token', includeSecret: true },
    notion: { tokenUrl: 'https://api.notion.com/v1/oauth/token', includeSecret: false, basicAuth: true },
    tiktok: { tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/', includeSecret: true },
    twitter: { tokenUrl: 'https://api.x.com/2/oauth2/token', includeSecret: false, basicAuth: true },
    shopify: { tokenUrl: shop && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ? `https://${shop}/admin/oauth/access_token` : '', includeSecret: true },
  };
  const adapter = adapters[provider];
  if (!adapter?.tokenUrl) throw failure('configuration_required', 'OAuth token adapter is not configured');
  return adapter;
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function failure(code: string, message: string, status = 500) {
  return Object.assign(new Error(message), { code, status });
}
