import { Hono } from 'hono';
import { Env } from '../types';
import { hashPassword, verifyToken } from '../lib/crypto';
import { getOrCreateInstanceForUser } from '../lib/db';
import { isRegistrationAllowed, recordSuccessfulRegistration } from '../lib/deployment';
import { readRequestObjectLimited } from '@superboard/contracts/request-body';
import { timingSafeEqual } from '../lib/secrets';
import { readJsonObjectLimited } from '../lib/http-limits';
import { issueDbBackedTokens } from '../lib/auth';
import { tokenDigest } from '../lib/token-storage';

const sso = new Hono<{ Bindings: Env }>();
const STATE_TTL_SECONDS = 10 * 60;

async function readBody(c: any): Promise<Record<string, any>> {
  return readRequestObjectLimited(c.req.raw, 1024 * 1024);
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(normalized);
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function buildState(env: Env, provider: string) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ provider, ts: Math.floor(Date.now() / 1000) })));
  return `${payload}.${await hmacHex(env.JWT_SECRET, payload)}`;
}

async function validState(env: Env, state: string | null, provider?: string) {
  if (!state) return false;
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return false;
  if (!await timingSafeEqual(await hmacHex(env.JWT_SECRET, payload), signature)) return false;
  const decoded = JSON.parse(fromBase64Url(payload));
  if (provider && decoded.provider !== provider) return false;
  return Math.floor(Date.now() / 1000) - Number(decoded.ts || 0) <= STATE_TTL_SECONDS;
}

