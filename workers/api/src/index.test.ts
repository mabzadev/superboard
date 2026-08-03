import { describe, expect, it, vi } from 'vitest';
import worker from './index';
import { Env } from './types';
import { createFakeD1, FakeD1Call } from './test/fake-d1';

function env(overrides: Partial<Env> = {}): Env {
  const db = createFakeD1((call: FakeD1Call) => {
    if (call.op === 'all' && call.sql.includes('FROM rpush_notifications rn JOIN rpush_apps ra')) return [];
    return undefined;
  });
  return {
    DB: db,
    KV: {} as any,
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

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.results[0].value;
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
