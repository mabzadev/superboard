import { createLocalJWKSet, decodeJwt, jwtVerify, SignJWT, type JSONWebKeySet } from 'jose';
import { Env } from '../types';
import { customerInfo, findCustomerByAppUserId, getOrCreateCustomer } from './billing';

type OidcConfig = {
  issuer: string;
  audience: string;
  jwks_uri: string;
};

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((header || '').trim());
  return match?.[1]?.trim() || null;
}

async function oidcConfig(env: Env, projectId: string | number, issuer: string): Promise<OidcConfig | null> {
  const configured = await env.DB.prepare(`
    SELECT issuer, audience, jwks_uri
    FROM billing_oidc_configs
    WHERE project_id = ? AND issuer = ? AND enabled = 1
    LIMIT 1
  `).bind(String(projectId), issuer).first<OidcConfig>();
  if (configured) return configured;
  if (issuer === 'https://api.vocostar.com') {
    return {
      issuer,
      audience: 'opengrow',
      jwks_uri: 'https://api.vocostar.com/.well-known/jwks.json',
    };
  }
  return null;
}

function isJwks(value: unknown): value is JSONWebKeySet {
  if (!value || typeof value !== 'object') return false;
  const keys = (value as { keys?: unknown }).keys;
  return Array.isArray(keys) && keys.every((key) => key && typeof key === 'object');
}

async function loadJwks(env: Env, uri: string, forceRefresh = false): Promise<JSONWebKeySet> {
  const cacheKey = `billing:jwks:${await sha256(uri)}`;
  const cached = forceRefresh ? null : await env.KV.get(cacheKey, 'json').catch(() => null);
  if (isJwks(cached)) return cached;
  const response = await fetch(uri, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Unable to fetch identity provider keys');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 256_000) throw new Error('Identity provider key set is too large');
  const payload: unknown = await response.json();
  if (!isJwks(payload)) throw new Error('Identity provider returned an invalid JWKS');
  await env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 3600 });
  return payload;
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifiedAppUserId(env: Env, projectId: string | number, authorization?: string): Promise<string | null> {
  const token = bearerToken(authorization);
  if (!token) return null;
  let decoded: ReturnType<typeof decodeJwt>;
  try {
    decoded = decodeJwt(token);
  } catch {
    throw new Error('Invalid identity token');
  }
  const issuer = typeof decoded.iss === 'string' ? decoded.iss : '';
  if (!issuer) throw new Error('Identity token issuer is missing');
  const config = await oidcConfig(env, projectId, issuer);
  if (!config) throw new Error('Identity provider is not configured for this project');
  const verify = (keys: JSONWebKeySet) => jwtVerify(token, createLocalJWKSet(keys), {
    issuer: config.issuer,
    audience: config.audience,
    clockTolerance: 5,
  });
  let verified;
  try {
    verified = await verify(await loadJwks(env, config.jwks_uri));
  } catch {
    verified = await verify(await loadJwks(env, config.jwks_uri, true));
  }
  const { payload } = verified;
  if (!payload.sub || payload.sub.length > 255) throw new Error('Identity token subject is invalid');
  return payload.sub;
}

export async function resolveSdkCustomer(env: Env, params: {
  projectId: string | number;
  authorization?: string;
  anonymousId?: string;
}) {
  const verified = await verifiedAppUserId(env, params.projectId, params.authorization);
  const anonymousId = (params.anonymousId || '').trim();
  const appUserId = verified || anonymousId;
  if (!appUserId) throw new Error('Authenticated user or anonymous ID required');
  if (!verified && !appUserId.startsWith('$opengrow_anon_')) throw new Error('Anonymous ID has an invalid prefix');
  const customer = await getOrCreateCustomer(env.DB, params.projectId, appUserId, !verified);
  if (!customer || Number(customer.blocked) === 1) throw new Error('Customer is blocked');
  return { customer, appUserId, identified: Boolean(verified) };
}

export async function signedCustomerInfo(env: Env, projectId: string | number, customerId: string) {
  const info = await customerInfo(env.DB, projectId, customerId);
  const secret = new TextEncoder().encode(env.PURCHASES_SIGNING_SECRET || env.JWT_SECRET);
  const signature = await new SignJWT({ customer_info: info, project_id: String(projectId) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('opengrow-purchases')
    .setAudience('opengrow-sdk')
    .setSubject(String(info.original_app_user_id))
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
  return { ...info, customer_id: customerId, signature };
}

export async function customerForAppUserId(env: Env, projectId: string | number, appUserId: string) {
  return findCustomerByAppUserId(env.DB, projectId, appUserId);
}
