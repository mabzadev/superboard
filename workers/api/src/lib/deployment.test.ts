import { describe, expect, it } from 'vitest';
import { createFakeD1 } from '../test/fake-d1';
import { Env } from '../types';
import {
  isFullAccess,
  isPurchasesEnabled,
  isRegistrationAllowed,
  normalizeRegistrationEmail,
  recordSuccessfulRegistration,
} from './deployment';

function environment(options: {
  realm?: string;
  rows?: Array<{ realm: string; email: string; active: number }>;
  mode?: 'allowlist' | 'public';
  accessMode?: 'full' | 'metered';
}) {
  const rows = options.rows || [];
  const db = createFakeD1(({ op, sql, args }) => {
    if (op === 'first' && sql.includes('FROM registration_allowlist')) {
      const row = rows.find((candidate) =>
        candidate.realm === args[0] && candidate.email === args[1] && candidate.active === 1
      );
      return row ? { allowed: 1 } : null;
    }
    if (op === 'run' && sql.startsWith('UPDATE registration_allowlist')) return true;
    return undefined;
  });
  return {
    DB: db,
    KV: {} as KVNamespace,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'test-secret',
    REGISTRATION_MODE: options.mode || 'allowlist',
    REGISTRATION_REALM: options.realm,
    OPENGROW_ACCESS_MODE: options.accessMode,
  } satisfies Env;
}

describe('deployment access policy', () => {
  it('normalizes registration emails consistently', () => {
    expect(normalizeRegistrationEmail('  Owner@Example.COM ')).toBe('owner@example.com');
  });

  it('allows an active email case-insensitively in its exact realm', async () => {
    const env = environment({
      realm: 'vocostar:production',
      rows: [{ realm: 'vocostar:production', email: 'owner@example.com', active: 1 }],
    });
    await expect(isRegistrationAllowed(env, ' Owner@Example.com ')).resolves.toBe(true);
  });

  it('denies absent, revoked, and cross-realm emails', async () => {
    const env = environment({
      realm: 'other:production',
      rows: [
        { realm: 'vocostar:production', email: 'owner@example.com', active: 1 },
        { realm: 'other:production', email: 'revoked@example.com', active: 0 },
      ],
    });
    await expect(isRegistrationAllowed(env, 'owner@example.com')).resolves.toBe(false);
    await expect(isRegistrationAllowed(env, 'revoked@example.com')).resolves.toBe(false);
    await expect(isRegistrationAllowed(env, 'missing@example.com')).resolves.toBe(false);
  });

  it('fails closed when an allowlist realm is missing', async () => {
    await expect(isRegistrationAllowed(environment({}), 'owner@example.com')).resolves.toBe(false);
  });

  it('keeps public-mode compatibility without reading D1', async () => {
    await expect(isRegistrationAllowed(environment({ mode: 'public' }), 'any@example.com')).resolves.toBe(true);
  });

  it('records successful allowlisted registrations in the normalized realm entry', async () => {
    const env = environment({ realm: 'vocostar:production' });
    await recordSuccessfulRegistration(env, ' Owner@Example.com ');
    const update = env.DB.calls.find((call) => call.op === 'run');
    expect(update?.args).toEqual(['vocostar:production', 'owner@example.com']);
  });

  it('detects full access explicitly', () => {
    expect(isFullAccess(environment({ accessMode: 'full' }))).toBe(true);
    expect(isFullAccess(environment({ accessMode: 'metered' }))).toBe(false);
  });

  it('keeps Purchases enabled throughout Full Access deployments', () => {
    expect(isPurchasesEnabled(environment({ accessMode: 'full' }), 0)).toBe(true);
    expect(isPurchasesEnabled(environment({ accessMode: 'full' }), null)).toBe(true);
    expect(isPurchasesEnabled(environment({ accessMode: 'metered' }), 1)).toBe(true);
    expect(isPurchasesEnabled(environment({ accessMode: 'metered' }), 0)).toBe(false);
  });
});
