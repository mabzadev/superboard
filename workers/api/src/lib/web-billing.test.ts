import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1, type FakeD1Call } from '../test/fake-d1';
import { encryptCredential } from './secrets';
import { createWebCheckoutSession } from './web-billing';

afterEach(() => vi.unstubAllGlobals());

describe('Stripe Web checkout', () => {
  it('binds an idempotency key to one customer and environment', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_checkout_sessions')) {
        return { customer_id: 'customer-a', environment: 'sandbox', checkout_url: 'https://checkout.stripe.test/a', provider_session_id: 'cs_a' };
      }
      return undefined;
    });
    await expect(createWebCheckoutSession({ DB: db } as unknown as BillingEnv, request({ customerId: 'customer-b' })))
      .rejects.toMatchObject({ code: 'checkout_idempotency_conflict', status: 409 });
  });

  it('reuses the verified Stripe Customer and propagates checkout identity to PaymentIntent metadata', async () => {
    const env = {
      DB: {} as D1Database,
      STORE_CREDENTIALS_ENCRYPTION_KEY: 'test-store-credential-key',
      CREDENTIAL_KEY_SCOPE: 'api',
    } as unknown as BillingEnv;
    const encrypted = await encryptCredential(env, JSON.stringify({
      secret_key: 'sk_test_example', webhook_secret: 'whsec_example',
    }));
    const state = checkoutDatabase(encrypted);
    env.DB = state.db;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const values = new URLSearchParams(String(init?.body || ''));
      expect(new Headers(init?.headers).get('Idempotency-Key')).toMatch(/^opengrow-checkout-[a-f0-9]{64}$/);
      expect(values.get('customer')).toBe('cus_verified');
      expect(values.get('payment_intent_data[metadata][opengrow_project_id]')).toBe('project-1');
      expect(values.get('payment_intent_data[metadata][opengrow_customer_id]')).toBe('customer-1');
      expect(values.get('payment_intent_data[metadata][opengrow_checkout_id]')).toMatch(/^[0-9a-f-]{36}$/);
      return Response.json({ id: 'cs_created', url: 'https://checkout.stripe.test/session' });
    });
    vi.stubGlobal('fetch', fetcher);

    const first = await createWebCheckoutSession(env, request());
    expect(first).toMatchObject({
      url: 'https://checkout.stripe.test/session', provider_session_id: 'cs_created', duplicate: false,
    });
    expect(first.redemption_code).toMatch(/^[a-f0-9]{32}$/);
    await expect(createWebCheckoutSession(env, request())).resolves.toMatchObject({
      url: first.url,
      provider_session_id: first.provider_session_id,
      redemption_code: first.redemption_code,
      duplicate: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not create two provider sessions while another checkout lease is active', async () => {
    const env = testEnv();
    const encrypted = await encryptCredential(env, JSON.stringify({
      secret_key: 'sk_test_example', webhook_secret: 'whsec_example',
    }));
    const state = checkoutDatabase(encrypted, {
      id: 'checkout-existing', customer_id: 'customer-1', environment: 'sandbox', provider: 'stripe',
      status: 'creating', checkout_url: null, provider_session_id: null,
      request_fingerprint: await checkoutFingerprint(), redemption_code_encrypted: 'encrypted',
      processing_lease_id: 'active-lease', processing_started_at: new Date().toISOString(),
    });
    env.DB = state.db;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    await expect(createWebCheckoutSession(env, request())).rejects.toMatchObject({
      code: 'checkout_in_progress', status: 409, retryable: true,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('releases the checkout lease after a retryable Stripe failure', async () => {
    const env = testEnv();
    const encrypted = await encryptCredential(env, JSON.stringify({
      secret_key: 'sk_test_example', webhook_secret: 'whsec_example',
    }));
    const state = checkoutDatabase(encrypted);
    env.DB = state.db;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'Temporarily unavailable' } }, { status: 503 })));

    await expect(createWebCheckoutSession(env, request())).rejects.toMatchObject({
      code: 'stripe_request_failed', status: 503, retryable: true,
    });
    expect(state.checkout()).toMatchObject({ status: 'creating', processing_lease_id: null, processing_started_at: null });
  });
});

