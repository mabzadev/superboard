import type { Env } from '../types';
import type { BillingQueueJob } from './billing-dispatch';
import { readTextLimited } from './http-limits';

export type GrowthEventInput = {
  event_id: string;
  event_type: string;
  subject_id?: string | null;
  occurred_at?: string;
  payload?: Record<string, unknown>;
};

type GrowthAction = {
  id: string;
  status: string;
  action_type: 'chat' | 'push' | 'in_app';
  payload: Record<string, unknown>;
};

type ClaimedRun = GrowthAction & {
  terminal?: boolean;
  action_payload_json?: string;
};

type DeliveryTarget = {
  visitor_id: string;
  device_id: string;
  platform: string | null;
  push_token: string | null;
};

export async function emitGrowthEvent(env: Env, projectId: string | number, event: GrowthEventInput) {
  requireGrowth(env);
  const response = await growthRequest(env, projectId, '/events', { method: 'POST', body: event });
  const actions = Array.isArray(response?.data?.actions) ? response.data.actions as GrowthAction[] : [];
  if (!env.EVENT_QUEUE) throw deliveryError('growth_delivery_queue_unavailable', 'Automation delivery queue is not configured', true);
  await Promise.all(actions
    .filter((action) => action.status === 'pending')
    .map((action) => env.EVENT_QUEUE!.send({
      type: 'growth.automation.deliver', projectId: String(projectId), runId: String(action.id),
    })));
  return { duplicate: Boolean(response?.data?.duplicate), queued: actions.filter((action) => action.status === 'pending').length };
}

export async function emitBillingGrowthEvent(env: Env, job: BillingQueueJob, result: unknown) {
  if (!['billing.apple.notification', 'billing.google.notification', 'billing.stripe.notification', 'billing.subscription.reconcile'].includes(job.type)) {
    return { skipped: true, reason: 'job_not_actionable' };
  }
  const response = parseObject(result);
  const transactionId = String(response.transaction_id || response.transactionId || parseObject(response.result).transactionId || '');
  if (!transactionId) return { skipped: true, reason: 'transaction_not_available' };
  const transaction = await env.DB.prepare(`
    SELECT t.id, t.project_id, t.store, t.status, t.event_type, t.product_id,
      t.purchased_at, t.event_occurred_at, t.expires_at, c.primary_app_user_id
    FROM billing_transactions t
    LEFT JOIN billing_customers c ON c.id = t.customer_id
    WHERE t.id = ? LIMIT 1
  `).bind(transactionId).first<Record<string, unknown>>();
  if (!transaction?.primary_app_user_id) return { skipped: true, reason: 'identified_customer_not_available' };
  const eventType = billingGrowthEventType(String(transaction.status || ''), String(transaction.event_type || ''));
  if (!eventType) return { skipped: true, reason: 'transaction_not_actionable' };
  return emitGrowthEvent(env, String(transaction.project_id), {
    event_id: `billing:${transaction.id}:${eventType}`,
    event_type: eventType,
    subject_id: String(transaction.primary_app_user_id),
    occurred_at: String(transaction.event_occurred_at || transaction.purchased_at || new Date().toISOString()),
    payload: {
      store: transaction.store,
      status: transaction.status,
      provider_event_type: transaction.event_type,
      product_id: transaction.product_id,
      expires_at: transaction.expires_at,
    },
  });
}

export function billingGrowthEventType(status: string, providerEventType: string): GrowthEventInput['event_type'] | null {
  const normalizedStatus = status.toLocaleLowerCase('en');
  const normalizedEvent = providerEventType.toLocaleLowerCase('en');
  if (/refund.*revers|revoke.*revers/.test(normalizedEvent)) return 'refund_reversed';
  if (normalizedStatus === 'refunded' || normalizedStatus === 'revoked' || /refund|voided|dispute.*lost/.test(normalizedEvent)) return 'refund_granted';
  if (normalizedStatus === 'billing_issue' || /payment.*fail|billing.*retry|grace.*period/.test(normalizedEvent)) return 'payment_failed';
  if (normalizedStatus === 'expired' || /expir|subscription.*deleted|cancelled/.test(normalizedEvent)) return 'entitlement_expired';
  if (['active', 'trialing'].includes(normalizedStatus)
    && /did_renew|renewal|subscription_renewed|invoice\.paid|invoice\.payment_succeeded/.test(normalizedEvent)) return 'renewal_succeeded';
  return null;
}

