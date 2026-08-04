import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppVariables, Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';

const mocks = vi.hoisted(() => ({
  resolveCustomer: vi.fn(),
  recordResult: vi.fn(),
}));

vi.mock('../lib/billing-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/billing-service')>();
  return { ...original, resolveCustomerFromBillingAuthority: mocks.resolveCustomer };
});

vi.mock('../lib/device-certification', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/device-certification')>();
  return { ...original, recordDeviceCertificationResult: mocks.recordResult };
});

import purchasesV2Sdk from './purchases-v2-sdk';

beforeEach(() => {
  mocks.resolveCustomer.mockReset();
  mocks.recordResult.mockReset();
  mocks.recordResult.mockResolvedValue({
    id: 'device-result-104', run_id: 'run-device-1',
    check_key: 'cross_platform.identity_sync', outcome: 'passed',
    evidence_sha256: 'a'.repeat(64), observed_at: '2026-08-04T12:00:00.000Z',
    received_at: '2026-08-04T12:00:01.000Z', duplicate: false,
  });
});

describe('Purchases SDK device certification route', () => {
  it('rejects an anonymous customer before recording evidence', async () => {
    mocks.resolveCustomer.mockResolvedValue({
      customer: { id: 'customer-1' }, appUserId: '$opengrow_anon_1', identified: false,
    });
    const response = await app().request('/certification/device-results', deviceRequest(), env());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'device_certification_identity_required', retryable: false },
    });
    expect(mocks.recordResult).not.toHaveBeenCalled();
  });

  it('binds the result to the verified customer and SDK application context', async () => {
    mocks.resolveCustomer.mockResolvedValue({
      customer: { id: 'customer-1' }, appUserId: 'user-1', identified: true,
    });
    const response = await app().request('/certification/device-results', deviceRequest(), env());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { id: 'device-result-104', duplicate: false } });
    expect(mocks.recordResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      customerId: 'customer-1', projectId: '11', sourcePlatform: 'ios',
      applicationIdentifier: 'com.example.app', buildNumber: '104',
      appVersion: '1.4.0', sdkVersion: '2.1.3',
    }));
  });
});

function app() {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('projectId', 11);
    c.set('sdkPlatform', 'ios');
    c.set('sdkIdentifier', 'com.example.app');
    await next();
  });
  app.route('', purchasesV2Sdk);
  return app;
}

function deviceRequest() {
  return new Request('https://sdk.example.com/certification/device-results', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer identity-token',
      'X-OpenGrow-App-Version': '1.4.0',
      'X-OpenGrow-Build-Number': '104',
      'X-OpenGrow-SDK-Version': '2.1.3',
    },
    body: JSON.stringify({
      id: 'device-result-104', run_id: 'run-device-1', challenge: 'challenge',
      check_key: 'cross_platform.identity_sync', outcome: 'passed',
      device_model: 'iPhone 16', os_version: '19.0',
      assertions: { authenticated_identity_verified: true, purchase_blocked_without_identity: true },
    }),
  });
}

function env(): Env {
  const db = createFakeD1((call) => {
    if (call.op === 'first' && call.sql.includes('FROM projects p')) return {
      id: 11, is_test: 1, purchases_enabled: 1, purchases_core: 1,
      paywalls: 1, growth: 1, web_billing: 0, virtual_currencies: 1,
    };
    return undefined;
  });
  return {
    DB: db,
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
