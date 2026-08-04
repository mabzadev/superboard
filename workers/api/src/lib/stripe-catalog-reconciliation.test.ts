import { describe, expect, it, vi } from 'vitest';
import type { BillingEnv } from '../types';
import { encryptCredential } from './secrets';
import { reconcileStripeCatalog } from './stripe-catalog-reconciliation';

const keyring = JSON.stringify({ v1: 'billing-test-key' });

describe('Scheduled Stripe catalog reconciliation', () => {
  it('revalidates stored Prices and clears connection errors only after every Price succeeds', async () => {
    const envBase = {
      CREDENTIAL_KEY_SCOPE: 'billing' as const,
      STORE_CREDENTIALS_ENCRYPTION_KEYS: keyring,
      STORE_CREDENTIALS_ACTIVE_KEY_VERSION: 'v1',
    };
    const encrypted = await encryptCredential(envBase as BillingEnv, JSON.stringify({
      secret_key: 'sk_test_example', webhook_secret: 'whsec_example',
    }));
    const batches: unknown[][] = [];
    const db = database({ encrypted, products: [{
      id: 'product-1', product_type: 'subscription', price_row_id: 'price-row-1', provider_price_id: 'price_weekly',
    }], batches });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'price_weekly', object: 'price', active: true, livemode: false,
      type: 'recurring', billing_scheme: 'per_unit', currency: 'chf', unit_amount: 999,
      product: { id: 'prod_premium', active: true, name: 'Weekly plan' },
      recurring: { interval: 'week', interval_count: 1, usage_type: 'licensed' },
    }), { status: 200 }));

    await expect(reconcileStripeCatalog({ ...envBase, DB: db } as BillingEnv, '11', 'sandbox', fetcher))
      .resolves.toMatchObject({ verified_products: 1, environment: 'sandbox' });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it('records a connection error when there is no catalog to verify', async () => {
    const envBase = {
      CREDENTIAL_KEY_SCOPE: 'billing' as const,
      STORE_CREDENTIALS_ENCRYPTION_KEYS: keyring,
      STORE_CREDENTIALS_ACTIVE_KEY_VERSION: 'v1',
    };
    const encrypted = await encryptCredential(envBase as BillingEnv, JSON.stringify({
      secret_key: 'sk_test_example', webhook_secret: 'whsec_example',
    }));
    const updates: Array<{ sql: string; args: unknown[] }> = [];
    const db = database({ encrypted, products: [], updates });

    await expect(reconcileStripeCatalog({ ...envBase, DB: db } as BillingEnv, '11', 'sandbox', vi.fn()))
      .rejects.toMatchObject({ code: 'stripe_catalog_empty', retryable: false });
    expect(updates.some((update) => update.args[0] === 'stripe_catalog_empty')).toBe(true);
  });
});

function database(params: {
  encrypted: string;
  products: Array<Record<string, unknown>>;
  batches?: unknown[][];
  updates?: Array<{ sql: string; args: unknown[] }>;
}) {
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async first() {
              if (sql.includes('FROM billing_store_connections')) {
                return { id: 'connection-1', status: 'connected', billing_configuration_encrypted: params.encrypted };
              }
              return null;
            },
            async all() {
              if (sql.includes('FROM billing_products p')) return { results: params.products };
              return { results: [] };
            },
            async run() {
              params.updates?.push({ sql, args });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(statements: unknown[]) {
      params.batches?.push(statements);
      return statements.map(() => ({ success: true }));
    },
  };
  return db as unknown as D1Database;
}
