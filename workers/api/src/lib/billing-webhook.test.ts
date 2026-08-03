import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import { queueCustomerEntitlementChanged } from './billing';

describe('customer entitlement projection webhook', () => {
  it('queues a normalized VocoStar mirror event only for subscribed endpoints', async () => {
    let deliveryPayload = '';
    const db = createFakeD1((call) => {
      if (call.sql.startsWith('SELECT * FROM billing_customers')) {
        return { id: 'customer-1', primary_app_user_id: 'vocostar-user-1' };
      }
      if (call.sql.startsWith('SELECT app_user_id FROM billing_customer_aliases')) return [];
      if (call.sql.includes('FROM billing_customer_entitlements ce')) {
        return [{ identifier: 'premium', status: 'active', expires_at: '2030-01-01T00:00:00Z', will_renew: 1 }];
      }
      if (call.sql.includes('FROM billing_subscriptions s')) {
        return [{ store: 'apple', store_product_id: 'vocostar_weekly_999', status: 'active', expires_at: '2030-01-01T00:00:00Z' }];
      }
      if (call.sql.includes('FROM billing_balance_ledger')) return [];
      if (call.sql.includes('FROM billing_webhook_endpoints')) {
        return [{
          id: 'endpoint-1',
          environments: '["production"]',
          event_types: '["customer.entitlement.changed"]',
        }];
      }
      if (call.sql.startsWith('INSERT INTO billing_webhook_deliveries')) {
        deliveryPayload = String(call.args[4]);
        return true;
      }
      return undefined;
    });
    const send = vi.fn(async () => undefined);
    const env = { DB: db, BILLING_QUEUE: { send } } as unknown as Env;

    await queueCustomerEntitlementChanged(env, {
      projectId: 'project-1',
      customerId: 'customer-1',
      environment: 'production',
      transactionId: 'transaction-1',
      reason: 'DID_RENEW',
    });

    const payload = JSON.parse(deliveryPayload);
    expect(payload).toMatchObject({
      type: 'customer.entitlement.changed',
      project_id: 'project-1',
      customer_id: 'customer-1',
      app_user_id: 'vocostar-user-1',
      transaction_id: 'transaction-1',
      reason: 'DID_RENEW',
      data: {
        premium: true,
        subscription: true,
        active_subscriptions: ['vocostar_weekly_999'],
      },
    });
    expect(send).toHaveBeenCalledOnce();
  });
});