export async function deliverGrowthAutomation(env: Env, projectId: string | number, runId: string) {
  requireGrowth(env);
  const claimedResponse = await growthRequest(env, projectId, `/automation-runs/${encodeURIComponent(runId)}/claim`, { method: 'POST' });
  const claimed = claimedResponse?.data as ClaimedRun | undefined;
  if (!claimed) throw deliveryError('growth_run_invalid', 'Growth returned an invalid automation run', true);
  if (claimed.terminal) return { status: claimed.status, duplicate: true };
  const payload = parseObject(claimed.action_payload_json || claimed.payload);
  const channel = String(claimed.action_type || payload.channel || '');
  const subjectId = requiredText(payload.subject_id, 'Automation subject is required', 255);
  const message = parseObject(payload.message);

  try {
    const receipt = await existingReceipt(env.DB, runId);
    if (receipt?.status === 'delivered') {
      await markGrowthRun(env, projectId, runId, 'delivered');
      return { status: 'delivered', duplicate: true };
    }
    await beginReceipt(env.DB, runId, String(projectId), channel, subjectId);
    let result: Record<string, unknown>;
    if (channel === 'chat') result = await deliverChat(env, projectId, runId, subjectId, message);
    else if (channel === 'push' || channel === 'in_app') result = await deliverNotification(env, projectId, runId, subjectId, channel, message);
    else throw deliveryError('growth_action_unsupported', 'Unsupported automation action', false);
    await completeReceipt(env.DB, runId, result.notification_id == null ? null : String(result.notification_id));
    await markGrowthRun(env, projectId, runId, 'delivered');
    return { status: 'delivered', channel, ...result };
  } catch (error) {
    const normalized = normalizeError(error);
    if (normalized.retryable) {
      await releaseGrowthRun(env, projectId, runId, normalized.message, normalized.retryDelaySeconds);
      throw normalized;
    }
    await failReceipt(env.DB, runId, normalized.message);
    await markGrowthRun(env, projectId, runId, 'failed', normalized.message);
    return { status: 'failed', channel, code: normalized.code, error: normalized.message };
  }
}

