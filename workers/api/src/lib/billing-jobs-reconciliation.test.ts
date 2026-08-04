import { describe, expect, it } from 'vitest';
import type { BillingEnv } from '../types';
import { reconcileStoreSubscription } from './billing-jobs';

describe('Provider subscription reconciliation state', () => {
  it('persists a stable failure when provider verification data is missing', async () => {
    const updates: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first() {
                if (sql.includes('FROM billing_subscriptions s')) {
                  return {
                    id: 'subscription-1', project_id: '11', customer_id: 'customer-1',
                    product_id: 'product-1', store: 'google', environment: 'production',
                    original_transaction_id: 'order-1', store_product_id: 'yearly-plan',
                    purchase_token: null,
                  };
                }
                return null;
              },
              async run() {
                updates.push({ sql, args });
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const env = { DB: db } as BillingEnv;

    await expect(reconcileStoreSubscription(env, 'subscription-1')).rejects.toMatchObject({
      code: 'subscription_reconciliation_data_missing', retryable: false,
    });
    const failure = updates.find((update) => update.sql.includes("provider_verification_status = 'failed'"));
    expect(failure?.args).toEqual([
      'subscription_reconciliation_data_missing',
      'Subscription cannot be reconciled without provider verification data',
      'subscription-1',
    ]);
  });
});
