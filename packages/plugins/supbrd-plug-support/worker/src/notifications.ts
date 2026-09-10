import {
  parseSupportNotificationEvent,
  parseSupportNotificationReceipt,
  SUPPORT_NOTIFICATION_INGRESS_PATH,
  SUPPORT_NOTIFICATION_LIMITS,
  SUPPORT_NOTIFICATION_SCHEMA_VERSION,
  type SupportNotificationEvent,
  type SupportNotificationReceipt,
} from '@superboard/contracts/support-notifications';
import { readJsonObjectLimited } from '@superboard/contracts/request-body';
import type { Env, SupportQueueJob } from './types';

type NotificationDeliveryRow = {
  id: string;
  project_id: number;
  notification_type: string;
  title: string;
  body: string;
  conversation_id: string | null;
  created_at: string;
  deleted_at: string | null;
  snoozed_until: string | null;
  recipient_user_id: string;
  push_enabled: number;
  browser_enabled: number;
  muted: number;
};

type DeliveryEnv = Pick<Env, 'DB' | 'API_SERVICE' | 'INTERNAL_API_TOKEN'>;
type OutboxEnv = Pick<Env, 'DB' | 'SUPPORT_QUEUE'>;

function base64url(bytes: ArrayBuffer) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function stableEventId(projectId: number, notificationId: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${projectId}:${notificationId}`),
  );
  return `support:${base64url(digest)}`;
}

export async function buildSupportNotificationEvent(
  row: NotificationDeliveryRow,
): Promise<SupportNotificationEvent> {
  const muted = row.muted === 1;
  const suppressed = row.deleted_at !== null
    || (row.snoozed_until !== null && Date.parse(row.snoozed_until) > Date.now());
  return parseSupportNotificationEvent({
    schema_version: SUPPORT_NOTIFICATION_SCHEMA_VERSION,
    event_id: await stableEventId(row.project_id, row.id),
    project_id: row.project_id,
    recipient_user_id: row.recipient_user_id,
    notification_type: row.notification_type,
    title: row.title.slice(0, SUPPORT_NOTIFICATION_LIMITS.titleLengthMaximum),
    body: row.body.slice(0, SUPPORT_NOTIFICATION_LIMITS.bodyLengthMaximum),
    conversation_id: row.conversation_id,
    occurred_at: row.created_at,
    channels: {
      push: !muted && !suppressed && row.push_enabled === 1,
      browser: !muted && !suppressed && row.browser_enabled === 1,
    },
  });
}

async function notificationDeliveryRow(
  db: D1Database,
  projectId: number,
  notificationId: string,
) {
  return db.prepare(`
    SELECT notification.id, notification.project_id,
      notification.notification_type, notification.title, notification.body,
      notification.conversation_id, notification.created_at,
      notification.deleted_at, notification.snoozed_until,
      membership.auth_user_id recipient_user_id,
      COALESCE(preference.push_enabled, 1) push_enabled,
      COALESCE(preference.browser_enabled, 1) browser_enabled,
      CASE WHEN EXISTS (
        SELECT 1 FROM json_each(
          COALESCE(preference.muted_event_types_json, '[]')
        ) muted_event
        WHERE muted_event.value = notification.notification_type
      ) THEN 1 ELSE 0 END muted
    FROM support_agent_notifications notification
    JOIN support_memberships membership
      ON membership.project_id = notification.project_id
      AND membership.active = 1
      AND (
        membership.auth_user_id = notification.agent_id
        OR membership.id = notification.agent_id
      )
    LEFT JOIN support_notification_preferences preference
      ON preference.project_id = notification.project_id
      AND preference.membership_id = membership.id
    WHERE notification.id = ? AND notification.project_id = ?
    ORDER BY CASE WHEN membership.auth_user_id = notification.agent_id THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(notificationId, projectId).first<NotificationDeliveryRow>();
}

