import { Hono } from 'hono';
import { Env } from '../types';
import { encryptCredential, timingSafeEqual } from '../lib/secrets';
import { readJsonObjectLimited } from '../lib/http-limits';
import {
  migrateLegacyPushCredentials,
  requirePushCredential,
} from '../lib/push-credentials';

const push = new Hono<{ Bindings: Env }>();

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

push.post('/process', async (c) => {
  const provided = c.req.header('X-API-KEY');
  if (!c.env.PUSH_PROCESS_KEY || !provided || !await timingSafeEqual(provided, c.env.PUSH_PROCESS_KEY)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') || 25)));
  return c.json(await processPushNotifications(c.env, limit));
});

export default push;
