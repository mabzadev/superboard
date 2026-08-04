import { describe, expect, it, vi } from 'vitest';
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
  it('routes Apple V2 notifications to Billing only after project and environment validation', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const body = await request.json() as Record<string, any>;
      expect(new URL(request.url).pathname).toBe('/internal/v1/provider-events/ingest');
      expect(body).toMatchObject({
        project_id: '10',
        store: 'apple',
        environment: 'production',
        job: {
          type: 'billing.apple.notification',
          projectId: '10',
          environment: 'production',
          signedPayload: 'header.payload.signature',
        },
      });
      expect(body.external_event_id).toMatch(/^[a-f0-9]{64}$/);
      return Response.json({
        data: { event_id: 'event-1', duplicate: false, queued: true, processed: false },
      });
    });
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM projects WHERE id = ?')) {
        return { id: 10, is_test: 0 };
      }
      return undefined;
    });
    const response = await webhookRoutes.request('/apple/production/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'header.payload.signature' }),
    }, envWithDb(db, {
      BILLING_EXECUTION_MODE: 'service',
      BILLING: { fetch } as Fetcher,
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      received: true,
      queued: true,
      duplicate: false,
      processed: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects an Apple notification sent to the wrong project environment', async () => {
    const fetch = vi.fn();
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM projects WHERE id = ?')) {
        return { id: 10, is_test: 1 };
      }
      return undefined;
    });
    const response = await webhookRoutes.request('/apple/production/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-ray': 'apple-environment-test' },
      body: JSON.stringify({ signedPayload: 'header.payload.signature' }),
    }, envWithDb(db, {
      BILLING_EXECUTION_MODE: 'service',
      BILLING: { fetch } as Fetcher,
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: 'apple_project_not_found',
      message: 'Apple notification target was not found',
      retryable: false,
      request_id: 'apple-environment-test',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

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
    const payload = '{"id":"evt_queue_failure","type":"invoice.paid","livemode":false}';

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

  it('rejects a signed Stripe event from the wrong environment before Billing ingestion', async () => {
    const env = envWithDb({} as D1Database);
    const configuration = await encryptCredential(env, JSON.stringify({
      secret_key: 'sk_test_example',
      webhook_secret: 'whsec_example',
    }));
    const billing = vi.fn();
    env.DB = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_store_connections')) {
        return {
          id: 'stripe-test', project_id: 'project-test', provider: 'stripe',
          environment: 'sandbox', configuration_encrypted: configuration,
        };
      }
      return undefined;
    });
    env.BILLING_EXECUTION_MODE = 'service';
    env.BILLING = { fetch: billing } as unknown as Fetcher;
    const payload = '{"id":"evt_live","type":"invoice.paid","livemode":true}';
    const response = await webhookRoutes.request('/stripe-test', {
      method: 'POST',
      headers: { 'Stripe-Signature': await stripeSignature('whsec_example', payload) },
      body: payload,
    }, env);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'stripe_environment_mismatch', retryable: false });
    expect(billing).not.toHaveBeenCalled();
  });
});
