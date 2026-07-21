import { Env } from '../types';
import { signToken, verifyToken } from './crypto';

export type AuthContext = {
  token: string;
  userId: number;
  instanceId: number | null;
  applicationId: number | null;
  scopes: string;
  source: 'oauth' | 'jwt';
  payload: Record<string, unknown>;
};

type StoredOAuthToken = {
  resource_owner_id: number;
  application_id: number | null;
  expires_in: number | null;
  revoked_at: string | null;
  scopes: string | null;
  created_at: string;
};

export function bearerToken(authHeader: string | undefined | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((authHeader || '').trim());
  return match?.[1]?.trim() || null;
}

export function oauthTokenExpired(row: { expires_in?: number | null; created_at?: string | null }): boolean {
  if (!row.expires_in || row.expires_in <= 0 || !row.created_at) return false;
  const createdMs = Date.parse(row.created_at);
  if (!Number.isFinite(createdMs)) return false;
  return createdMs + row.expires_in * 1000 <= Date.now();
}

export async function ensureDefaultOAuthApplication(
  db: D1Database,
  clientId = 'opengrow-vocostar',
): Promise<number> {
  const existing = await db.prepare(
    'SELECT id FROM oauth_applications WHERE uid = ? LIMIT 1'
  ).bind(clientId).first<{ id: number }>();
  if (existing) return existing.id;

  const created = await db.prepare(`
    INSERT INTO oauth_applications (name, uid, secret, redirect_uri, scopes)
    VALUES ('OpenGrow Dashboard', ?, ?, 'urn:ietf:wg:oauth:2.0:oob', 'read write')
    RETURNING id
  `).bind(clientId, crypto.randomUUID()).first<{ id: number }>();
  if (!created) throw new Error('Unable to create OAuth application');
  return created.id;
}

export async function issueDbBackedTokens(
  env: Env,
  userId: number,
  instanceId: number | null | undefined,
  applicationId: number,
  scopes = 'read write',
) {
  const accessToken = await signToken({ sub: userId, instanceId: instanceId ?? null, type: 'access' }, env, '2h');
  const refreshToken = await signToken({ sub: userId, instanceId: instanceId ?? null, type: 'refresh' }, env, '7d');

  await env.DB.prepare(`
    INSERT INTO oauth_access_tokens (
      resource_owner_id, application_id, token, refresh_token, expires_in, scopes
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(userId, applicationId, accessToken, refreshToken, 7200, scopes).run();

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 7200,
    refresh_token: refreshToken,
    scope: scopes,
    created_at: Math.floor(Date.now() / 1000),
  };
}

async function primaryInstanceId(db: D1Database, userId: number): Promise<number | null> {
  const role = await db.prepare(
    'SELECT instance_id FROM instance_roles WHERE user_id = ? ORDER BY id ASC LIMIT 1'
  ).bind(userId).first<{ instance_id: number }>().catch(() => null);
  return role?.instance_id ?? null;
}

export async function getAuthContext(
  env: Env,
  authHeader: string | undefined | null,
  options: { allowJwtFallback?: boolean } = {},
): Promise<AuthContext | null> {
  const token = bearerToken(authHeader);
  if (!token) return null;

  const stored = await env.DB.prepare(`
    SELECT resource_owner_id, application_id, expires_in, revoked_at, scopes, created_at
    FROM oauth_access_tokens
    WHERE token = ?
    LIMIT 1
  `).bind(token).first<StoredOAuthToken>().catch(() => null);

  if (stored) {
    if (stored.revoked_at || oauthTokenExpired(stored)) return null;
    const payload = await verifyToken(token, env).catch(() => null);
    if (!payload) return null;
    const tokenType = typeof payload.type === 'string' ? payload.type : 'access';
    if (tokenType !== 'access') return null;
    const userId = Number(stored.resource_owner_id);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    const instanceId = Number(payload.instanceId) || await primaryInstanceId(env.DB, userId);
    return {
      token,
      userId,
      instanceId: instanceId || null,
      applicationId: stored.application_id ? Number(stored.application_id) : null,
      scopes: stored.scopes || 'read write',
      source: 'oauth',
      payload,
    };
  }

  if (!options.allowJwtFallback) return null;
  const payload = await verifyToken(token, env).catch(() => null);
  const userId = Number(payload?.sub);
  if (!payload || !Number.isFinite(userId) || userId <= 0) return null;
  const instanceId = Number(payload.instanceId) || await primaryInstanceId(env.DB, userId);
  return {
    token,
    userId,
    instanceId: instanceId || null,
    applicationId: null,
    scopes: 'read write',
    source: 'jwt',
    payload,
  };
}

export async function getAuthUserId(env: Env, authHeader: string | undefined | null): Promise<number | null> {
  const context = await getAuthContext(env, authHeader);
  return context?.userId ?? null;
}
