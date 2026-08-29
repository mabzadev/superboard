import { Hono } from 'hono';
import { Env } from '../types';
import { encryptCredential, timingSafeEqual } from '../lib/secrets';
import { readJsonObjectLimited } from '../lib/http-limits';
import {
  parseSupportNotificationEvent,
  SUPPORT_NOTIFICATION_INGRESS_PATH,
  SUPPORT_NOTIFICATION_LIMITS,
  SupportNotificationContractError,
  type SupportNotificationEvent,
  type SupportNotificationReceipt,
} from '@superboard/contracts/support-notifications';
import {
  readJsonObjectLimited as readContractJsonObjectLimited,
  RequestBodyError,
} from '@superboard/contracts/request-body';
import { enqueuePushNotifications } from './projects';
import {
  migrateLegacyPushCredentials,
  requirePushCredential,
} from '../lib/push-credentials';

const push = new Hono<{ Bindings: Env }>();
export const internalPush = new Hono<{ Bindings: Env }>();

function base64url(input: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function pemBody(pem: string) {
  return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (char) => char.charCodeAt(0));
}

async function signJwt(header: Record<string, unknown>, claims: Record<string, unknown>, pem: string, algorithm: 'RS256' | 'ES256') {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBody(pem),
    algorithm === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    algorithm === 'RS256' ? 'RSASSA-PKCS1-v1_5' : { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(signature)}`;
}

async function fcmAccessToken(env: Env, app: any) {
  const expiresAt = Date.parse(app.access_token_expiration || '');
  if (app.encrypted_access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60000) {
    return requirePushCredential(env, app.encrypted_access_token, 'FCM');
  }
  const json = JSON.parse(await requirePushCredential(env, app.encrypted_json_key, 'FCM'));
  if (!json.client_email || !json.private_key) {
    throw new Error('FCM service account is invalid');
  }
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: json.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: json.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    json.private_key,
    'RS256',
  );
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const response = await fetch(json.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload: any = await readJsonObjectLimited(
    response,
    262_144,
    'FCM OAuth response is too large',
  ).catch((): Record<string, unknown> => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'FCM OAuth token request failed');
  if (!payload.access_token) throw new Error('FCM OAuth token response is invalid');
  const encryptedAccessToken = await encryptCredential(env, String(payload.access_token));
  await env.DB.prepare(`
    UPDATE rpush_apps
    SET encrypted_access_token = ?, access_token = NULL,
        access_token_expiration = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(encryptedAccessToken, new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString(), app.id).run();
  return payload.access_token;
}

function parseJson(value: unknown, fallback: any) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function deliverFcm(env: Env, app: any, row: any) {
  const token = await fcmAccessToken(env, app);
  const notification = parseJson(row.notification, {});
  const data = parseJson(row.data, {});
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(app.firebase_project_id)}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: row.device_token,
        notification,
        data,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const payload: any = await readJsonObjectLimited(
      response,
      262_144,
      'FCM error response is too large',
    ).catch((): Record<string, unknown> => ({}));
    throw new Error(payload?.error?.message || 'FCM send failed');
  }
}