async function deliverChat(env: Env, projectId: string | number, runId: string, subjectId: string, message: Record<string, unknown>) {
  if (!env.MESSAGING || !env.MESSAGING_INTERNAL_TOKEN) {
    throw deliveryError('messaging_unavailable', 'Messaging services are not configured', true);
  }
  const body = requiredText(message.body, 'Chat message body is required', 8_000);
  const conversation = await messagingRequest(env, `/internal/projects/${projectId}/conversations`, {
    method: 'POST',
    body: {
      external_user_id: subjectId,
      client_conversation_id: 'lifecycle-automation',
      subject: optionalText(message.title, 255) || 'Lifecycle messages',
    },
  });
  const conversationId = String(conversation?.data?.id || '');
  if (!conversationId) throw deliveryError('messaging_response_invalid', 'Messaging returned an invalid conversation', true);
  const delivered = await messagingRequest(env, `/internal/projects/${projectId}/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST', body: { body, client_message_id: runId }, agentId: 'growth-automation',
  });
  return { conversation_id: conversationId, message_id: String(delivered?.data?.id || ''), duplicate: Boolean(delivered?.duplicate) };
}

async function deliverNotification(
  env: Env,
  projectId: string | number,
  runId: string,
  subjectId: string,
  channel: 'push' | 'in_app',
  message: Record<string, unknown>,
) {
  const body = requiredText(message.body, 'Notification body is required', 4_000);
  const title = optionalText(message.title, 255) || '';
  const targets = await targetVisitors(env.DB, projectId, subjectId);
  if (!targets.length) throw deliveryError('automation_subject_not_found', 'No registered app user matches the automation subject', false);
  await env.DB.prepare(`
    INSERT INTO notifications (project_id, title, subtitle, html, send_push, auto_display, archived, automation_run_id)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT(automation_run_id) DO NOTHING
  `).bind(String(projectId), title, body, `<p>${escapeHtml(body)}</p>`, channel === 'push' ? 1 : 0, channel === 'in_app' ? 1 : 0, runId).run();
  const notification = await env.DB.prepare('SELECT id, title, subtitle FROM notifications WHERE automation_run_id = ? AND project_id = ?')
    .bind(runId, String(projectId)).first<{ id: string; title: string; subtitle: string }>();
  if (!notification) throw deliveryError('notification_persistence_failed', 'Unable to persist the automation notification', true);

  let pushQueued = 0;
  for (const target of targets) {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO notification_targets (id, notification_id, visitor_id, device_id, status, existing_users, new_users, platforms)
        VALUES (?, ?, ?, ?, 'pending', 1, 0, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(`${runId}:${target.visitor_id}`, notification.id, target.visitor_id, target.device_id, JSON.stringify(target.platform ? [target.platform] : [])),
      env.DB.prepare(`
        INSERT INTO notification_messages (notification_id, visitor_id, device_id, read)
        SELECT ?, ?, ?, 0 WHERE NOT EXISTS (
          SELECT 1 FROM notification_messages WHERE notification_id = ? AND visitor_id = ?
        )
      `).bind(notification.id, target.visitor_id, target.device_id, notification.id, target.visitor_id),
    ]);
    if (channel === 'push' && target.push_token && (target.platform === 'ios' || target.platform === 'android')) {
      pushQueued += await enqueuePush(env.DB, projectId, notification, target);
    }
  }
  if (channel === 'push' && pushQueued === 0) {
    throw deliveryError('push_target_unavailable', 'No matching device has an active push token and provider configuration', false);
  }
  return { notification_id: String(notification.id), target_count: targets.length, push_queued: pushQueued };
}

async function targetVisitors(db: D1Database, projectId: string | number, subjectId: string) {
  const rows = await db.prepare(`
    SELECT CAST(v.id AS TEXT) AS visitor_id, CAST(v.device_id AS TEXT) AS device_id,
      d.platform, d.push_token
    FROM visitors v JOIN devices d ON d.id = v.device_id
    WHERE v.project_id = ? AND (
      v.external_id = ? OR v.anonymous_id = ? OR v.sdk_identifier = ? OR v.uuid = ? OR d.vendor = ?
    ) ORDER BY v.updated_at DESC LIMIT 20
  `).bind(String(projectId), subjectId, subjectId, subjectId, subjectId, subjectId).all<DeliveryTarget>();
  return rows.results;
}

async function enqueuePush(db: D1Database, projectId: string | number, notification: { id: string; title: string; subtitle: string }, target: DeliveryTarget) {
  const appId = await rpushAppForProjectPlatform(db, projectId, target.platform || '');
  if (!appId || !target.push_token) return 0;
  const data = JSON.stringify({ linksquared: 'true', notification_id: String(notification.id) });
  const result = await db.prepare(`
    INSERT INTO rpush_notifications (
      app_id, device_token, alert, alert_is_json, notification, data, type,
      delivered, failed, processing, created_at, updated_at
    ) SELECT ?, ?, ?, 1, ?, ?, ?, 0, 0, 0, datetime('now'), datetime('now')
    WHERE NOT EXISTS (SELECT 1 FROM rpush_notifications WHERE app_id = ? AND device_token = ? AND data = ?)
  `).bind(
    appId, target.push_token, JSON.stringify({ title: notification.title || '', subtitle: notification.subtitle || '' }),
    target.platform === 'android' ? JSON.stringify({ title: notification.title || '', body: notification.subtitle || '' }) : null,
    data, target.platform === 'ios' ? 'Rpush::Apnsp8::Notification' : 'Rpush::Fcm::Notification',
    appId, target.push_token, data,
  ).run();
  if (Number(result.meta.changes || 0) > 0) return 1;
  const existing = await db.prepare(`
    SELECT id FROM rpush_notifications WHERE app_id = ? AND device_token = ? AND data = ? LIMIT 1
  `).bind(appId, target.push_token, data).first<{ id: string }>();
  return existing ? 1 : 0;
}

async function rpushAppForProjectPlatform(db: D1Database, projectId: string | number, platform: string) {
  if (platform === 'ios') {
    const row = await db.prepare(`
      SELECT ra.id FROM projects p
      JOIN applications a ON a.instance_id = p.instance_id AND a.platform = 'ios'
      JOIN ios_configurations ic ON ic.application_id = a.id
      JOIN ios_push_configurations ipc ON ipc.ios_configuration_id = ic.id OR ipc.application_id = a.id
      JOIN rpush_apps ra ON ra.name = ipc.name || CASE WHEN COALESCE(p.test, 0) = 1 THEN '-development' ELSE '-production' END
      WHERE p.id = ? LIMIT 1
    `).bind(String(projectId)).first<{ id: string }>();
    return row?.id || null;
  }
  if (platform === 'android') {
    const row = await db.prepare(`
      SELECT ra.id FROM projects p
      JOIN applications a ON a.instance_id = p.instance_id AND a.platform = 'android'
      JOIN android_configurations ac ON ac.application_id = a.id
      JOIN android_push_configurations apc ON apc.android_configuration_id = ac.id OR apc.application_id = a.id
      JOIN rpush_apps ra ON ra.name = apc.name
      WHERE p.id = ? LIMIT 1
    `).bind(String(projectId)).first<{ id: string }>();
    return row?.id || null;
  }
  return null;
}

async function growthRequest(env: Env, projectId: string | number, suffix: string, init: { method: string; body?: unknown }) {
  const response = await env.GROWTH!.fetch(`https://growth.internal/internal/projects/${projectId}${suffix}`, {
    method: init.method,
    headers: { 'Content-Type': 'application/json', 'X-OpenGrow-Internal-Token': env.GROWTH_INTERNAL_TOKEN! },
    body: init.body == null ? undefined : JSON.stringify(init.body),
  });
  return responsePayload(response, 'growth_request_failed');
}

