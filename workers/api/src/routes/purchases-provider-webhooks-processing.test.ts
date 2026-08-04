import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1 } from '../test/fake-d1';

const billingMocks = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock('../lib/billing', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/billing')>(),
  applyVerifiedPurchase: billingMocks.apply,
}));

import { processStripeVerifiedEvent } from './purchases-provider-webhooks';

beforeEach(() => billingMocks.apply.mockReset());

describe('Stripe verified event projection', () => {
  it('ignores signed event types that are not financial contracts', async () => {
    const env = { DB: createFakeD1(() => undefined) } as unknown as BillingEnv;
    await expect(processStripeVerifiedEvent(env, connection(), {
      id: 'evt_1', type: 'customer.updated', data: { object: { id: 'cus_1' } },
    })).resolves.toEqual({ ignored: true, reason: 'unsupported_event' });
    expect(billingMocks.apply).not.toHaveBeenCalled();
  });

  it('scopes checkout and metadata customer resolution to the connection project', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_checkout_sessions')) {
        expect(call.args.slice(0, 3)).toEqual(['project-1', 'sandbox', 'connection-1']);
        return null;
      }
      if (call.op === 'first' && call.sql.startsWith('SELECT id FROM billing_customers')) {
        expect(call.args).toEqual(['customer-from-another-project', 'project-1']);
        return null;
      }
      if (call.op === 'first' && call.sql.includes('FROM billing_transactions')) return null;
      return undefined;
    });
    const env = { DB: db } as unknown as BillingEnv;
    await expect(processStripeVerifiedEvent(env, connection(), {
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_2', status: 'complete', payment_status: 'paid', mode: 'subscription',
        metadata: { opengrow_checkout_id: 'checkout-from-another-project', opengrow_customer_id: 'customer-from-another-project' },
      } },
    })).resolves.toEqual({ ignored: true, reason: 'customer_not_found' });
    expect(billingMocks.apply).not.toHaveBeenCalled();
  });

  it('does not grant access for an unpaid completed Checkout Session', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_checkout_sessions')) {
        return { id: 'checkout-1', customer_id: 'customer-1', product_type: 'subscription', store_product_id: 'price_1' };
      }
      if (call.op === 'run' && call.sql.startsWith('UPDATE billing_checkout_sessions')) return true;
      return undefined;
    });
    const env = { DB: db } as unknown as BillingEnv;
    await expect(processStripeVerifiedEvent(env, connection(), {
      id: 'evt_3', type: 'checkout.session.completed',
      data: { object: { id: 'cs_3', status: 'complete', payment_status: 'unpaid', mode: 'subscription' } },
    })).resolves.toEqual({ ignored: true, reason: 'non_terminal_event_state' });
    expect(billingMocks.apply).not.toHaveBeenCalled();
  });

  it('does not apply a sensitive event to the latest purchase without an exact provider reference', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_checkout_sessions')) return null;
      if (call.op === 'first' && call.sql.includes('t.store_transaction_id LIKE')) return null;
      if (call.op === 'first' && call.sql.includes('json_extract(attributes')) return { id: 'customer-1' };
      if (call.op === 'first' && call.sql.includes('FROM billing_transactions')) {
        return {
          customer_id: 'customer-1', store_product_id: 'price_unrelated', product_type: 'non_consumable',
          original_transaction_id: 'pi_unrelated', status: 'active', price_micros: 10000000, currency: 'USD',
        };
      }
      return undefined;
    });
    const env = { DB: db } as unknown as BillingEnv;
    await expect(processStripeVerifiedEvent(env, connection(), {
      id: 'evt_refund', type: 'charge.refunded',
      data: { object: { id: 'ch_unknown', customer: 'cus_1', refunded: true, currency: 'usd' } },
    })).resolves.toEqual({ ignored: true, reason: 'exact_purchase_not_found' });
    expect(billingMocks.apply).not.toHaveBeenCalled();
  });

  it('records a partial refund without revoking the exact purchase', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_checkout_sessions')) return null;
      if (call.op === 'first' && call.sql.includes('t.environment = ?')) {
        return {
          customer_id: 'customer-1', store_product_id: 'price_1', product_type: 'non_consumable',
          original_transaction_id: 'pi_exact', status: 'active', price_micros: 10000000, currency: 'USD',
        };
      }
      if (call.op === 'first' && call.sql.startsWith('SELECT id FROM billing_customers')) return null;
      if (call.op === 'first' && call.sql.startsWith('SELECT attributes FROM billing_customers')) return { attributes: '{}' };
      if (call.op === 'run' && call.sql.startsWith('UPDATE billing_customers')) return true;
      return undefined;
    });
    billingMocks.apply.mockResolvedValue({ transactionId: 'transaction-1', duplicate: false });
    const env = { DB: db } as unknown as BillingEnv;
    await expect(processStripeVerifiedEvent(env, connection(), {
      id: 'evt_partial', type: 'refund.updated', created: 100,
      data: { object: {
        id: 're_partial', payment_intent: 'pi_exact', status: 'succeeded',
        amount: 500, currency: 'usd', customer: 'cus_1',
      } },
    })).resolves.toEqual({ transactionId: 'transaction-1', duplicate: false });
    expect(billingMocks.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: 'active', storeProductId: 'price_1', originalTransactionId: 'pi_exact',
    }));
  });
});

function connection() {
  return { id: 'connection-1', project_id: 'project-1', environment: 'sandbox' };
}