async function deliverApns(env: Env, app: any, row: any) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt(
    { alg: 'ES256', kid: app.apn_key_id },
    { iss: app.team_id, iat: now },
    await requirePushCredential(env, app.encrypted_apn_key, 'APNs'),
    'ES256',
  );
  const alert = parseJson(row.alert, {});
  const host = app.environment === 'development' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const response = await fetch(`https://${host}/3/device/${encodeURIComponent(row.device_token)}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': app.bundle_id,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ aps: { alert } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const payload: any = await readJsonObjectLimited(
      response,
      262_144,
      'APNs error response is too large',
    ).catch((): Record<string, unknown> => ({}));
    throw new Error(payload.reason || 'APNs send failed');
  }
}

export async function processPushNotifications(env: Env, limit = 25) {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit || 25)));
  await migrateLegacyPushCredentials(env, 100);
  const rows = await env.DB.prepare(`
    SELECT rn.*, ra.type AS app_type, ra.name AS app_name, ra.environment,
           ra.encrypted_apn_key, ra.apn_key_id, ra.team_id, ra.bundle_id,
           ra.encrypted_json_key, ra.firebase_project_id,
           ra.encrypted_access_token, ra.access_token_expiration
    FROM rpush_notifications rn
    JOIN rpush_apps ra ON ra.id = rn.app_id
    WHERE COALESCE(rn.delivered, 0) = 0
      AND COALESCE(rn.failed, 0) = 0
      AND (
        COALESCE(rn.processing, 0) = 0
        OR datetime(rn.updated_at) <= datetime('now', '-15 minutes')
      )
      AND (rn.deliver_after IS NULL OR datetime(rn.deliver_after) <= datetime('now'))
    ORDER BY rn.created_at ASC
    LIMIT ?
  `).bind(boundedLimit).all<any>();

  const results = [];
  for (const row of rows.results || []) {
    const claim = await env.DB.prepare(`
      UPDATE rpush_notifications
      SET processing = 1, updated_at = datetime('now')
      WHERE id = ?
        AND COALESCE(delivered, 0) = 0
        AND COALESCE(failed, 0) = 0
        AND (COALESCE(processing, 0) = 0 OR datetime(updated_at) <= datetime('now', '-15 minutes'))
        AND (deliver_after IS NULL OR datetime(deliver_after) <= datetime('now'))
    `).bind(row.id).run();
    if (Number(claim.meta?.changes || 0) !== 1) continue;
    try {
      if (row.type === 'Rpush::Fcm::Notification') {
        await deliverFcm(env, row, row);
      } else if (row.type === 'Rpush::Apnsp8::Notification') {
        await deliverApns(env, row, row);
      } else {
        throw new Error(`Unsupported push type: ${row.type}`);
      }
      await env.DB.prepare(`
        UPDATE rpush_notifications
        SET delivered = 1, delivered_at = datetime('now'), processing = 0, updated_at = datetime('now')
        WHERE id = ?
      `).bind(row.id).run();
      results.push({ id: row.id, delivered: true });
    } catch (error: any) {
      const retryCount = Number(row.retries || 0) + 1;
      const maxRetries = 5;
      const retryDelaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, retryCount - 1));
      const retryModifier = `+${retryDelaySeconds} seconds`;
      await env.DB.prepare(`
        UPDATE rpush_notifications
        SET failed = ?, failed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE failed_at END,
            processing = 0,
            error_description = ?, error_code = COALESCE(error_code, 0),
            retries = ?,
            deliver_after = CASE WHEN ? = 1 THEN deliver_after ELSE datetime('now', ?) END,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        retryCount >= maxRetries ? 1 : 0,
        retryCount >= maxRetries ? 1 : 0,
        String(error?.message || error),
        retryCount,
        retryCount >= maxRetries ? 1 : 0,
        retryModifier,
        row.id,
      ).run();
      results.push({
        id: row.id,
        delivered: false,
        retry: retryCount < maxRetries,
        retries: retryCount,
        retry_after_seconds: retryCount < maxRetries ? retryDelaySeconds : null,
        error: String(error?.message || error),
      });
    }
  }
  return { processed: results.length, results };
}

type SupportIngressRow = {
  payload_sha256: string;
  notification_id: number | null;
  status: 'processing' | 'completed';
  browser_messages: number;
  push_queued: number;
};

function internalJson(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}

async function isAuthorizedSupportCaller(request: Request, env: Env) {
  const provided = request.headers.get('x-internal-token');
  if (!provided) return false;
  for (const expected of [env.MODULE_INTERNAL_TOKEN, env.MODULE_INTERNAL_TOKEN_PREVIOUS]) {
    if (expected && await timingSafeEqual(provided, expected)) return true;
  }
  return false;
}

