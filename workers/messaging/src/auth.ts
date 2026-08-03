import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './types';

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function bearerToken(header: string | undefined): string | null {
  return /^Bearer\s+(.+)$/i.exec((header || '').trim())?.[1]?.trim() || null;
}

function remoteKeys(url: string) {
  const existing = jwksByUrl.get(url);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(url), {
    cooldownDuration: 30_000,
    cacheMaxAge: 3_600_000,
    timeoutDuration: 5_000,
  });
  jwksByUrl.set(url, created);
  return created;
}

export async function verifyApplicationIdentity(env: Env, authorization?: string): Promise<string> {
  const token = bearerToken(authorization);
  if (!token) throw publicError('identity_required', 'Identity token required', 401);
  try {
    const verified = await jwtVerify(token, remoteKeys(env.AUTH_GATEWAY_JWKS_URL), {
      issuer: env.AUTH_GATEWAY_ISSUER,
      audience: env.AUTH_GATEWAY_AUDIENCE,
      algorithms: ['ES256'],
      clockTolerance: 5,
    });
    const subject = verified.payload.sub || '';
    if (!subject || subject.length > 255) throw new Error('invalid subject');
    return subject;
  } catch {
    throw publicError('identity_invalid', 'Identity token is invalid or expired', 401);
  }
}

export function requireProject(env: Env, value: string | undefined): number {
  const projectId = Number(value);
  const allowed = env.ALLOWED_PROJECT_IDS.split(',').map(Number).filter(Number.isInteger);
  if (!Number.isInteger(projectId) || projectId <= 0 || !allowed.includes(projectId)) {
    throw publicError('project_not_allowed', 'Project is not enabled for Messaging', 403);
  }
  return projectId;
}

export function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % Math.max(a.length, 1)] || 0) ^ (b[index % Math.max(b.length, 1)] || 0);
  }
  return difference === 0;
}

export function requireInternal(env: Env, token?: string) {
  if (!env.INTERNAL_API_TOKEN || !token || !timingSafeEqual(env.INTERNAL_API_TOKEN, token)) {
    throw publicError('internal_auth_invalid', 'Internal service authentication failed', 401);
  }
}

export function publicError(code: string, message: string, status = 422) {
  return Object.assign(new Error(message), { code, status });
}
