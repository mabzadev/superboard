import { describe, expect, it, vi } from 'vitest';
import { retrieveStripeCatalogProduct } from './stripe-catalog';

function stripeResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    id: 'price_weekly',
    object: 'price',
    active: true,
    livemode: false,
    type: 'recurring',
    billing_scheme: 'per_unit',
    currency: 'chf',
    unit_amount: 999,
    product: { id: 'prod_premium', active: true, name: 'Weekly plan', description: 'Weekly access' },
    recurring: { interval: 'week', interval_count: 1, trial_period_days: 3, usage_type: 'licensed' },
    ...overrides,
  }), { status: 200 });
}

describe('Stripe catalog verification', () => {
  it('derives subscription catalog data from a provider-verified Price', async () => {
    const fetcher = vi.fn().mockResolvedValue(stripeResponse());
    const product = await retrieveStripeCatalogProduct({
      secretKey: 'sk_test_example', environment: 'sandbox', priceId: 'price_weekly', productType: 'subscription', fetcher,
    });
    expect(product).toMatchObject({
      storeProductId: 'price_weekly',
      providerPriceId: 'price_weekly',
      displayName: 'Weekly plan',
      currency: 'CHF',
      priceMicros: 9_990_000,
      billingPeriod: 'P1W',
      trialPeriod: 'P3D',
      productMetadata: { provider_verified: true, stripe_product_id: 'prod_premium', livemode: false },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/prices/price_weekly?expand[]=product',
      { headers: { Authorization: 'Bearer sk_test_example' } },
    );
  });

  it('supports zero-decimal currencies without assuming two decimal places', async () => {
    const fetcher = vi.fn().mockResolvedValue(stripeResponse({ currency: 'jpy', unit_amount: 1200 }));
    await expect(retrieveStripeCatalogProduct({
      secretKey: 'sk_test_example', environment: 'sandbox', priceId: 'price_weekly', productType: 'subscription', fetcher,
    })).resolves.toMatchObject({ currency: 'JPY', priceMicros: 1_200_000_000 });
  });

  it('keeps Stripe backward-compatible ISK amounts in two-decimal representation', async () => {
    const fetcher = vi.fn().mockResolvedValue(stripeResponse({ currency: 'isk', unit_amount: 500 }));
    await expect(retrieveStripeCatalogProduct({
      secretKey: 'sk_test_example', environment: 'sandbox', priceId: 'price_weekly', productType: 'subscription', fetcher,
    })).resolves.toMatchObject({ currency: 'ISK', priceMicros: 5_000_000 });
  });

  it('rejects a Price from the wrong Stripe environment', async () => {
    const fetcher = vi.fn().mockResolvedValue(stripeResponse({ livemode: true }));
    await expect(retrieveStripeCatalogProduct({
      secretKey: 'sk_test_example', environment: 'sandbox', priceId: 'price_weekly', productType: 'subscription', fetcher,
    })).rejects.toMatchObject({ code: 'stripe_environment_mismatch', status: 422 });
  });

  it('rejects inactive, metered, and mismatched Prices', async () => {
    const inactive = vi.fn().mockResolvedValue(stripeResponse({ active: false }));
    await expect(retrieveStripeCatalogProduct({
      secretKey: 'sk_test_example', environment: 'sandbox', priceId: 'price_weekly', productType: 'subscription', fetcher: inactive,
    })).rejects.toMatchObject({ code: 'stripe_price_inactive' });

    const metered = vi.fn().mockResolvedValue(stripeResponse({ recurring: { interval: 'week', interval_count: 1, usage_type: 'metered' } }));
    await expect(retrieveStripeCatalogProduct({
      secretKey: 'sk_test_example', environment: 'sandbox', priceId: 'price_weekly', productType: 'subscription', fetcher: metered,
    })).rejects.toMatchObject({ code: 'stripe_price_type_mismatch' });

    const oneTime = vi.fn().mockResolvedValue(stripeResponse({ type: 'one_time', recurring: null }));
    await expect(retrieveStripeCatalogProduct({
      secretKey: 'sk_test_example', environment: 'sandbox', priceId: 'price_weekly', productType: 'subscription', fetcher: oneTime,
    })).rejects.toMatchObject({ code: 'stripe_price_type_mismatch' });
  });
});
