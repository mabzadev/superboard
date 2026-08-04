import { describe, expect, it, vi } from 'vitest';
import worker from './index';
import { Env } from './types';
import { createFakeD1, FakeD1Call } from './test/fake-d1';

function env(overrides: Partial<Env> = {}): Env {
  const db = createFakeD1((call: FakeD1Call) => {
    if (call.op === 'all' && call.sql.includes('FROM projects production')) return [];
    if (call.op === 'all' && call.sql.includes('FROM rpush_notifications rn JOIN rpush_apps ra')) return [];
    if (call.op === 'first' && call.sql.includes('FROM instances WHERE api_key = ?')) return { id: 10 };
    if (call.op === 'first' && call.sql.includes('FROM projects WHERE instance_id = ? AND is_test = ?')) return { id: 101 };
    if (call.op === 'first' && call.sql.includes('JOIN android_configurations')) return { id: 1 };
    if (call.op === 'first' && call.sql.includes('FROM projects WHERE id = ? AND instance_id = ?')) {
      return { id: 101, instance_id: 10, identifier: 'mobile-prod-key', is_test: 0 };
    }
    if (call.op === 'first' && call.sql.includes('FROM devices WHERE vendor = ?')) return null;
    return undefined;
  });
  return {
    DB: db,
    KV: { get: async () => null, put: async () => undefined } as any,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'index-secret',
    ...overrides,
  };
}

describe('Worker scheduled and queue handlers', () => {
  it.each([
    '/device_for_vendor_id?vendor_id=config-check',
    '/api/v1/sdk/device_for_vendor_id?vendor_id=config-check',
  ])('serves mobile SDK routes on the SDK domain at %s', async (pathname) => {
    const response = await worker.fetch?.(
      new Request(`https://sdk.test${pathname}`, {
        headers: {
          Host: 'sdk.test',
          'PROJECT-KEY': 'server-api-key',
          PLATFORM: 'android',
          IDENTIFIER: 'com.opengrow.android',
        },
      }),
      env(),
      {} as ExecutionContext,
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ last_seen: null });
  });

  it('returns 404 for SSO routes when the target disables SSO', async () => {
    const response = await worker.fetch?.(
      new Request('https://go.test/api/v1/identity/sso/auth/google_oauth2', { method: 'POST' }),
      env({ SSO_ENABLED: 'false' }),
      {} as ExecutionContext,
    );

    expect(response?.status).toBe(404);
  });

  it('enqueues maintenance work from the scheduled handler when a queue binding exists', async () => {
    const sent: unknown[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    const testEnv = env({
      MAINTENANCE_QUEUE: {
        send: async (message: unknown) => {
          sent.push(message);
        },
      } as any,
    });

    await worker.scheduled?.({} as any, testEnv, { waitUntil } as any);

    expect(waitUntil).toHaveBeenCalledTimes(2);
    await Promise.all(waitUntil.mock.results.map((result) => result.value));
    expect(sent).toEqual([{ type: 'maintenance.run', days: 3 }]);
  });

  it('acks queue messages after successful job dispatch', async () => {
    const message = {
      id: 'msg-1',
      body: { type: 'push.process', limit: 1 },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await worker.queue?.({ queue: 'opengrow-push', messages: [message] } as any, env(), {} as any);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('retries queue messages after failed job dispatch', async () => {
    const message = {
      id: 'msg-2',
      body: { type: 'unknown.job' },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await worker.queue?.({ queue: 'opengrow-maintenance', messages: [message] } as any, env(), {} as any);

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });
});
