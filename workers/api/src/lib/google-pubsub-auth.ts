import { decodeProtectedHeader, importJWK, jwtVerify, type JWK, type JWTPayload } from 'jose';
import type { Env } from '../types';
import { readTextLimited } from './http-limits';
import { constantTimeEqual } from '@opengrow/contracts/secret';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const JWKS_CACHE_KEY = 'billing:google-pubsub:jwks:v1';

type GoogleJwks = { keys: JWK[] };

export type GooglePubSubAuthentication = {
  mode: 'oidc' | 'legacy_token' | 'fixture';
  email: string | null;
  audience: string;
  subject: string | null;
};

export function googlePubSubAudience(apiDomain: string, instanceId: number | string) {
  const input = String(apiDomain || '').trim().replace(/\/+$/, '');
  const origin = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(origin);
  if (url.protocol !== 'https:') throw authError('google_pubsub_audience_invalid', 'Google Pub/Sub audience must use HTTPS');
  return `${url.origin}/api/v1/iap/google/${encodeURIComponent(String(instanceId))}`;
}

export async function authenticateGooglePubSub(env: Env, request: Request, params: {
  instanceId: number;
  expectedEmail: string | null;
}): Promise<GooglePubSubAuthentication> {
  const audience = googlePubSubAudience(env.API_DOMAIN, params.instanceId);
  const authorization = request.headers.get('Authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  if (bearer) {
    if (!params.expectedEmail) {
      throw authError('google_pubsub_identity_unavailable', 'Google Pub/Sub push identity is not configured', 503, true);
    }
    const payload = await verifyGoogleOidc(env, bearer, audience);
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    if (!email || email !== params.expectedEmail.trim().toLowerCase() || !emailVerified) {
      throw authError('google_pubsub_identity_invalid', 'Google Pub/Sub push identity is invalid', 401);
    }
    return {
      mode: 'oidc',
      email,
      audience,
      subject: typeof payload.sub === 'string' ? payload.sub : null,
    };
  }

  if (env.GOOGLE_PUBSUB_VERIFICATION_TOKEN) {
    const supplied = request.headers.get('X-Goog-Channel-Token') || '';
    if (supplied && await constantTimeEqual(supplied, env.GOOGLE_PUBSUB_VERIFICATION_TOKEN)) {
      return { mode: 'legacy_token', email: null, audience, subject: null };
    }
  }

  if (env.ENVIRONMENT !== 'production' && env.IAP_ALLOW_UNSIGNED_FIXTURES === 'true') {
    return { mode: 'fixture', email: null, audience, subject: null };
  }
  throw authError('google_pubsub_authentication_invalid', 'Google Pub/Sub authentication is invalid', 401);
}

export async function persistGooglePubSubAuthentication(
  db: D1Database,
  projectId: string | number,
  authentication: GooglePubSubAuthentication,
) {
  if (authentication.mode !== 'oidc' || !authentication.email) return;
  const current = {
    authentication: 'oidc',
    service_account_email: authentication.email,
    audience: authentication.audience,
    subject: authentication.subject,
  };
  const required = {
    authentication: 'oidc',
    service_account_email: authentication.email,
    audience: authentication.audience,
  };
  await db.prepare(`
    INSERT INTO billing_store_notification_configurations (
      project_id, provider, ready, current_configuration, required_configuration,
      checked_at, configured_at, updated_at
    ) VALUES (?, 'google', 1, ?, ?, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(project_id, provider) DO UPDATE SET
      ready = 1,
      current_configuration = excluded.current_configuration,
      required_configuration = excluded.required_configuration,
      checked_at = excluded.checked_at,
      configured_at = COALESCE(billing_store_notification_configurations.configured_at, excluded.configured_at),
      updated_at = excluded.updated_at
  `).bind(String(projectId), JSON.stringify(current), JSON.stringify(required)).run();
}

async function verifyGoogleOidc(env: Env, token: string, audience: string): Promise<JWTPayload> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try { header = decodeProtectedHeader(token); }
  catch { throw authError('google_pubsub_oidc_invalid', 'Google Pub/Sub OIDC token is invalid', 401); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw authError('google_pubsub_oidc_invalid', 'Google Pub/Sub OIDC token is invalid', 401);
  }
  let jwks = await googleJwks(env, false);
  let jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    jwks = await googleJwks(env, true);
    jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  }
  if (!jwk) throw authError('google_pubsub_oidc_key_unknown', 'Google Pub/Sub OIDC signing key is unknown', 401);
  try {
    const key = await importJWK(jwk, 'RS256');
    const result = await jwtVerify(token, key, {
      algorithms: ['RS256'],
      issuer: GOOGLE_ISSUERS,
      audience,
      clockTolerance: 30,
    });
    return result.payload;
  } catch {
    throw authError('google_pubsub_oidc_invalid', 'Google Pub/Sub OIDC token is invalid', 401);
  }
}

async function googleJwks(env: Env, forceRefresh: boolean): Promise<GoogleJwks> {
  if (!forceRefresh) {
    const cached = await env.KV.get(JWKS_CACHE_KEY, 'json').catch(() => null) as GoogleJwks | null;
    if (validJwks(cached)) return cached;
  }
  const response = await fetch(GOOGLE_JWKS_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await readTextLimited(response, 131_072, 'Google signing key response is too large')
    .catch(() => '');
  let payload: GoogleJwks | null = null;
  try { payload = JSON.parse(text) as GoogleJwks; } catch { payload = null; }
  if (!response.ok || !validJwks(payload)) {
    throw authError('google_pubsub_jwks_unavailable', 'Google Pub/Sub signing keys are unavailable', 503, true);
  }
  const maxAge = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/i)?.[1] || 3600);
  const ttl = Math.max(300, Math.min(21_600, Number.isFinite(maxAge) ? Math.trunc(maxAge) : 3600));
  await env.KV.put(JWKS_CACHE_KEY, JSON.stringify(payload), { expirationTtl: ttl }).catch(() => undefined);
  return payload;
}

function validJwks(value: GoogleJwks | null): value is GoogleJwks {
  return Boolean(value && Array.isArray(value.keys) && value.keys.length > 0);
}

function authError(code: string, message: string, status = 400, retryable = false) {
  return Object.assign(new Error(message), { code, status, retryable });
}
