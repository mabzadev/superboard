import { failure } from './auth';
import type { Env } from './types';

type TrackingPayload = {
  projectId: number;
  deliveryId: string;
  subscriberId: string;
  campaignId: string;
  action: 'open' | 'click' | 'unsubscribe';
  target?: string;
};

export async function trackingToken(env: Env, payload: TrackingPayload) {
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(env.TRACKING_SIGNING_KEY, encoded);
  return `${encoded}.${signature}`;
}

export async function verifyTrackingToken(env: Env, value: string, expectedAction: TrackingPayload['action']) {
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature || !(await verifyHmac(env.TRACKING_SIGNING_KEY, encoded, signature))) {
    throw failure('tracking_token_invalid', 'Tracking token is invalid', 401);
  }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))); }
  catch { throw failure('tracking_token_invalid', 'Tracking token is invalid', 401); }
  if (!payload || typeof payload !== 'object') throw failure('tracking_token_invalid', 'Tracking token is invalid', 401);
  const parsed = payload as Partial<TrackingPayload>;
  if (parsed.action !== expectedAction || !Number.isSafeInteger(parsed.projectId) || !parsed.deliveryId
    || !parsed.subscriberId || !parsed.campaignId) throw failure('tracking_token_invalid', 'Tracking token is invalid', 401);
  if (expectedAction === 'click') {
    try {
      const url = new URL(String(parsed.target || ''));
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
    } catch { throw failure('tracking_target_invalid', 'Tracking target is invalid', 422); }
  }
  return parsed as TrackingPayload;
}

export async function instrumentHtml(env: Env, payload: Omit<TrackingPayload, 'action' | 'target'>, html: string) {
  let output = html;
  const links = [...html.matchAll(/href=(['"])(https?:\/\/[^'"\s]+)\1/gi)];
  for (const match of links) {
    const target = match[2];
    const token = await trackingToken(env, { ...payload, action: 'click', target });
    output = output.replace(match[0], `href=${match[1]}${env.PUBLIC_API_URL}/api/v1/marketing/tracking/click/${token}${match[1]}`);
  }
  const openToken = await trackingToken(env, { ...payload, action: 'open' });
  return `${output}<img src="${env.PUBLIC_API_URL}/api/v1/marketing/tracking/open/${openToken}" width="1" height="1" alt="" style="display:none" />`;
}

export async function unsubscribeUrl(env: Env, payload: Omit<TrackingPayload, 'action' | 'target'>) {
  return `${env.PUBLIC_API_URL}/api/v1/marketing/tracking/unsubscribe/${await trackingToken(env, { ...payload, action: 'unsubscribe' })}`;
}

async function hmac(secret: string, value: string) {
  if (!secret) throw failure('tracking_unavailable', 'Tracking signing is not configured', 503);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

async function verifyHmac(secret: string, value: string, signature: string) {
  if (!secret) return false;
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = base64UrlDecode(signature); } catch { return false; }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(value));
}

function base64Url(bytes: Uint8Array) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
