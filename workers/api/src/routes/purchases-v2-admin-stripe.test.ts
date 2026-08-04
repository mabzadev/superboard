import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import { encryptCredential } from '../lib/secrets';

const stripeMocks = vi.hoisted(() => ({
  provision: vi.fn(),
  persist: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
  encryptCopies: vi.fn(),
}));

vi.mock('../lib/stripe-webhook-management', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/stripe-webhook-management')>(),
  provisionStripeWebhookEndpoint: stripeMocks.provision,
  persistStripeWebhookReadiness: stripeMocks.persist,
  deleteStripeWebhookEndpoint: stripeMocks.remove,
  invalidateStripeWebhookReadiness: stripeMocks.invalidate,
}));

vi.mock('../lib/store-credential-copies', () => ({
  encryptStoreCredentialCopies: stripeMocks.encryptCopies,
}));

import adminRoutes from './purchases-v2-admin';

beforeEach(() => {
  Object.values(stripeMocks).forEach((mock) => mock.mockReset());
  stripeMocks.provision.mockResolvedValue({
    secret: 'whsec_managed',
    configuration: {
      endpoint_id: 'we_managed',
      url: 'https://api.example.test/api/v2/purchases/providers/webhooks/connection-1',
      livemode: false,
      status: 'enabled',
      enabled_events: ['invoice.paid'],
      managed: true,
    },
  });
  stripeMocks.encryptCopies.mockResolvedValue({ sourceCiphertext: 'source-copy', billingCiphertext: 'billing-copy' });
});

describe('Stripe connection administration', () => {
  it('creates and stores a managed webhook when no signing secret is supplied', async () => {
    const db = projectDb();
    const response = await adminRoutes.request('/10-test/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OpenGrow-Internal-Actor': '7' },
      body: JSON.stringify({
        provider: 'stripe',
        environment: 'sandbox',
        display_name: 'Stripe Billing',
        secret_configuration: { secret_key: 'sk_test_example' },
      }),
    }, baseEnv(db));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: 'connection-1',
      webhook_managed: true,
      webhook_url: 'https://api.example.test/api/v2/purchases/providers/webhooks/connection-1',
      billing_copy_ready: true,
    });
    expect(stripeMocks.provision).toHaveBeenCalledWith(expect.objectContaining({
      secretKey: 'sk_test_example', environment: 'sandbox', connectionId: expect.any(String),
    }));
    expect(stripeMocks.encryptCopies).toHaveBeenCalledWith(expect.anything(), JSON.stringify({
      secret_key: 'sk_test_example', webhook_secret: 'whsec_managed',
    }));
    expect(stripeMocks.persist).toHaveBeenCalledOnce();
    const insert = db.calls.find((call) => call.op === 'first' && call.sql.includes('INSERT INTO billing_store_connections'));
    expect(String(insert?.args[8])).not.toContain('whsec_');
    expect(String(insert?.args[8])).toContain('we_managed');
  });

  it('keeps an explicitly supplied webhook secret as a manual connection', async () => {
    const db = projectDb();
    const response = await adminRoutes.request('/10-test/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OpenGrow-Internal-Actor': '7' },
      body: JSON.stringify({
        provider: 'stripe', environment: 'sandbox',
        secret_configuration: { secret_key: 'sk_test_example', webhook_secret: 'whsec_existing' },
      }),
    }, baseEnv(db));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ webhook_managed: false, webhook_url: null });
    expect(stripeMocks.provision).not.toHaveBeenCalled();
    expect(stripeMocks.persist).not.toHaveBeenCalled();
    expect(stripeMocks.invalidate).toHaveBeenCalledWith(expect.anything(), '20', 'manual_signing_secret_requires_delivery');
  });

  it('removes the previous managed endpoint only after a rotated connection is stored', async () => {
    const encryptionEnv = baseEnv({} as D1Database);
    const configuration = await encryptCredential(encryptionEnv, JSON.stringify({
      secret_key: 'sk_test_previous', webhook_secret: 'whsec_previous',
    }));
    const db = projectDb({
      id: 'connection-1', configuration_encrypted: configuration,
      public_configuration: JSON.stringify({ webhook_managed: true, webhook_endpoint_id: 'we_previous' }),
    });
    const response = await adminRoutes.request('/10-test/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OpenGrow-Internal-Actor': '7' },
      body: JSON.stringify({
        provider: 'stripe', environment: 'sandbox',
        secret_configuration: { secret_key: 'sk_test_example' },
      }),
    }, baseEnv(db));

    expect(response.status).toBe(201);
    expect(stripeMocks.persist).toHaveBeenCalledOnce();
    expect(stripeMocks.remove).toHaveBeenCalledWith('sk_test_previous', 'we_previous');
  });
});

function projectDb(existing: { id: string; configuration_encrypted: string; public_configuration: string } | null = null) {
  return createFakeD1((call) => {
    if (call.op === 'first' && call.sql.includes('FROM instance_roles')) return { role: 'owner' };
    if (call.op === 'first' && call.sql.includes('SELECT id, name, identifier, instance_id, is_test FROM projects')) {
      return { id: '20', name: 'Test', identifier: 'test', instance_id: 10, is_test: 1 };
    }
    if (call.op === 'first' && call.sql.includes('SELECT id, configuration_encrypted, public_configuration')) return existing;
    if (call.op === 'first' && call.sql.includes('INSERT INTO billing_store_connections')) return { id: 'connection-1' };
    if (call.op === 'run' && (call.sql.includes('billing_store_credential_audit') || call.sql.includes('billing_admin_audit_logs'))) return true;
    return undefined;
  });
}

function baseEnv(db: D1Database): Env {
  return {
    DB: db,
    KV: {} as KVNamespace,
    API_DOMAIN: 'api.example.test',
    SDK_DOMAIN: 'sdk.example.test',
    SHORTLINK_DOMAIN: 'go.example.test',
    CORS_ORIGIN: '*',
    ENVIRONMENT: 'test',
    CREDENTIAL_KEY_SCOPE: 'billing',
    STORE_CREDENTIALS_ENCRYPTION_KEY: 'test-store-credential-key',
    JWT_SECRET: 'test',
  } as Env;
}