async function eventDigest(event: SupportNotificationEvent) {
  return base64url(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(event)),
  ));
}

function supportReceipt(
  eventId: string,
  duplicate: boolean,
  browserMessages: number,
  pushQueued: number,
): SupportNotificationReceipt {
  return {
    data: {
      event_id: eventId,
      duplicate,
      browser_messages: browserMessages,
      push_queued: pushQueued,
    },
  };
}

/**
 * Materialize a private Support event into the existing notification inbox and
 * RPush tables. Every write is keyed by event_id, so a Queue retry or a Worker
 * restart can safely resume an event left in `processing`.
 */
export async function ingestSupportNotification(
  env: Env,
  event: SupportNotificationEvent,
): Promise<SupportNotificationReceipt> {
  const digest = await eventDigest(event);
  const claim = await env.DB.prepare(`
    INSERT INTO support_notification_ingress
      (event_id, payload_sha256, project_id, recipient_user_id, status)
    VALUES (?, ?, ?, ?, 'processing')
    ON CONFLICT(event_id) DO NOTHING
  `).bind(event.event_id, digest, event.project_id, event.recipient_user_id).run();
  const duplicate = Number(claim.meta?.changes || 0) === 0;
  const receipt = await env.DB.prepare(`
    SELECT payload_sha256, notification_id, status, browser_messages, push_queued
    FROM support_notification_ingress WHERE event_id = ?
  `).bind(event.event_id).first<SupportIngressRow>();
  if (!receipt) throw new Error('Support notification receipt was not persisted');
  if (receipt.payload_sha256 !== digest) {
    throw Object.assign(new Error('event_id was already used with another payload'), {
      status: 409,
      code: 'support_notification_idempotency_conflict',
    });
  }
  if (receipt.status === 'completed') {
    return supportReceipt(
      event.event_id,
      true,
      Number(receipt.browser_messages || 0),
      Number(receipt.push_queued || 0),
    );
  }

  if (!event.channels.browser && !event.channels.push) {
    await env.DB.prepare(`
      UPDATE support_notification_ingress
      SET status = 'completed', browser_messages = 0, push_queued = 0,
          updated_at = datetime('now')
      WHERE event_id = ? AND payload_sha256 = ?
    `).bind(event.event_id, digest).run();
    return supportReceipt(event.event_id, duplicate, 0, 0);
  }

  await env.DB.prepare(`
    INSERT INTO notifications
      (project_id, title, subtitle, html, send_push, auto_display, support_event_id)
    VALUES (?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(support_event_id) DO NOTHING
  `).bind(
    event.project_id,
    event.title,
    event.body,
    event.channels.push ? 1 : 0,
    event.channels.browser ? 1 : 0,
    event.event_id,
  ).run();
  const notification = await env.DB.prepare(`
    SELECT id FROM notifications WHERE support_event_id = ? AND project_id = ?
  `).bind(event.event_id, event.project_id).first<{ id: number }>();
  if (!notification) throw new Error('Support notification was not materialized');

  const platforms = [
    ...(event.channels.browser ? ['web', 'desktop'] : []),
    ...(event.channels.push ? ['ios', 'android'] : []),
  ];
  await env.DB.prepare(`
    INSERT INTO notification_targets
      (notification_id, existing_users, new_users, platforms)
    SELECT ?, 1, 0, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM notification_targets WHERE notification_id = ?
    )
  `).bind(String(notification.id), JSON.stringify(platforms), String(notification.id)).run();
  await env.DB.prepare(`
    INSERT INTO notification_messages (notification_id, visitor_id, device_id, read)
    SELECT DISTINCT ?, visitor.id, visitor.device_id, 0
    FROM visitors visitor
    JOIN devices device ON device.id = visitor.device_id
    WHERE visitor.project_id = ?
      AND visitor.sdk_identifier = ?
      AND visitor.device_id IS NOT NULL
      AND (
        (? = 1 AND device.platform IN ('web', 'desktop'))
        OR (? = 1 AND device.platform IN ('ios', 'android'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM notification_messages existing
        WHERE existing.notification_id = ? AND existing.visitor_id = visitor.id
      )
  `).bind(
    notification.id,
    String(event.project_id),
    event.recipient_user_id,
    event.channels.browser ? 1 : 0,
    event.channels.push ? 1 : 0,
    notification.id,
  ).run();

  if (event.channels.push) {
    await enqueuePushNotifications(env.DB, notification.id, event.project_id);
  }
  const browserCount = await env.DB.prepare(`
    SELECT COUNT(*) count
    FROM notification_messages message
    JOIN devices device ON device.id = message.device_id
    WHERE message.notification_id = ? AND device.platform IN ('web', 'desktop')
  `).bind(notification.id).first<{ count: number }>();
  const pushData = JSON.stringify({
    linksquared: 'true',
    notification_id: String(notification.id),
  });
  const pushCount = event.channels.push
    ? await env.DB.prepare(`
        SELECT COUNT(*) count FROM rpush_notifications WHERE data = ?
      `).bind(pushData).first<{ count: number }>()
    : null;
  const browserMessages = Number(browserCount?.count || 0);
  const pushQueued = event.channels.push ? Number(pushCount?.count || 0) : 0;

  // Queue signaling happens before completion. If it fails, the Support queue
  // retry resumes this event and signals the processor again without creating
  // duplicate notification or RPush rows.
  if (pushQueued > 0) {
    await env.PUSH_QUEUE.send({ type: 'push.process', limit: 25 }, { contentType: 'json' });
  }
  await env.DB.prepare(`
    UPDATE support_notification_ingress
    SET notification_id = ?, status = 'completed', browser_messages = ?,
        push_queued = ?, updated_at = datetime('now')
    WHERE event_id = ? AND payload_sha256 = ?
  `).bind(notification.id, browserMessages, pushQueued, event.event_id, digest).run();
  return supportReceipt(event.event_id, duplicate, browserMessages, pushQueued);
}