export async function deliverSupportNotification(
  env: DeliveryEnv,
  job: Extract<SupportQueueJob, { type: 'support.notification.deliver.v1' }>,
): Promise<SupportNotificationReceipt> {
  const row = await notificationDeliveryRow(env.DB, job.projectId, job.notificationId);
  if (!row) {
    throw Object.assign(new Error('Support notification recipient is unavailable'), {
      status: 422,
      code: 'support_notification_recipient_unavailable',
    });
  }
  const event = await buildSupportNotificationEvent(row);
  let response: Response;
  try {
    response = await env.API_SERVICE.fetch(
      new Request(`https://api.internal${SUPPORT_NOTIFICATION_INGRESS_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': env.INTERNAL_API_TOKEN,
        },
        body: JSON.stringify(event),
      }),
    );
  } catch {
    throw Object.assign(new Error('API notification service is unavailable'), {
      status: 503,
      code: 'support_notification_api_unavailable',
    });
  }
  const payload = await readJsonObjectLimited(
    response,
    SUPPORT_NOTIFICATION_LIMITS.networkBodyBytesMaximum,
  ).catch((): Record<string, unknown> => ({}));
  if (!response.ok) {
    const serviceError = payload.error && typeof payload.error === 'object'
      ? payload.error as Record<string, unknown>
      : {};
    // During an ordered rollout or a code rollback, the API Worker may exist
    // while this new private route is temporarily absent. Keep the durable job
    // retryable instead of quarantining it as a permanent caller error.
    const status = response.status === 404 || response.status === 405
      ? 503
      : response.status;
    throw Object.assign(new Error('API rejected the Support notification'), {
      status,
      code: typeof serviceError.code === 'string'
        ? serviceError.code.slice(0, 128)
        : 'support_notification_api_rejected',
    });
  }
  const receipt = parseSupportNotificationReceipt(payload);
  if (receipt.data.event_id !== event.event_id) {
    throw Object.assign(new Error('API notification receipt does not match the event'), {
      status: 502,
      code: 'support_notification_receipt_mismatch',
    });
  }
  await env.DB.prepare(`
    UPDATE support_notification_delivery_outbox
    SET status = 'delivered', delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        claim_token = NULL, claimed_at = NULL, last_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE notification_id = ? AND project_id = ?
  `).bind(job.notificationId, job.projectId).run();
  return receipt;
}

/** Claim durable notification rows and hand only bounded identifiers to Queue. */
export async function claimSupportNotificationDeliveries(env: OutboxEnv) {
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE support_notification_delivery_outbox
      SET status = 'failed', claim_token = NULL, claimed_at = NULL,
          last_error = COALESCE(last_error, 'retry_limit_exceeded'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE status IN ('pending', 'claimed', 'queued') AND attempts >= 8
    `),
    env.DB.prepare(`
      UPDATE support_notification_delivery_outbox
      SET status = 'pending', claim_token = NULL, claimed_at = NULL,
          next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          last_error = 'stale_delivery_recovered',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE attempts < 8 AND (
        (status = 'claimed' AND claimed_at <= datetime('now', '-5 minutes'))
        OR (status = 'queued' AND updated_at <= datetime('now', '-15 minutes'))
      )
    `),
  ]);
  const claimToken = crypto.randomUUID();
  const rows = await env.DB.prepare(`
    UPDATE support_notification_delivery_outbox
    SET status = 'claimed', claim_token = ?,
        claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        attempts = attempts + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE notification_id IN (
      SELECT notification_id FROM support_notification_delivery_outbox
      WHERE status = 'pending'
        AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ORDER BY next_attempt_at, created_at LIMIT 100
    )
    RETURNING notification_id, project_id
  `).bind(claimToken).all<{ notification_id: string; project_id: number }>();
  for (const row of rows.results) {
    try {
      await env.SUPPORT_QUEUE.send({
        type: 'support.notification.deliver.v1',
        projectId: row.project_id,
        notificationId: row.notification_id,
      } satisfies SupportQueueJob, { contentType: 'json' });
      await env.DB.prepare(`
        UPDATE support_notification_delivery_outbox
        SET status = 'queued', last_error = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE notification_id = ? AND claim_token = ?
      `).bind(row.notification_id, claimToken).run();
    } catch (error) {
      await env.DB.prepare(`
        UPDATE support_notification_delivery_outbox
        SET status = 'pending', claim_token = NULL, claimed_at = NULL,
            next_attempt_at = datetime('now', '+5 minutes'), last_error = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE notification_id = ? AND claim_token = ?
      `).bind(
        error instanceof Error ? error.message.slice(0, 1_000) : 'queue_unavailable',
        row.notification_id,
        claimToken,
      ).run();
    }
  }
  return rows.results.length;
}

export async function failSupportNotificationDelivery(
  db: D1Database,
  projectId: number,
  notificationId: string,
) {
  await db.prepare(`
    UPDATE support_notification_delivery_outbox
    SET status = 'failed', claim_token = NULL, claimed_at = NULL,
        last_error = 'dead_letter_quarantine',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE notification_id = ? AND project_id = ?
  `).bind(notificationId, projectId).run();
}
