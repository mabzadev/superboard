import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { configuredSecrets, constantTimeEqual, matchesAnySecret } from '@superboard/contracts/secret';
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

export type ApplicationIdentity = {
  subject: string;
  expiresAt: number;
};

export async function verifyApplicationIdentity(env: Env, authorization?: string): Promise<ApplicationIdentity> {
  const token = bearerToken(authorization);
  if (!token) throw publicError('identity_required', 'Identity token required', 401);
  try {
    const verified = await jwtVerify(token, remoteKeys(env.AUTH_GATEWAY_JWKS_URL), {
      issuer: env.AUTH_GATEWAY_ISSUER,
      audience: env.AUTH_GATEWAY_AUDIENCE,
      algorithms: ['ES256'],
      clockTolerance: 5,
      requiredClaims: ['sub', 'iat', 'exp', 'jti'],
    });
    return validateApplicationIdentityClaims(verified.payload);
  } catch {
    throw publicError('identity_invalid', 'Identity token is invalid or expired', 401);
  }
}

export function validateApplicationIdentityClaims(payload: JWTPayload): ApplicationIdentity {
  const subject = payload.sub || '';
  const issuedAt = Number(payload.iat);
  const expiresAt = Number(payload.exp);
  const tokenId = payload.jti || '';
  if (!subject || subject.length > 255) throw new Error('invalid subject');
  if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)
    || expiresAt <= issuedAt || expiresAt - issuedAt > 900) {
    throw new Error('invalid token lifetime');
  }
  if (!tokenId || tokenId.length > 128) throw new Error('invalid token id');
  return { subject, expiresAt: expiresAt * 1000 };
}

export function requireProject(env: Env, value: string | undefined): number {
  const projectId = Number(value);
  const allowed = parseAllowedProjectIds(env.ALLOWED_PROJECT_IDS);
  if (!Number.isInteger(projectId) || projectId <= 0 || !allowed.includes(projectId)) {
    throw publicError('project_not_allowed', 'Project is not enabled for Messaging', 403);
  }
  return projectId;
}

export function parseAllowedProjectIds(value: string): number[] {
  const values = value.split(',').map((item) => item.trim()).filter(Boolean);
  const parsed = values.map(Number);
  if (parsed.some((projectId) => !Number.isInteger(projectId) || projectId <= 0)) {
    throw publicError('messaging_configuration_invalid', 'Messaging project configuration is invalid', 503);
  }
  return [...new Set(parsed)];
}

export const timingSafeEqual = constantTimeEqual;

export async function requireInternal(env: Env, token?: string) {
  if (!token || !await matchesAnySecret(token, configuredSecrets(
    env.INTERNAL_API_TOKEN,
    env.INTERNAL_API_TOKEN_PREVIOUS,
  ))) {
    throw publicError('internal_auth_invalid', 'Internal service authentication failed', 401);
  }
}

export function publicError(code: string, message: string, status = 422) {
  return Object.assign(new Error(message), { code, status });
}
