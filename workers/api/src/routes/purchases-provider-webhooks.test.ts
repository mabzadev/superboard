import { describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { encryptCredential } from '../lib/secrets';
import { createFakeD1 } from '../test/fake-d1';
import webhookRoutes from './purchases-provider-webhooks';

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function stripeSignature(secret: string, payload: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return `t=${timestamp},v1=${hex(digest)}`;
}

function envWithDb(db: D1Database, overrides: Partial<Env> = {}) {
  return {
    DB: db,
    STORE_CREDENTIALS_ENCRYPTION_KEY: 'test-store-credential-key',
    ENVIRONMENT: 'test',
    ...overrides,
  } as Env;
}

describe('Purchases provider webhooks', () => {
  it('returns the stable public error contract when a Stripe connection is missing', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_store_connections')) return null;
      return undefined;
    });
    const response = await webhookRoutes.request('/missing', {
      method: 'POST',
      headers: { 'cf-ray': 'stripe-missing-test' },
      body: '{}',
    }, envWithDb(db));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: 'store_connection_not_found',
      message: 'Store connection was not found',
      retryable: false,
      request_id: 'stripe-missing-test',
    });
  });

  it('rejects an invalid Stripe signature with a non-retryable public error', async () => {
    const env = envWithDb({} as D1Database);
    const configuration = await encryptCredential(env, JSON.stringify({
      secret_key: 'sk_test_example',
      webhook_secret: 'whsec_example',
    }));
    env.DB = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_store_connections')) {
        return {
          id: 'stripe-test',
          project_id: 'project-test',
          provider: 'stripe',
          environment: 'sandbox',
          configuration_encrypted: configuration,
        };
      }
      return undefined;
    });

    const response = await webhookRoutes.request('/stripe-test', {
      method: 'POST',
      headers: {
        'cf-ray': 'stripe-signature-test',
        'Stripe-Signature': 't=1,v1=invalid',
      },
      body: '{"id":"evt_invalid"}',
    }, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: 'invalid_webhook_signature',
      message: 'Webhook signature is invalid',
      retryable: false,
      request_id: 'stripe-signature-test',
    });
  });

  it('does not expose internal Billing failure details', async () => {
    const env = envWithDb({} as D1Database);
    const configuration = await encryptCredential(env, JSON.stringify({
      secret_key: 'sk_test_example',
      webhook_secret: 'whsec_example',
    }));
    env.DB = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_store_connections')) {
        return {
          id: 'stripe-test',
          project_id: 'project-test',
          provider: 'stripe',
          environment: 'sandbox',
          configuration_encrypted: configuration,
        };
      }
      return undefined;
    });
    env.BILLING_EXECUTION_MODE = 'service';
    env.BILLING = {
      fetch: async () => new Response(JSON.stringify({
        code: 'billing_queue_unavailable',
        message: 'Sensitive infrastructure detail',
        retryable: true,
      }), { status: 503 }),
    } as Fetcher;
    const payload = '{"id":"evt_queue_failure","type":"invoice.paid"}';

    const response = await webhookRoutes.request('/stripe-test', {
      method: 'POST',
      headers: {
        'cf-ray': 'stripe-billing-test',
        'Stripe-Signature': await stripeSignature('whsec_example', payload),
      },
      body: payload,
    }, env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'billing_queue_unavailable',
      message: 'Webhook could not be accepted',
      retryable: true,
      request_id: 'stripe-billing-test',
    });
  });
});
