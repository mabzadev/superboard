import { describe, expect, it } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import { encryptSecret } from './secrets';
import {
  nextPageCursor,
  normalizeLegacySubscription,
  processLegacyInventoryPage,
  testLegacySourceConnection,
} from './legacy-subscription-inventory';

describe('Legacy subscription inventory', () => {
  it('normalizes supported stores and embedded product identifiers', () => {
    expect(normalizeLegacySubscription({
      id: 'legacy-sub-1',
      gives_access: true,
      environment: 'production',
      store: 'app_store',
      store_subscription_identifier: '2000000123456789',
      current_period_ends_at: 1_800_000_000_000,
      status: 'active',
      product_id: 'provider-product-1',
      entitlements: {
        items: [{
          products: { items: [{ id: 'provider-product-1', store_identifier: 'weekly_product' }] },
        }],
      },
    })).toEqual({
      externalSubscriptionId: 'legacy-sub-1',
      provider: 'apple',
      environment: 'production',
      storeProductId: 'weekly_product',
      storeSubscriptionIdentifier: '2000000123456789',
      sourceStatus: 'active',
      sourceExpiresAt: '2027-01-15T08:00:00.000Z',
    });
  });

  it('never inventories a subscription that does not currently give access', () => {
    expect(normalizeLegacySubscription({ id: 'expired', gives_access: false, store: 'play_store' })).toBeNull();
  });

  it('keeps unsupported legacy stores unresolved', () => {
    expect(normalizeLegacySubscription({
      id: 'legacy-sub-2', gives_access: true, store: 'amazon', environment: 'sandbox',
      product: { store_identifier: 'legacy-product' },
    })).toMatchObject({ provider: 'unsupported', environment: 'sandbox', storeProductId: 'legacy-product' });
  });

  it('accepts only pagination cursors on the expected official API path', () => {
    const expectedPath = '/v2/projects/project-1/customers';
    expect(nextPageCursor(`${expectedPath}?starting_after=customer-10`, expectedPath)).toBe('customer-10');
    expect(() => nextPageCursor('https://example.com/collect?starting_after=secret', expectedPath))
      .toThrow(/invalid pagination URL/);
    expect(() => nextPageCursor('/v2/projects/other/customers?starting_after=customer-10', expectedPath))
      .toThrow(/invalid pagination URL/);
  });

  it('uses only the Billing credential copy inside the isolated Billing domain', async () => {
    const encryptionKey = 'legacy-inventory-test-key';
    const source = {
      id: 'source-1',
      project_id: 'project-1',
      external_project_id: 'provider-project-1',
      configuration_encrypted: await encryptSecret(JSON.stringify({ api_key: 'api-domain-key' }), encryptionKey),
      billing_configuration_encrypted: await encryptSecret(JSON.stringify({ api_key: 'billing-domain-key' }), encryptionKey),
    };
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.revenuecat.com/v2/projects/provider-project-1/customers?limit=1');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer billing-domain-key');
      expect(init?.redirect).toBe('manual');
      return new Response(JSON.stringify({ object: 'list', items: [], url: '/v2/projects/provider-project-1/customers' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    await expect(testLegacySourceConnection(source, {
      DB: {} as D1Database,
      KV: {} as KVNamespace,
      ENVIRONMENT: 'test',
      CREDENTIAL_KEY_SCOPE: 'billing',
      STORE_CREDENTIALS_ENCRYPTION_KEY: encryptionKey,
    } as BillingEnv, fetchImpl as typeof fetch)).resolves.toEqual({
      ok: true,
      provider: 'revenuecat',
      customers_sampled: 0,
    });
  });

  it('rejects provider redirects without following them', async () => {
    const encryptionKey = 'legacy-inventory-redirect-key';
    const source = {
      id: 'source-redirect',
      project_id: 'project-1',
      external_project_id: 'provider-project-1',
      configuration_encrypted: null,
      billing_configuration_encrypted: await encryptSecret(
        JSON.stringify({ api_key: 'billing-domain-key' }),
        encryptionKey,
      ),
    };
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://example.com/collect' },
      });
    };

    await expect(testLegacySourceConnection(source, {
      DB: {} as D1Database,
      KV: {} as KVNamespace,
      ENVIRONMENT: 'test',
      CREDENTIAL_KEY_SCOPE: 'billing',
      STORE_CREDENTIALS_ENCRYPTION_KEY: encryptionKey,
    } as BillingEnv, fetchImpl as typeof fetch)).rejects.toMatchObject({
      code: 'legacy_provider_redirect_rejected',
      retryable: false,
    });
  });

  it('does not contact the provider when another queue consumer owns the page lease', async () => {
    const fetchImpl = () => Promise.reject(new Error('Provider must not be called'));
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.startsWith('UPDATE billing_legacy_inventory_runs')) return null;
      return undefined;
    });
    await expect(processLegacyInventoryPage({ DB: db } as BillingEnv, 'run-1', undefined, fetchImpl as typeof fetch))
      .resolves.toEqual({ skipped: true, reason: 'stale_or_claimed' });
  });
});