function requestOrigin(c: any) {
  if (c.env.SERVER_HOST && c.env.SERVER_HOST_PROTOCOL) return `${c.env.SERVER_HOST_PROTOCOL}${c.env.SERVER_HOST}`;
  if (c.env.API_DOMAIN) return `https://${c.env.API_DOMAIN}`;
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

function dashboardTarget(c: any) {
  if (c.env.SSO_AUTHENTICATION_ENDPOINT) return String(c.env.SSO_AUTHENTICATION_ENDPOINT);
  if (c.env.APP_URL) return String(c.env.APP_URL).replace(/\/$/, '');
  if (c.env.REACT_HOST) return `${c.env.REACT_HOST_PROTOCOL || 'https://'}${c.env.REACT_HOST}`.replace(/\/$/, '');
  return requestOrigin(c);
}

function callbackUrl(c: any, provider: string) {
  return `${requestOrigin(c)}/api/v1/identity/sso/auth/${provider}/callback`;
}

function authUrl(c: any, provider: string, state: string) {
  if (provider === 'google_oauth2') {
    const clientId = c.env.GOOGLE_CLIENT_ID;
    if (!clientId || !c.env.GOOGLE_CLIENT_SECRET) return null;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl(c, provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email');
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('state', state);
    return url.toString();
  }

  if (provider === 'microsoft_graph') {
    const clientId = c.env.MICROSOFT_CLIENT_ID;
    if (!clientId || !c.env.MICROSOFT_CLIENT_SECRET) return null;
    const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl(c, provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile email offline_access user.read contacts.read Directory.Read.All');
    url.searchParams.set('state', state);
    return url.toString();
  }

  throw new Error('Invalid provider');
}

function tokenEndpoint(provider: string) {
  return provider === 'google_oauth2'
    ? 'https://oauth2.googleapis.com/token'
    : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
}

function userInfoEndpoint(provider: string) {
  return provider === 'google_oauth2'
    ? 'https://www.googleapis.com/oauth2/v3/userinfo'
    : 'https://graph.microsoft.com/v1.0/me';
}

async function exchangeCode(c: any, provider: string, code: string) {
  const clientId = provider === 'google_oauth2' ? c.env.GOOGLE_CLIENT_ID : c.env.MICROSOFT_CLIENT_ID;
  const clientSecret = provider === 'google_oauth2' ? c.env.GOOGLE_CLIENT_SECRET : c.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error(`${provider} is not configured`);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: callbackUrl(c, provider),
  });
  const response = await fetch(tokenEndpoint(provider), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload: any = await readJsonObjectLimited(
    response,
    262_144,
    'SSO token response is too large',
  ).catch((): Record<string, unknown> => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'SSO token exchange failed');
  }
  return payload.access_token as string;
}

async function fetchProfile(provider: string, accessToken: string) {
  const response = await fetch(userInfoEndpoint(provider), {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const payload: any = await readJsonObjectLimited(
    response,
    262_144,
    'SSO profile response is too large',
  ).catch((): Record<string, unknown> => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error?.message || 'SSO profile fetch failed');

  if (provider === 'google_oauth2') {
    return { uid: String(payload.sub || ''), email: String(payload.email || '').toLowerCase(), name: payload.name || payload.email || null };
  }
  return {
    uid: String(payload.id || ''),
    email: String(payload.mail || payload.userPrincipalName || '').toLowerCase(),
    name: payload.displayName || payload.mail || payload.userPrincipalName || null,
  };
}

async function oauthApplicationId(db: D1Database, clientId: string) {
  const existing = await db.prepare(`
    SELECT id FROM oauth_applications
    WHERE uid = ? OR name = 'React'
    ORDER BY CASE WHEN uid = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(clientId, clientId).first<{ id: number }>();
  if (existing) return existing.id;
  const created = await db.prepare(`
    INSERT INTO oauth_applications (name, uid, secret, redirect_uri, scopes)
    VALUES ('React', ?, ?, 'urn:ietf:wg:oauth:2.0:oob', 'read write')
    RETURNING id
  `).bind(clientId, await tokenDigest(crypto.randomUUID())).first<{ id: number }>();
  if (!created) throw new Error('Unable to create OAuth application');
  return created.id;
}

async function findOrCreateUser(c: any, provider: string, profile: { uid: string; email: string; name: string | null }) {
  if (!profile.email || !profile.uid) throw new Error('SSO provider did not return email or uid');
  if (!await isRegistrationAllowed(c.env, profile.email)) {
    throw new Error('This email is not authorized for this SuperBoard deployment.');
  }
  const existing = await c.env.DB.prepare('SELECT id, provider FROM users WHERE email = ? LIMIT 1').bind(profile.email).first() as any;
  if (existing) {
    if (existing.provider && existing.provider !== provider) {
      throw new Error('This email is associated with a different login method.');
    }
    await c.env.DB.prepare('UPDATE users SET provider = ?, uid = ?, name = COALESCE(?, name), updated_at = datetime("now") WHERE id = ?')
      .bind(provider, profile.uid, profile.name, existing.id).run();
    return Number(existing.id);
  }

  const placeholder = await hashPassword(crypto.randomUUID());
  const created = await c.env.DB.prepare(`
    INSERT INTO users (email, password_hash, encrypted_password, name, provider, uid, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    RETURNING id
  `).bind(profile.email, placeholder, placeholder, profile.name, provider, profile.uid).first() as { id: number } | null;
  if (!created) throw new Error('Unable to create SSO user');
  await recordSuccessfulRegistration(c.env, profile.email);
  return created.id;
}

async function issueDashboardTokens(c: any, userId: number) {
  const instanceId = await getOrCreateInstanceForUser(c.env.DB, userId, 'sso', true);
  const appId = await oauthApplicationId(c.env.DB, c.env.DASHBOARD_CLIENT_ID);
  const issued = await issueDbBackedTokens(c.env, userId, instanceId, appId);
  return { token: issued.access_token, refresh_token: issued.refresh_token };
}

function redirectWith(c: any, params: Record<string, string>) {
  const url = new URL(dashboardTarget(c));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return c.redirect(url.toString(), 302);
}

sso.post('/auth/:provider', async (c) => {
  const provider = c.req.param('provider');
  let url: string | null;
  try {
    url = authUrl(c, provider, await buildState(c.env, provider));
  } catch (error: any) {
    return c.json({ error: error?.message || 'Invalid provider' }, 422);
  }
  if (!url) return c.json({ error: `${provider} SSO is not configured` }, 503);
  return c.json({ redirect_url: url });
});

sso.get('/auth/:provider/callback', async (c) => {
  return handleCallback(c, c.req.param('provider'), c.req.query('code'), c.req.query('state') || null);
});

async function handleCallback(c: any, provider: string, code: string | undefined, state: string | null) {
  if (!code) return redirectWith(c, { error: 'Missing authorization code' });
  if (!await validState(c.env, state, provider)) return redirectWith(c, { error: 'Invalid or expired OAuth state' });
  try {
    const accessToken = await exchangeCode(c, provider, code);
    const profile = await fetchProfile(provider, accessToken);
    const userId = await findOrCreateUser(c, provider, profile);
    return redirectWith(c, await issueDashboardTokens(c, userId));
  } catch (error: any) {
    console.warn('sso_callback_failed', error?.message || String(error));
    return redirectWith(c, { error: error?.message || 'SSO authentication failed' });
  }
}

sso.post('/auth/:provider/callback', async (c) => {
  const body = await readBody(c);
  return handleCallback(c, c.req.param('provider'), body.code || c.req.query('code'), body.state || c.req.query('state') || null);
});

sso.get('/auth/failure', (c) => redirectWith(c, { error: 'SSO authentication failed' }));

sso.post('/tokens/refresh', async (c) => {
  const body = await readBody(c);
  const refreshToken = String(body.refresh_token || '');
  if (!refreshToken) return c.json({ error: 'refresh_token is required' }, 400);
  const refreshDigest = await tokenDigest(refreshToken);
  const stored = await c.env.DB.prepare(`
    SELECT id, resource_owner_id
    FROM oauth_access_tokens
    WHERE (refresh_token = ? OR refresh_token = ?)
      AND revoked_at IS NULL
      AND datetime(created_at) >= datetime('now', '-7 days')
    LIMIT 1
  `).bind(refreshDigest, refreshToken).first<{ id: number; resource_owner_id: number }>();
  if (!stored || !await verifyToken(refreshToken, c.env)) return c.json({ error: 'Token not valid' }, 401);
  await c.env.DB.prepare("UPDATE oauth_access_tokens SET revoked_at = datetime('now') WHERE id = ?").bind(stored.id).run();
  return c.json(await issueDashboardTokens(c, Number(stored.resource_owner_id)));
});

export default sso;
