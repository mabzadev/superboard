import type { BillingEnv } from '../types';
import type { BillingEnvironment, BillingStatus, VerifiedPurchase } from './billing';
import { readTextLimited } from './http-limits';
import { decryptCredential, scopedStoreCredential } from './secrets';
import { stripeAmountMicros } from './stripe-catalog';
import { validateStripeCredentials } from './stripe-credentials';

type StripeSubscriptionSnapshot = {
  id: string;
  customerId: string;
  priceId: string;
  status: BillingStatus;
  providerStatus: string;
  currency: string;
  priceMicros: number;
  quantity: number;
  startsAt: string | null;
  expiresAt: string | null;
  autoRenews: boolean;
  periodType: 'normal' | 'trial';
  latestInvoiceId: string | null;
  reconciliationKey: string;
  payload: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function providerError(code: string, message: string, retryable = true, retryDelaySeconds = 300) {
  return Object.assign(new Error(message), { code, retryable, retryDelaySeconds });
}

function epoch(value: unknown): string | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function stripeStatus(status: string, cancelAtPeriodEnd: boolean): BillingStatus {
  if (status === 'trialing') return 'trialing';
  if (status === 'active') return cancelAtPeriodEnd ? 'cancelled' : 'active';
  if (status === 'past_due') return 'billing_issue';
  if (status === 'incomplete') return 'pending';
  if (status === 'paused') return 'paused';
  if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') return 'expired';
  throw providerError('stripe_subscription_status_invalid', 'Stripe returned an unsupported subscription status', false);
}

export async function retrieveStripeSubscriptionSnapshot(params: {
  secretKey: string;
  environment: BillingEnvironment;
  subscriptionId: string;
  fetcher?: typeof fetch;
}): Promise<StripeSubscriptionSnapshot> {
  const subscriptionId = params.subscriptionId.trim();
  if (!subscriptionId.startsWith('sub_') || subscriptionId.length <= 'sub_'.length) {
    throw providerError('stripe_subscription_id_invalid', 'Stripe subscription ID is invalid', false);
  }
  const response = await (params.fetcher || fetch)(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { Authorization: `Bearer ${params.secretKey}` } },
  );
  const responseText = await readTextLimited(response, 1_048_576, 'Stripe subscription response is too large');
  let subscription: Record<string, unknown>;
  try { subscription = record(JSON.parse(responseText)); }
  catch { throw providerError('stripe_subscription_response_invalid', 'Stripe returned an invalid subscription response'); }
  if (!response.ok) {
    const error = record(subscription.error);
    throw providerError(
      'stripe_subscription_lookup_failed',
      String(error.message || 'Stripe subscription lookup failed'),
      response.status >= 500 || response.status === 429,
      response.status === 429 ? 60 : 300,
    );
  }
  if (subscription.object !== 'subscription' || subscription.id !== subscriptionId) {
    throw providerError('stripe_subscription_response_invalid', 'Stripe returned an unexpected subscription');
  }
  const expectedLiveMode = params.environment === 'production';
  if (subscription.livemode !== expectedLiveMode) {
    throw providerError('stripe_environment_mismatch', 'Stripe subscription environment does not match the project', false);
  }
  const customerId = String(record(subscription.customer).id || subscription.customer || '');
  if (!customerId.startsWith('cus_')) {
    throw providerError('stripe_subscription_customer_invalid', 'Stripe subscription customer is invalid', false);
  }
  const items = array(record(subscription.items).data);
  if (items.length !== 1) {
    throw providerError('stripe_subscription_items_invalid', 'Exactly one Stripe subscription item is required', false);
  }
  const item = record(items[0]);
  const price = record(item.price);
  const priceId = String(price.id || '');
  const recurring = record(price.recurring);
  if (!priceId.startsWith('price_') || price.type !== 'recurring' || recurring.usage_type !== 'licensed') {
    throw providerError('stripe_subscription_price_invalid', 'Stripe subscription Price is not a licensed recurring Price', false);
  }
  const quantity = Number(item.quantity ?? 1);
  if (quantity !== 1) {
    throw providerError('stripe_subscription_quantity_invalid', 'Stripe subscriptions require a quantity of one', false);
  }
  const unitAmount = Number(price.unit_amount);
  const currency = String(price.currency || subscription.currency || '').toUpperCase();
  if (!Number.isSafeInteger(unitAmount) || unitAmount < 0 || !/^[A-Z]{3}$/.test(currency)) {
    throw providerError('stripe_subscription_amount_invalid', 'Stripe subscription amount is invalid', false);
  }
  const amountMicros = stripeAmountMicros(unitAmount, currency);
  if (!Number.isSafeInteger(amountMicros)) {
    throw providerError('stripe_subscription_amount_invalid', 'Stripe subscription amount cannot be represented safely', false);
  }
  const providerStatus = String(subscription.status || '');
  const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;
  const status = stripeStatus(providerStatus, cancelAtPeriodEnd);
  const startsAt = epoch(item.current_period_start || subscription.current_period_start || subscription.start_date || subscription.created);
  const periodEndSeconds = Number(item.current_period_end || subscription.current_period_end || subscription.ended_at || 0);
  const expiresAt = epoch(periodEndSeconds || subscription.ended_at || subscription.canceled_at);
  const latestInvoice = record(subscription.latest_invoice);
  const latestInvoiceId = String(latestInvoice.id || subscription.latest_invoice || '') || null;
  const reconciliationKey = [
    'stripe-reconcile', subscriptionId, priceId, providerStatus,
    cancelAtPeriodEnd ? 'canceling' : 'renewing',
    String(periodEndSeconds || 0), latestInvoiceId || 'no-invoice',
  ].join(':');
  return {
    id: subscriptionId,
    customerId,
    priceId,
    status,
    providerStatus,
    currency,
    priceMicros: amountMicros,
    quantity,
    startsAt,
    expiresAt,
    autoRenews: ['trialing', 'active', 'past_due'].includes(providerStatus) && !cancelAtPeriodEnd,
    periodType: providerStatus === 'trialing' ? 'trial' : 'normal',
    latestInvoiceId,
    reconciliationKey,
    payload: subscription,
  };
}