internalPush.post('/support-notifications', async (c) => {
  if (!await isAuthorizedSupportCaller(c.req.raw, c.env)) {
    return internalJson({
      error: {
        code: 'internal_auth_invalid',
        message: 'Internal authentication is required',
        retryable: false,
      },
    }, 403);
  }
  try {
    const raw = await readContractJsonObjectLimited(
      c.req.raw,
      SUPPORT_NOTIFICATION_LIMITS.networkBodyBytesMaximum,
    );
    const event = parseSupportNotificationEvent(raw);
    return internalJson(await ingestSupportNotification(c.env, event));
  } catch (error) {
    const status = error instanceof RequestBodyError
      ? error.status
      : error instanceof SupportNotificationContractError
        ? 422
        : Number((error as { status?: number }).status || 500);
    const code = error instanceof RequestBodyError
      ? error.code
      : error instanceof SupportNotificationContractError
        ? error.code
        : String((error as { code?: string }).code || 'support_notification_ingress_failed');
    if (status >= 500) {
      console.error(JSON.stringify({
        event: 'support_notification_ingress_failed',
        code,
        path: SUPPORT_NOTIFICATION_INGRESS_PATH,
      }));
    }
    return internalJson({
      error: {
        code,
        message: status >= 500
          ? 'Support notification could not be accepted'
          : error instanceof Error ? error.message : 'Support notification is invalid',
        retryable: status === 429 || status >= 500,
      },
    }, status);
  }
});

push.post('/process', async (c) => {
  const provided = c.req.header('X-API-KEY');
  if (!c.env.PUSH_PROCESS_KEY || !provided || !await timingSafeEqual(provided, c.env.PUSH_PROCESS_KEY)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') || 25)));
  return c.json(await processPushNotifications(c.env, limit));
});

export default push;