async function messagingRequest(env: Env, path: string, init: { method: string; body?: unknown; agentId?: string }) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'X-OpenGrow-Internal-Token': env.MESSAGING_INTERNAL_TOKEN!,
  };
  if (init.agentId) headers['X-OpenGrow-Agent-Id'] = init.agentId;
  const response = await env.MESSAGING!.fetch(`https://messaging.internal${path}`, {
    method: init.method, headers, body: init.body == null ? undefined : JSON.stringify(init.body),
  });
  return responsePayload(response, 'messaging_request_failed');
}

async function responsePayload(response: Response, fallbackCode: string) {
  const payload = parseObject(await readTextLimited(response, 65_536));
  if (!response.ok) {
    const retryable = payload.retryable == null ? response.status === 429 || response.status >= 500 : Boolean(payload.retryable);
    throw deliveryError(String(payload.code || fallbackCode), String(payload.message || `Internal service returned HTTP ${response.status}`),
      retryable, Number(payload.retry_after_seconds || 60));
  }
  return payload;
}

async function markGrowthRun(env: Env, projectId: string | number, runId: string, status: 'delivered' | 'failed', lastError?: string) {
  await growthRequest(env, projectId, `/automation-runs/${encodeURIComponent(runId)}`, {
    method: 'PATCH', body: { status, last_error: lastError || null },
  });
}

async function releaseGrowthRun(env: Env, projectId: string | number, runId: string, message: string, retryAfterSeconds = 60) {
  await growthRequest(env, projectId, `/automation-runs/${encodeURIComponent(runId)}/release`, {
    method: 'POST', body: { last_error: message, retry_after_seconds: retryAfterSeconds },
  });
}

async function existingReceipt(db: D1Database, runId: string) {
  return db.prepare('SELECT status, notification_id FROM growth_delivery_receipts WHERE run_id = ?')
    .bind(runId).first<{ status: string; notification_id: string | null }>();
}

async function beginReceipt(db: D1Database, runId: string, projectId: string, channel: string, subjectId: string) {
  await db.prepare(`
    INSERT INTO growth_delivery_receipts (run_id, project_id, channel, subject_id)
    VALUES (?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET updated_at = datetime('now')
  `).bind(runId, projectId, channel, subjectId).run();
}

async function completeReceipt(db: D1Database, runId: string, notificationId: string | null) {
  await db.prepare(`
    UPDATE growth_delivery_receipts SET status = 'delivered', notification_id = COALESCE(?, notification_id),
      last_error = NULL, delivered_at = datetime('now'), updated_at = datetime('now') WHERE run_id = ?
  `).bind(notificationId, runId).run();
}

async function failReceipt(db: D1Database, runId: string, message: string) {
  await db.prepare(`
    UPDATE growth_delivery_receipts SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE run_id = ?
  `).bind(message.slice(0, 2000), runId).run();
}

function requireGrowth(env: Env) {
  if (!env.GROWTH || !env.GROWTH_INTERNAL_TOKEN) throw deliveryError('growth_unavailable', 'Growth services are not configured', true);
}

function requiredText(value: unknown, message: string, max: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) throw deliveryError('automation_message_invalid', message, false);
  return text;
}

function optionalText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseObject(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try { return parseObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('\n', '<br>');
}

function deliveryError(code: string, message: string, retryable: boolean, retryDelaySeconds = 60) {
  return Object.assign(new Error(message), { code, retryable, retryDelaySeconds });
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return Object.assign(error, {
    code: String((error as any).code || 'growth_delivery_failed'),
    retryable: Boolean((error as any).retryable ?? true),
    retryDelaySeconds: Number((error as any).retryDelaySeconds || 60),
  });
  return deliveryError('growth_delivery_failed', String(error), true);
}
