import { readTextLimited } from './http-limits';
import { purchasesError } from './purchases-v2';
import type { StripeEnvironment } from './stripe-credentials';

type StripeProduct = {
  id?: unknown;
  active?: unknown;
  name?: unknown;
  description?: unknown;
  metadata?: unknown;
};

type StripePrice = {
  id?: unknown;
  object?: unknown;
  active?: unknown;
  livemode?: unknown;
  type?: unknown;
  billing_scheme?: unknown;
  currency?: unknown;
  unit_amount?: unknown;
  unit_amount_decimal?: unknown;
  nickname?: unknown;
  metadata?: unknown;
  product?: unknown;
  recurring?: unknown;
};

export type StripeCatalogProduct = {
  storeProductId: string;
  providerPriceId: string;
  productType: 'subscription' | 'non_consumable' | 'consumable';
  displayName: string;
  description: string | null;
  currency: string;
  priceMicros: number;
  billingPeriod: string | null;
  trialPeriod: string | null;
  productMetadata: Record<string, unknown>;
  priceMetadata: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// Stripe charge amounts use two decimal places except for this provider-defined list.
// ISK and UGX intentionally remain two-decimal for Stripe API backward compatibility.
const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

function currencyExponent(currency: string) {
  return STRIPE_ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

function priceMicros(unitAmount: number, currency: string) {
  const exponent = currencyExponent(currency);
  const multiplier = 10 ** (6 - exponent);
  const value = unitAmount * multiplier;
  if (!Number.isSafeInteger(value)) {
    throw purchasesError('stripe_price_amount_unsupported', 'Stripe Price amount cannot be represented safely', 422);
  }
  return value;
}

function isoPeriod(interval: unknown, intervalCount: unknown) {
  const count = Number(intervalCount);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw purchasesError('stripe_recurring_invalid', 'Stripe recurring interval is invalid', 422);
  }
  const suffix = interval === 'day' ? 'D'
    : interval === 'week' ? 'W'
      : interval === 'month' ? 'M'
        : interval === 'year' ? 'Y'
          : null;
  if (!suffix) throw purchasesError('stripe_recurring_invalid', 'Stripe recurring interval is invalid', 422);
  return `P${count}${suffix}`;
}

export async function retrieveStripeCatalogProduct(params: {
  secretKey: string;
  environment: StripeEnvironment;
  priceId: string;
  productType: 'subscription' | 'non_consumable' | 'consumable';
  fetcher?: typeof fetch;
}): Promise<StripeCatalogProduct> {
  const priceId = params.priceId.trim();
  if (!priceId.startsWith('price_') || priceId.length <= 'price_'.length) {
    throw purchasesError('stripe_price_id_invalid', 'A Stripe Price ID is required', 422);
  }
  const fetcher = params.fetcher || fetch;
  const response = await fetcher(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}?expand[]=product`, {
    headers: { Authorization: `Bearer ${params.secretKey}` },
  });
  const responseText = await readTextLimited(response, 1_048_576, 'Stripe Price response is too large');
  let price: StripePrice;
  try { price = JSON.parse(responseText) as StripePrice; }
  catch { throw purchasesError('stripe_price_response_invalid', 'Stripe returned an invalid Price response', 502, true); }
  if (!response.ok) {
    const error = object(object(price).error);
    throw purchasesError('stripe_price_lookup_failed', String(error.message || 'Stripe Price lookup failed'), 422);
  }
  if (price.object !== 'price' || price.id !== priceId) {
    throw purchasesError('stripe_price_response_invalid', 'Stripe returned an unexpected Price', 502, true);
  }
  const expectedLiveMode = params.environment === 'production';
  if (price.livemode !== expectedLiveMode) {
    throw purchasesError('stripe_environment_mismatch', `The Stripe Price does not belong to the ${expectedLiveMode ? 'live' : 'test'} environment`, 422);
  }
  const product = object(price.product) as StripeProduct;
  if (!String(product.id || '').startsWith('prod_')) {
    throw purchasesError('stripe_product_response_invalid', 'Stripe did not return the Price product', 502, true);
  }
  if (price.active !== true || product.active !== true) {
    throw purchasesError('stripe_price_inactive', 'Stripe Price and Product must both be active', 422);
  }
  const recurring = object(price.recurring);
  if (params.productType === 'subscription') {
    if (price.type !== 'recurring' || recurring.usage_type !== 'licensed') {
      throw purchasesError('stripe_price_type_mismatch', 'A licensed recurring Stripe Price is required for a subscription', 422);
    }
  } else if (price.type !== 'one_time') {
    throw purchasesError('stripe_price_type_mismatch', 'A one-time Stripe Price is required for this product type', 422);
  }
  if (price.billing_scheme !== 'per_unit' || !Number.isSafeInteger(price.unit_amount) || Number(price.unit_amount) < 0) {
    throw purchasesError('stripe_price_amount_unsupported', 'A fixed per-unit Stripe Price is required', 422);
  }
  const currency = String(price.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw purchasesError('stripe_currency_invalid', 'Stripe Price currency is invalid', 422);
  }
  const billingPeriod = params.productType === 'subscription'
    ? isoPeriod(recurring.interval, recurring.interval_count)
    : null;
  const trialDays = Number(recurring.trial_period_days);
  const trialPeriod = params.productType === 'subscription' && Number.isSafeInteger(trialDays) && trialDays > 0
    ? `P${trialDays}D`
    : null;
  const providerReady = price.active === true && product.active === true;
  const verifiedAt = new Date().toISOString();
  return {
    storeProductId: priceId,
    providerPriceId: priceId,
    productType: params.productType,
    displayName: String(product.name || price.nickname || priceId),
    description: product.description == null ? null : String(product.description),
    currency,
    priceMicros: priceMicros(Number(price.unit_amount), currency),
    billingPeriod,
    trialPeriod,
    productMetadata: {
      provider_verified: true,
      provider_approved: providerReady,
      provider_available: providerReady,
      provider_purchasable: providerReady,
      provider_verified_at: verifiedAt,
      stripe_product_id: String(product.id),
      stripe_price_id: priceId,
      livemode: expectedLiveMode,
      price_type: String(price.type),
    },
    priceMetadata: {
      provider_verified: true,
      provider_verified_at: verifiedAt,
      billing_scheme: String(price.billing_scheme),
      unit_amount_minor: Number(price.unit_amount),
      unit_amount_decimal: String(price.unit_amount_decimal ?? price.unit_amount),
      recurring: params.productType === 'subscription' ? recurring : null,
    },
  };
}
