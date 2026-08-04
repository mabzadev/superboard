import { describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import adminRoutes from './purchases-v2-admin';

describe('legacy inventory administration', () => {
  it('cancels only an active project-scoped inventory and records an audit event', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM instance_roles')) return { role: 'owner' };
      if (call.op === 'first' && call.sql.includes('SELECT id, name, identifier, instance_id, is_test FROM projects')) {
        return { id: 20, name: 'Production', identifier: 'production', instance_id: 10, is_test: 0 };
      }
      if (call.op === 'first' && call.sql.includes('UPDATE billing_legacy_inventory_runs')) {
        return { id: 'inventory-1', environment: 'production', status: 'cancelled', completed_at: '2026-08-04 12:00:00' };
      }
      if (call.op === 'run') return true;
      return undefined;
    });

    const response = await adminRoutes.request('/10-prod/legacy/revenuecat/inventory-runs/inventory-1/cancel', {
      method: 'POST',
      headers: { 'X-OpenGrow-Internal-Actor': '7' },
    }, baseEnv(db));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'inventory-1', status: 'cancelled' },
    });
    const cancellation = db.calls.find((call) => call.op === 'first' && call.sql.includes('UPDATE billing_legacy_inventory_runs'))!;
    expect(cancellation.sql).toContain("status IN ('queued', 'running')");
    expect(cancellation.args).toEqual(['inventory-1', '20']);
    const audit = db.calls.find((call) => call.op === 'run' && call.sql.includes('billing_admin_audit_logs'))!;
    expect(audit.args).toContain('legacy_inventory.cancelled');
  });
});

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
