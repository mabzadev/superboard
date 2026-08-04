import { describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import adminRoutes from './purchases-v2-admin';

describe('device certification administration', () => {
  it('creates a run with an expiring plaintext-once device challenge', async () => {
    const db = certificationDb();
    const response = await adminRoutes.request('/10-prod/certification-runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenGrow-Internal-Actor': '7',
      },
      body: JSON.stringify({
        platform: 'ios', environment: 'sandbox', build_number: '104',
        app_version: '1.4.0', sdk_version: '2.1.3',
        device_model: 'iPhone 16', os_version: '19.0',
      }),
    }, baseEnv(db));

    expect(response.status).toBe(201);
    const payload = await response.json() as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      id: 'run-device-1', target_project_id: '21',
      device_result_endpoint: 'https://sdk.example.com/purchases/v2/certification/device-results',
    });
    expect(payload.data.device_claim_token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(payload.data).not.toHaveProperty('challenge_hash');

    const challengeInsert = db.calls.find((call) =>
      call.op === 'run' && call.sql.includes('INSERT INTO billing_certification_device_challenges'))!;
    expect(challengeInsert.args[1]).toMatch(/^[a-f0-9]{64}$/u);
    expect(challengeInsert.args[1]).not.toBe(payload.data.device_claim_token);
    const audit = db.calls.find((call) => call.op === 'run' && call.sql.includes('billing_admin_audit_logs'))!;
    expect(String(audit.args[6])).not.toContain(String(payload.data.device_claim_token));
  });
});

function certificationDb() {
  return createFakeD1((call) => {
    if (call.op === 'first' && call.sql.includes('FROM instance_roles')) return { role: 'owner' };
    if (call.op === 'first' && call.sql.includes('SELECT id, name, identifier, instance_id, is_test FROM projects')) {
      return { id: 20, name: 'Production', identifier: 'production', instance_id: 10, is_test: 0 };
    }
    if (call.op === 'all' && call.sql.includes('SELECT id, is_test FROM projects')) {
      return [{ id: 20, is_test: 0 }, { id: 21, is_test: 1 }];
    }
    if (call.op === 'first' && call.sql.includes('INSERT INTO billing_certification_runs')) {
      return {
        id: 'run-device-1', release_project_id: '20', target_project_id: '21',
        environment: 'sandbox', platform: 'ios', build_number: '104',
        app_version: '1.4.0', sdk_version: '2.1.3', device_model: 'iPhone 16',
        os_version: '19.0', status: 'running', started_at: '2026-08-04 12:00:00',
      };
    }
    if (call.op === 'run') return true;
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
