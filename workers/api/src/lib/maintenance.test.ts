import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateQuotaStates } from './maintenance';
import { Env } from '../types';
import { createFakeD1, FakeD1Call } from '../test/fake-d1';

function envForQuota(options: {
  currentMau: number;
  freeMau: number;
  lastWarning?: string | null;
  lastExceeded?: string | null;
  ownerEmails?: string[];
}) {
  const updates: any[] = [];
  const instances = [{
    id: 10,
    uri_scheme: 'prodapp',
    quota_exceeded: 0,
    last_quota_warning_sent_at: options.lastWarning || null,
    last_quota_exceeded_sent_at: options.lastExceeded || null,
  }];

  const db = createFakeD1((call: FakeD1Call) => {
    const { op, sql, args } = call;
    if (op === 'all' && sql === 'SELECT id, uri_scheme, quota_exceeded, last_quota_warning_sent_at, last_quota_exceeded_sent_at FROM instances') {
      return instances;
    }
    if (op === 'first' && sql.includes('SELECT COUNT(DISTINCT e.device_id) AS total')) {
      return { total: options.currentMau };
    }
    if (op === 'all' && sql.includes('FROM instance_roles ir JOIN users u')) {
      return (options.ownerEmails || []).map((email) => ({ email }));
    }
    if (op === 'run' && sql.startsWith('UPDATE instances SET quota_exceeded = ?')) {
      updates.push({ kind: 'quota_exceeded', value: args[0], instanceId: args[1] });
      return true;
    }
    if (op === 'run' && sql.includes('last_quota_exceeded_sent_at')) {
      updates.push({ kind: 'last_quota_exceeded_sent_at', instanceId: args[0] });
      return true;
    }
    if (op === 'run' && sql.includes('last_quota_warning_sent_at')) {
      updates.push({ kind: 'last_quota_warning_sent_at', instanceId: args[0] });
      return true;
    }
    return undefined;
  });

  const env = {
    DB: db,
    KV: {} as any,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'quota-secret',
    FREE_MAU_COUNT: String(options.freeMau),
    MAIL_PROVIDER: 'webhook',
    MAIL_WEBHOOK_URL: 'https://mail.test/send',
  } satisfies Env;

  return { env, updates };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quota maintenance', () => {
  it('flags instances as quota exceeded when current MAU is above the free limit', async () => {
    const { env, updates } = envForQuota({ currentMau: 12, freeMau: 10 });

    const result = await updateQuotaStates(env);

    expect(result).toMatchObject({ checked: 1, exceeded: 1, warnings: 0, emailsSent: 0, emailsSkipped: 1 });
    expect(updates).toContainEqual({ kind: 'quota_exceeded', value: 1, instanceId: 10 });
  });

  it('gates quota warning emails when a warning was sent recently', async () => {
    const { env, updates } = envForQuota({
      currentMau: 8,
      freeMau: 10,
      lastWarning: new Date().toISOString(),
      ownerEmails: ['owner@example.com'],
    });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'mail-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await updateQuotaStates(env);

    expect(result).toMatchObject({ checked: 1, exceeded: 0, warnings: 1, emailsSent: 0, emailsSkipped: 0 });
    expect(updates).toEqual([{ kind: 'quota_exceeded', value: 0, instanceId: 10 }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends quota exceeded email and records the send timestamp when the gate allows it', async () => {
    const { env, updates } = envForQuota({
      currentMau: 12,
      freeMau: 10,
      lastExceeded: '2026-01-01T00:00:00.000Z',
      ownerEmails: ['owner@example.com'],
    });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'mail-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await updateQuotaStates(env);

    expect(result).toMatchObject({ checked: 1, exceeded: 1, warnings: 0, emailsSent: 1, emailsSkipped: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual({ kind: 'last_quota_exceeded_sent_at', instanceId: 10 });
  });
});
