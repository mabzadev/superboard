import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';

const appleMocks = vi.hoisted(() => ({
  read: vi.fn(),
  configure: vi.fn(),
  persist: vi.fn(),
}));

vi.mock('../lib/apple-notification-configuration', () => ({
  APPLE_NOTIFICATION_CONFIRMATION: 'configure_app_store_server_notifications_v2',
  readAppleNotificationConfiguration: appleMocks.read,
  configureAppleNotificationConfiguration: appleMocks.configure,
  persistAppleNotificationConfiguration: appleMocks.persist,
}));

import adminRoutes from './purchases-v2-admin';

const required = {
  production_url: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/production/20',
  sandbox_url: 'https://api.example.com/api/v2/purchases/providers/webhooks/apple/sandbox/21',
  production_version: 'V2' as const,
  sandbox_version: 'V2' as const,
};

const current = {
  provider: 'apple' as const,
  app_id: '123456789',
  bundle_id: 'com.example.app',
  current: {
    production_url: 'https://legacy.example.com',
    sandbox_url: 'https://legacy.example.com',
    production_version: 'V2',
    sandbox_version: 'V2',
  },
  required,
  checks: { production_url: false, sandbox_url: false, production_version: true, sandbox_version: true },
  ready: false,
};

beforeEach(() => {
  appleMocks.read.mockReset();
  appleMocks.configure.mockReset();
  appleMocks.persist.mockReset();
  appleMocks.read.mockResolvedValue(current);
  appleMocks.configure.mockResolvedValue({
    ...current,
    current: required,
    checks: { production_url: true, sandbox_url: true, production_version: true, sandbox_version: true },
    ready: true,
  });
});

describe('Apple notification administration', () => {
  it('requires an explicit confirmation before any provider read or mutation', async () => {
    const response = await adminRoutes.request('/10-prod/apple-server-notifications/configure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenGrow-Internal-Actor': '7',
      },
      body: '{}',
    }, baseEnv(projectDb()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'apple_notification_confirmation_required',
        retryable: false,
      },
    });
    expect(appleMocks.read).not.toHaveBeenCalled();
    expect(appleMocks.configure).not.toHaveBeenCalled();
  });

  it('updates both environments only after confirmation and records immutable audit events', async () => {
    const db = projectDb();
    const response = await adminRoutes.request('/10-prod/apple-server-notifications/configure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenGrow-Internal-Actor': '7',
      },
      body: JSON.stringify({ confirmation: 'configure_app_store_server_notifications_v2' }),
    }, baseEnv(db));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ changed: true, data: { ready: true } });
    expect(appleMocks.read).toHaveBeenCalledWith(expect.anything(), '20', '21');
    expect(appleMocks.configure).toHaveBeenCalledWith(expect.anything(), '20', '21');
    expect(appleMocks.persist).toHaveBeenCalledTimes(2);
    const auditActions = db.calls
      .filter((call) => call.op === 'run' && call.sql.includes('billing_admin_audit_logs'))
      .map((call) => call.args[3]);
    expect(auditActions).toEqual([
      'apple_server_notifications.configuration_requested',
      'apple_server_notifications.configured',
    ]);
  });
});

function projectDb() {
  return createFakeD1((call) => {
    if (call.op === 'first' && call.sql.includes('FROM instance_roles')) return { role: 'owner' };
    if (call.op === 'first' && call.sql.includes('SELECT id, name, identifier, instance_id, is_test FROM projects')) {
      return { id: 20, name: 'Production', identifier: 'production', instance_id: 10, is_test: 0 };
    }
    if (call.op === 'all' && call.sql.includes('SELECT id, is_test FROM projects')) {
      return [{ id: 20, is_test: 0 }, { id: 21, is_test: 1 }];
    }
    if (call.op === 'run' && call.sql.includes('billing_admin_audit_logs')) return true;
    return undefined;
  });
}

function baseEnv(db: D1Database): Env {
  return {
    DB: db,
    KV: {} as KVNamespace,
    ENVIRONMENT: 'production',
    API_DOMAIN: 'api.example.com',
    SHORTLINK_DOMAIN: 'go.example.com',
    SDK_DOMAIN: 'sdk.example.com',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'test',
    CREDENTIAL_KEY_SCOPE: 'billing',
    AUTH_GATEWAY_ISSUER: 'https://auth.example.com',
    AUTH_GATEWAY_AUDIENCE: 'opengrow',
    AUTH_GATEWAY_JWKS_URL: 'https://auth.example.com/.well-known/jwks.json',
  };
}