export async function reconcileStripeSubscription(env: BillingEnv, row: Record<string, unknown>): Promise<VerifiedPurchase> {
  const projectId = String(row.project_id || '');
  const customerId = String(row.customer_id || '');
  const subscriptionId = String(row.original_transaction_id || '');
  const environment = row.environment === 'sandbox' ? 'sandbox' : 'production';
  const connection = await env.DB.prepare(`
    SELECT id, status, configuration_encrypted, billing_configuration_encrypted
    FROM billing_store_connections
    WHERE project_id = ? AND provider = 'stripe' AND environment = ? LIMIT 1
  `).bind(projectId, environment).first<Record<string, unknown>>();
  if (!connection || connection.status !== 'connected') {
    throw providerError('stripe_connection_required', 'A tested Stripe connection is required for reconciliation');
  }
  const encrypted = scopedStoreCredential(connection, env);
  if (!encrypted) throw providerError('stripe_connection_credentials_unavailable', 'Stripe credentials are unavailable for reconciliation');
  let credentials;
  try {
    credentials = validateStripeCredentials(JSON.parse(await decryptCredential(env, encrypted)), environment);
  } catch (error) {
    const tagged = error as { code?: string };
    if (tagged.code) throw error;
    throw providerError('stripe_connection_credentials_invalid', 'Stripe credentials cannot be decrypted');
  }
  const snapshot = await retrieveStripeSubscriptionSnapshot({
    secretKey: credentials.secret_key,
    environment,
    subscriptionId,
  });
  const customer = await env.DB.prepare(`
    SELECT id, attributes FROM billing_customers WHERE id = ? AND project_id = ? LIMIT 1
  `).bind(customerId, projectId).first<{ id: string; attributes: string }>();
  if (!customer) throw providerError('stripe_subscription_customer_not_found', 'Stripe subscription customer was not found', false);
  let attributes: Record<string, unknown> = {};
  try { attributes = record(JSON.parse(customer.attributes || '{}')); } catch { attributes = {}; }
  const storedStripeCustomerId = String(attributes.stripe_customer_id || '');
  if (storedStripeCustomerId && storedStripeCustomerId !== snapshot.customerId) {
    throw providerError('stripe_subscription_customer_mismatch', 'Stripe subscription customer does not match the billing customer', false);
  }
  if (!storedStripeCustomerId) {
    attributes.stripe_customer_id = snapshot.customerId;
    await env.DB.prepare(`UPDATE billing_customers SET attributes = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(JSON.stringify(attributes), customer.id).run();
  }
  const product = await env.DB.prepare(`
    SELECT p.id, p.metadata, pp.currency, pp.price_micros
    FROM billing_products p
    JOIN billing_product_prices pp ON pp.product_id = p.id AND pp.active = 1
    WHERE p.project_id = ? AND p.store = 'stripe' AND p.environment = ?
      AND p.store_product_id = ? AND p.product_type = 'subscription' AND p.active = 1
      AND pp.provider_price_id = ?
    LIMIT 1
  `).bind(projectId, environment, snapshot.priceId, snapshot.priceId).first<Record<string, unknown>>();
  if (!product) throw providerError('stripe_subscription_product_unmapped', 'Stripe subscription Price is not in the verified catalog', false);
  let metadata: Record<string, unknown> = {};
  try {
    metadata = record(product.metadata && typeof product.metadata === 'string' ? JSON.parse(product.metadata) : product.metadata);
  } catch {
    throw providerError('stripe_subscription_product_unverified', 'Stripe subscription Price metadata is invalid', false);
  }
  if (metadata.provider_verified !== true || metadata.stripe_price_id !== snapshot.priceId) {
    throw providerError('stripe_subscription_product_unverified', 'Stripe subscription Price is not provider-verified', false);
  }
  if (String(product.currency || '').toUpperCase() !== snapshot.currency || Number(product.price_micros) !== snapshot.priceMicros) {
    throw providerError('stripe_subscription_catalog_diverged', 'Stripe subscription Price differs from the imported catalog', false);
  }
  return {
    projectId,
    customerId,
    store: 'stripe',
    environment,
    storeProductId: snapshot.priceId,
    productType: 'subscription',
    storeTransactionId: snapshot.reconciliationKey,
    originalTransactionId: snapshot.id,
    orderId: snapshot.latestInvoiceId,
    eventType: snapshot.status === 'active' ? 'STRIPE_RENEWAL_RECONCILIATION' : `STRIPE_SUBSCRIPTION_RECONCILIATION_${snapshot.status.toUpperCase()}`,
    status: snapshot.status,
    priceMicros: snapshot.priceMicros,
    currency: snapshot.currency,
    quantity: snapshot.quantity,
    purchasedAt: snapshot.startsAt,
    eventOccurredAt: new Date().toISOString(),
    expiresAt: snapshot.expiresAt,
    autoRenews: snapshot.autoRenews,
    periodType: snapshot.periodType,
    rawPayload: { source: 'stripe_subscription_reconciliation', subscription: snapshot.payload },
  };
}
