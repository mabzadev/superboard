import { describe, expect, it } from 'vitest';
import { bearerToken, getAuthContext, oauthTokenExpired } from './auth';
import { signToken } from './crypto';
import { Env } from '../types';

function envWithOAuthRow(row: any | null): Env {
  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            first: async () => (sql.includes('FROM oauth_access_tokens') ? row : null),
            run: async () => ({ meta: { changes: 0 } }),
            all: async () => ({ results: [] }),
          };
        },
        first: async () => null,
      };
    },
  };
  return {
    DB: db as any,
    KV: {} as any,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'unit-test-secret',
  };
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    resource_owner_id: 7,
    application_id: 1,
    expires_in: 7200,
    revoked_at: null,
    scopes: 'read write',
    created_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe('auth helpers', () => {
  it('extracts bearer tokens case-insensitively', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer xyz')).toBe('xyz');
    expect(bearerToken('Basic abc')).toBeNull();
  });

  it('detects oauth DB expiry from created_at plus expires_in', () => {
    expect(oauthTokenExpired({ created_at: new Date(Date.now() - 3 * 3600_000).toISOString(), expires_in: 7200 })).toBe(true);
    expect(oauthTokenExpired({ created_at: new Date(Date.now() - 60_000).toISOString(), expires_in: 7200 })).toBe(false);
  });

  it('accepts a stored, unexpired, signed access token', async () => {
    const env = envWithOAuthRow(tokenRow());
    const token = await signToken({ sub: 7, instanceId: 11, type: 'access' }, env, '2h');
    const context = await getAuthContext(envWithOAuthRow(tokenRow()), `Bearer ${token}`);
    expect(context?.userId).toBe(7);
    expect(context?.instanceId).toBe(11);
    expect(context?.source).toBe('oauth');
  });

  it('rejects revoked tokens even when the JWT signature is valid', async () => {
    const env = envWithOAuthRow(tokenRow({ revoked_at: new Date().toISOString() }));
    const token = await signToken({ sub: 7, instanceId: 11, type: 'access' }, env, '2h');
    await expect(getAuthContext(env, `Bearer ${token}`)).resolves.toBeNull();
  });

  it('rejects DB-expired tokens even when the JWT signature is valid', async () => {
    const env = envWithOAuthRow(tokenRow({
      created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      expires_in: 7200,
    }));
    const token = await signToken({ sub: 7, instanceId: 11, type: 'access' }, env, '2h');
    await expect(getAuthContext(env, `Bearer ${token}`)).resolves.toBeNull();
  });

  it('rejects bare JWT fallback by default when no DB token exists', async () => {
    const env = envWithOAuthRow(null);
    const token = await signToken({ sub: 7, instanceId: 11, type: 'access' }, env, '2h');
    await expect(getAuthContext(env, `Bearer ${token}`)).resolves.toBeNull();
  });
});
