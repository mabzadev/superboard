import { describe, expect, it, vi } from 'vitest';
import { retrieveStripeSubscriptionSnapshot } from './stripe-subscription-reconciliation';

function response(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    id: 'sub_verified',
    object: 'subscription',
    livemode: false,
    customer: 'cus_verified',
    status: 'active',
    cancel_at_period_end: false,
    latest_invoice: 'in_verified',
    items: {
      data: [{
        current_period_start: 1_800_000_000,
        current_period_end: 1_800_604_800,
        quantity: 1,
        price: {
          id: 'price_weekly', type: 'recurring', unit_amount: 999, currency: 'chf',
          recurring: { interval: 'week', interval_count: 1, usage_type: 'licensed' },
        },
      }],
    },
    ...overrides,
  }), { status: 200 });
}

describe('Stripe subscription reconciliation', () => {
  it('derives the current subscription state from Stripe', async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    const snapshot = await retrieveStripeSubscriptionSnapshot({
      secretKey: 'sk_test_example', environment: 'sandbox', subscriptionId: 'sub_verified', fetcher,
    });
    expect(snapshot).toMatchObject({
      id: 'sub_verified', customerId: 'cus_verified', priceId: 'price_weekly',
      status: 'active', currency: 'CHF', priceMicros: 9_990_000,
      quantity: 1, autoRenews: true, periodType: 'normal', latestInvoiceId: 'in_verified',
    });
    expect(snapshot.reconciliationKey).toContain('sub_verified:price_weekly:active:renewing:1800604800:in_verified');
  });

  it('keeps access through a scheduled cancellation until the current period ends', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ cancel_at_period_end: true }));
    await expect(retrieveStripeSubscriptionSnapshot({
      secretKey: 'sk_test_example', environment: 'sandbox', subscriptionId: 'sub_verified', fetcher,
    })).resolves.toMatchObject({ status: 'cancelled', autoRenews: false });
  });

  it('revokes access for terminal and paused provider states', async () => {
    for (const [providerStatus, expectedStatus] of [
      ['canceled', 'expired'], ['unpaid', 'expired'], ['incomplete_expired', 'expired'], ['paused', 'paused'],
    ] as const) {
      const fetcher = vi.fn().mockResolvedValue(response({ status: providerStatus }));
      await expect(retrieveStripeSubscriptionSnapshot({
        secretKey: 'sk_test_example', environment: 'sandbox', subscriptionId: 'sub_verified', fetcher,
      })).resolves.toMatchObject({ status: expectedStatus, autoRenews: false });
    }
  });

  it('keeps an incomplete initial payment pending without granting access', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ status: 'incomplete' }));
    await expect(retrieveStripeSubscriptionSnapshot({
      secretKey: 'sk_test_example', environment: 'sandbox', subscriptionId: 'sub_verified', fetcher,
    })).resolves.toMatchObject({ status: 'pending', autoRenews: false });
  });

  it('rejects environment and catalog-shape mismatches', async () => {
    const live = vi.fn().mockResolvedValue(response({ livemode: true }));
    await expect(retrieveStripeSubscriptionSnapshot({
      secretKey: 'sk_test_example', environment: 'sandbox', subscriptionId: 'sub_verified', fetcher: live,
    })).rejects.toMatchObject({ code: 'stripe_environment_mismatch', retryable: false });

    const multipleItems = vi.fn().mockResolvedValue(response({ items: { data: [{}, {}] } }));
    await expect(retrieveStripeSubscriptionSnapshot({
      secretKey: 'sk_test_example', environment: 'sandbox', subscriptionId: 'sub_verified', fetcher: multipleItems,
    })).rejects.toMatchObject({ code: 'stripe_subscription_items_invalid', retryable: false });
  });
});
