import type { Env } from './types';
import { configuredSecrets } from '@opengrow/contracts/secret';

const TICKET_TTL_SECONDS = 60;

type TicketPayload = {
  projectId: number;
  conversationId: string;
  actorId: string;
  expiresAt: number;
  nonce: string;
};

export async function issueRealtimeTicket(
  env: Pick<Env, 'DB' | 'INTERNAL_API_TOKEN' | 'INTERNAL_API_TOKEN_PREVIOUS'>,
  projectId: number,
  conversationId: string,
  actorId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const payload: TicketPayload = {
    projectId,
    conversationId,
    actorId,
    expiresAt: nowSeconds + TICKET_TTL_SECONDS,
    nonce: randomToken(12),
  };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const ticket = `${encoded}.${await sign(env.INTERNAL_API_TOKEN, encoded)}`;
  await env.DB.prepare(`
    INSERT INTO support_realtime_tickets (token_hash, project_id, conversation_id, actor_id, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(await sha256(ticket), projectId, conversationId, actorId, new Date(payload.expiresAt * 1000).toISOString()).run();
  return { ticket, expires_at: new Date(payload.expiresAt * 1000).toISOString() };
}

export async function consumeRealtimeTicket(
  env: Pick<Env, 'DB' | 'INTERNAL_API_TOKEN' | 'INTERNAL_API_TOKEN_PREVIOUS'>,
  ticket: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const [encoded, signature] = ticket.split('.');
  const signatureValid = encoded && signature && (
    await Promise.all(
      configuredSecrets(
        env.INTERNAL_API_TOKEN,
        env.INTERNAL_API_TOKEN_PREVIOUS,
      ).map((secret) => verify(secret, encoded, signature)),
    )
  ).some(Boolean);
  if (!encoded || !signature || ticket.length > 1024 || !signatureValid) {
    throw failure('realtime_ticket_invalid', 'Realtime ticket is invalid or expired', 401);
  }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))); }
  catch { throw failure('realtime_ticket_invalid', 'Realtime ticket is invalid or expired', 401); }
  if (!validPayload(payload) || payload.expiresAt < nowSeconds || payload.expiresAt > nowSeconds + TICKET_TTL_SECONDS) {
    throw failure('realtime_ticket_invalid', 'Realtime ticket is invalid or expired', 401);
  }
  const consumed = await env.DB.prepare(`
    UPDATE support_realtime_tickets SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE token_hash = ? AND project_id = ? AND conversation_id = ? AND actor_id = ?
      AND consumed_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    RETURNING project_id, conversation_id, actor_id, expires_at
  `).bind(await sha256(ticket), payload.projectId, payload.conversationId, payload.actorId).first<{
    project_id: number; conversation_id: string; actor_id: string; expires_at: string;
  }>();
  if (!consumed) throw failure('realtime_ticket_invalid', 'Realtime ticket is invalid or expired', 401);
  return consumed;
}

function validPayload(value: unknown): value is TicketPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Partial<TicketPayload>;
  return Number.isSafeInteger(payload.projectId) && Number(payload.projectId) > 0
    && typeof payload.conversationId === 'string' && payload.conversationId.length > 0 && payload.conversationId.length <= 255
    && typeof payload.actorId === 'string' && payload.actorId.length > 0 && payload.actorId.length <= 255
    && Number.isSafeInteger(payload.expiresAt)
    && typeof payload.nonce === 'string' && /^[A-Za-z0-9_-]{16}$/.test(payload.nonce);
}

async function sign(secret: string, value: string) {
  if (!secret) throw failure('realtime_unavailable', 'Realtime signing is not configured', 503);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

async function verify(secret: string, value: string, signature: string) {
  if (!secret) return false;
  let signatureBytes: Uint8Array;
  try { signatureBytes = base64UrlDecode(signature); } catch { return false; }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(value));
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes: number) { return base64Url(crypto.getRandomValues(new Uint8Array(bytes))); }
function base64Url(bytes: Uint8Array) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
function failure(code: string, message: string, status: number) { return Object.assign(new Error(message), { code, status }); }
