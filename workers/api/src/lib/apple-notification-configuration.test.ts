import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store-verification', () => ({
  appStoreConnectAccess: vi.fn(async () => ({
    token: 'apple-token',
    appId: '123456789',
    bundleId: 'com.example.app',
  })),
}));

import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import {
  configureAppleNotificationConfiguration,
  persistAppleNotificationConfiguration,
  readAppleNotificationConfiguration,
  refreshAppleNotificationConfigurationsIfDue,
  requiredAppleNotificationUrls,
} from './apple-notification-configuration';

afterEach(() => vi.unstubAllGlobals());

describe('Apple notification configuration', () => {
  it('builds project-scoped HTTPS ingress URLs for both environments', () => {
    expect(requiredAppleNotificationUrls('api.example.com', '20', '21')).toEqual({
      production_url: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/production/20',
      sandbox_url: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/sandbox/21',
      production_version: 'V2',
      sandbox_version: 'V2',
    });
    expect(() => requiredAppleNotificationUrls('http://api.example.com', '20', '21'))
      .toThrow('public API domain must be an HTTPS origin');
  });

  it('reports every current-versus-required mismatch without mutating App Store Connect', async () => {
    const fetch = vi.fn(async () => Response.json({
      data: {
        type: 'apps',
        id: '123456789',
        attributes: {
          subscriptionStatusUrl: 'https://legacy.example.com/production',
          subscriptionStatusUrlForSandbox: 'https://legacy.example.com/sandbox',
          subscriptionStatusUrlVersion: 'V2',
          subscriptionStatusUrlVersionForSandbox: 'V1',
        },
      },
    }));
    vi.stubGlobal('fetch', fetch);

    const result = await readAppleNotificationConfiguration(baseEnv(), '20', '21');

    expect(result.ready).toBe(false);
    expect(result.current.production_url).toBe('https://legacy.example.com');
    expect(result.current.sandbox_url).toBe('https://legacy.example.com');
    expect(result.checks).toEqual({
      production_url: false,
      sandbox_url: false,
      production_version: true,
      sandbox_version: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]?.method).toBeUndefined();
  });

  it('patches both V2 URLs in one explicit provider update and verifies the result', async () => {
    let configured = false;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, any>;
        expect(body).toEqual({
          data: {
            type: 'apps',
            id: '123456789',
            attributes: {
              subscriptionStatusUrl: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/production/20',
              subscriptionStatusUrlForSandbox: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/sandbox/21',
              subscriptionStatusUrlVersion: 'V2',
              subscriptionStatusUrlVersionForSandbox: 'V2',
            },
          },
        });
        configured = true;
        return Response.json(body);
      }
      expect(configured).toBe(true);
      return Response.json({
        data: {
          attributes: {
            subscriptionStatusUrl: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/production/20',
            subscriptionStatusUrlForSandbox: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/sandbox/21',
            subscriptionStatusUrlVersion: 'V2',
            subscriptionStatusUrlVersionForSandbox: 'V2',
          },
        },
      });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(configureAppleNotificationConfiguration(baseEnv(), '20', '21'))
      .resolves.toMatchObject({ ready: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]?.headers).toBeInstanceOf(Headers);
    expect((fetch.mock.calls[0][1]?.headers as Headers).get('Authorization')).toBe('Bearer apple-token');
  });

  it('persists only normalized configuration and readiness evidence', async () => {
    let argumentsList: unknown[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            expect(sql).toContain('billing_store_notification_configurations');
            argumentsList = args;
          },
        }),
      }),
    } as unknown as D1Database;
    const required = requiredAppleNotificationUrls('api.example.com', '20', '21');
    await persistAppleNotificationConfiguration(db, '20', {
      provider: 'apple',
      app_id: '123456789',
      bundle_id: 'com.example.app',
      current: {
        production_url: required.production_url,
        sandbox_url: required.sandbox_url,
        production_version: 'V2',
        sandbox_version: 'V2',
      },
      required,
      checks: { production_url: true, sandbox_url: true, production_version: true, sandbox_version: true },
      ready: true,
    });
    expect(argumentsList).toEqual([
      '20',
      1,
      JSON.stringify({
        production_url: required.production_url,
        sandbox_url: required.sandbox_url,
        production_version: 'V2',
        sandbox_version: 'V2',
      }),
      JSON.stringify(required),
      1,
    ]);
  });

  it('refreshes configured projects once per six-hour period', async () => {
    const values = new Map<string, string>();
    const fetch = vi.fn(async () => Response.json({
      data: {
        attributes: {
          subscriptionStatusUrl: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/production/20',
          subscriptionStatusUrlForSandbox: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/sandbox/21',
          subscriptionStatusUrlVersion: 'V2',
          subscriptionStatusUrlVersionForSandbox: 'V2',
        },
      },
    }));
    vi.stubGlobal('fetch', fetch);
    const db = createFakeD1((call) => {
      if (call.op === 'all' && call.sql.includes('FROM projects production')) {
        return [{ production_project_id: 20, sandbox_project_id: 21 }];
      }
      if (call.op === 'run' && call.sql.includes('billing_store_notification_configurations')) return true;
      return undefined;
    });
    const env = {
      ...baseEnv(),
      DB: db,
      KV: {
        get: async (key: string) => values.get(key) || null,
        put: async (key: string, value: string) => { values.set(key, value); },
      } as unknown as KVNamespace,
    };
    const now = new Date('2026-08-04T07:00:00Z');

    await expect(refreshAppleNotificationConfigurationsIfDue(env, now)).resolves.toEqual({
      checked: 1,
      ready: 1,
      failures: [],
      skipped: false,
    });
    await expect(refreshAppleNotificationConfigurationsIfDue(env, now)).resolves.toMatchObject({ skipped: true });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

function baseEnv(): Env {
  return {
    DB: {} as D1Database,
    KV: {} as KVNamespace,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.example.com',
    API_DOMAIN: 'api.example.com',
    SDK_DOMAIN: 'sdk.example.com',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'test',
    AUTH_GATEWAY_ISSUER: 'https://auth.example.com',
    AUTH_GATEWAY_AUDIENCE: 'opengrow',
    AUTH_GATEWAY_JWKS_URL: 'https://auth.example.com/.well-known/jwks.json',
  };
}