type CheckoutRow = {
  id: string;
  customer_id: string;
  environment: string;
  provider: string;
  status: string;
  checkout_url: string | null;
  provider_session_id: string | null;
  request_fingerprint: string | null;
  redemption_code_encrypted: string | null;
  processing_lease_id: string | null;
  processing_started_at: string | null;
};

function testEnv() {
  return {
    DB: {} as D1Database,
    STORE_CREDENTIALS_ENCRYPTION_KEY: 'test-store-credential-key',
    CREDENTIAL_KEY_SCOPE: 'api',
  } as unknown as BillingEnv;
}

function checkoutDatabase(encryptedCredentials: string, initial: CheckoutRow | null = null) {
  let checkout = initial;
  const db = createFakeD1((call: FakeD1Call) => {
    if (call.op === 'first' && call.sql.includes('FROM billing_checkout_sessions')) return checkout;
    if (call.op === 'first' && call.sql.includes('FROM billing_packages')) {
      return {
        package_id: 'package-1', product_id: 'product-1', product_type: 'non_consumable',
        store_product_id: 'price_1', provider_price_id: 'price_1', store: 'stripe',
      };
    }
    if (call.op === 'all' && call.sql.includes('web_configuration_linked_domains')) {
      return [{ domain: 'app.example.test', site: 'app.example.test' }];
    }
    if (call.op === 'first' && call.sql.startsWith('SELECT attributes FROM billing_customers')) {
      return { attributes: JSON.stringify({ stripe_customer_id: 'cus_verified' }) };
    }
    if (call.op === 'first' && call.sql.includes('FROM billing_store_connections')) {
      return {
        id: 'connection-1', provider: 'stripe', environment: 'sandbox',
        configuration_encrypted: encryptedCredentials, billing_configuration_encrypted: null,
      };
    }
    if (call.op === 'run' && call.sql.startsWith('INSERT OR IGNORE INTO billing_checkout_sessions')) {
      if (!checkout) {
        checkout = {
          id: String(call.args[0]), customer_id: String(call.args[2]), environment: String(call.args[5]),
          provider: String(call.args[4]), status: 'creating', checkout_url: null, provider_session_id: null,
          request_fingerprint: String(call.args[11]), redemption_code_encrypted: String(call.args[12]),
          processing_lease_id: String(call.args[13]), processing_started_at: new Date().toISOString(),
        };
      }
      return true;
    }
    if (call.op === 'run' && call.sql.startsWith('INSERT OR IGNORE INTO billing_redemptions')) return true;
    if (call.op === 'run' && call.sql.includes('SET processing_lease_id = ?')) {
      return true;
    }
    if (call.op === 'run' && call.sql.includes("SET provider_session_id = ?")) {
      if (checkout && checkout.processing_lease_id === call.args[3]) {
        checkout = {
          ...checkout, provider_session_id: String(call.args[0]), checkout_url: String(call.args[1]),
          status: 'created', processing_lease_id: null, processing_started_at: null,
        };
      }
      return true;
    }
    if (call.op === 'run' && call.sql.includes('SET status = ?')) {
      if (checkout && checkout.processing_lease_id === call.args[2]) {
        checkout = { ...checkout, status: String(call.args[0]), processing_lease_id: null, processing_started_at: null };
      }
      return true;
    }
    return undefined;
  });
  return { db, checkout: () => checkout };
}

async function checkoutFingerprint() {
  const value = JSON.stringify([
    'customer-1', 'sandbox', 'connection-1', 'package-1', 'product-1', 'price_1',
    'https://app.example.test/success', 'https://app.example.test/cancel',
  ]);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function request(overrides: Partial<Parameters<typeof createWebCheckoutSession>[1]> = {}) {
  return {
    projectId: 'project-1',
    customerId: 'customer-1',
    packageIdentifier: 'lifetime',
    environment: 'sandbox' as const,
    successUrl: 'https://app.example.test/success',
    cancelUrl: 'https://app.example.test/cancel',
    idempotencyKey: 'checkout-key-1',
    ...overrides,
  };
}
