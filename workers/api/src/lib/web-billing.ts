import type { BillingEnv } from '../types';
import { decryptCredential, encryptCredential, scopedStoreCredential } from './secrets';
import { purchasesError } from './purchases-v2';
import { identifyCustomer } from './billing';
import { validateStripeCredentials } from './stripe-credentials';

type WebConnection = {
  id: string;
  provider: 'stripe';
  environment: 'sandbox' | 'production';
  configuration_encrypted: string | null;
  billing_configuration_encrypted: string | null;
};

type CheckoutProduct = {
  package_id: string;
  product_id: string;
  product_type: string;
  store_product_id: string;
  provider_price_id?: string | null;
  store: string;
};

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function allowedReturnUrl(db: D1Database, projectId: string, value: unknown, environment: string) {
  let url: URL;
  try { url = new URL(String(value)); } catch { throw purchasesError('invalid_return_url', 'Return URL is invalid'); }
  if (url.protocol !== 'https:' && !(environment === 'sandbox' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw purchasesError('invalid_return_url', 'Return URL must use HTTPS');
  }
  const rows = await db.prepare(`
    SELECT lower(wcld.domain) AS domain, lower(replace(replace(wc.site_url, 'https://', ''), 'http://', '')) AS site
    FROM projects p JOIN applications a ON a.instance_id = p.instance_id AND a.platform = 'web'
    JOIN web_configurations wc ON wc.application_id = a.id
    LEFT JOIN web_configuration_linked_domains wcld ON wcld.web_configuration_id = wc.id
    WHERE p.id = ?
  `).bind(projectId).all<{ domain: string | null; site: string | null }>();
  const hosts = new Set((rows.results || []).flatMap((row) => [row.domain, row.site?.split('/')[0]]).filter(Boolean));
  if (hosts.size > 0 && !hosts.has(url.hostname.toLowerCase())) {
    throw purchasesError('return_url_not_allowed', 'Return URL domain is not registered for this project', 403);
  }
  return url.toString();
}

async function connectionForCheckout(env: BillingEnv, projectId: string, provider: string | null, environment: string) {
  if (provider && provider !== 'stripe') {
    throw purchasesError('unsupported_web_provider', 'Only Stripe is enabled for Web billing', 422);
  }
  const row = await env.DB.prepare(`
    SELECT * FROM billing_store_connections
    WHERE project_id = ? AND provider = 'stripe' AND environment = ? AND status IN ('configured','connected')
    LIMIT 1
  `).bind(projectId, environment).first<WebConnection>();
  if (row && scopedStoreCredential(row, env)) return row;
  throw purchasesError('web_billing_not_configured', 'Stripe is not configured', 409);
}

async function productForCheckout(
  db: D1Database,
  projectId: string,
  packageIdentifier: string,
  offeringIdentifier?: string,
): Promise<CheckoutProduct> {
  const row = await db.prepare(`
    SELECT bp.id AS package_id, p.id AS product_id, p.product_type, p.store_product_id, p.store,
      pp.provider_price_id
    FROM billing_packages bp
    JOIN billing_offerings o ON o.id = bp.offering_id
    JOIN billing_package_products bpp ON bpp.package_id = bp.id
    JOIN billing_products p ON p.id = bpp.product_id AND p.active = 1
    LEFT JOIN billing_product_prices pp ON pp.product_id = p.id AND pp.active = 1
    WHERE o.project_id = ? AND bp.identifier = ?
      AND (? IS NULL OR o.identifier = ?)
      AND p.store = 'stripe'
    LIMIT 1
  `).bind(projectId, packageIdentifier, offeringIdentifier || null, offeringIdentifier || null).first<CheckoutProduct>();
  if (!row) throw purchasesError('web_package_not_found', 'No Web product is mapped to this package', 404);
  return row;
}

async function providerCredentials(env: BillingEnv, connection: WebConnection) {
  let value: unknown;
  const encrypted = scopedStoreCredential(connection, env);
  if (!encrypted) throw purchasesError('connection_credentials_invalid', `${connection.provider} credentials are unavailable for this execution domain`, 500);
  try { value = JSON.parse(await decryptCredential(env, encrypted)); }
  catch { throw purchasesError('connection_credentials_invalid', `${connection.provider} credentials cannot be decrypted`, 500); }
  return validateStripeCredentials(parseObject(value), connection.environment);
}

async function stripeRequest(secretKey: string, path: string, values: Record<string, string>, idempotencyKey?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(values),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw purchasesError('stripe_request_failed', payload?.error?.message || 'Stripe request failed', response.status >= 500 ? 503 : 422, response.status >= 500);
  return payload;
}

export async function createWebCheckoutSession(env: BillingEnv, params: {
  projectId: string;
  customerId: string;
  packageIdentifier: string;
  offeringIdentifier?: string;
  provider?: string;
  environment: 'sandbox' | 'production';
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}) {
  if (!params.idempotencyKey || params.idempotencyKey !== params.idempotencyKey.trim() || params.idempotencyKey.length > 200) {
    throw purchasesError('idempotency_key_invalid', 'Idempotency key must contain between 1 and 200 characters without surrounding whitespace');
  }
  const existing = await checkoutByIdempotency(env.DB, params.projectId, params.idempotencyKey);
  if (existing) {
    if (existing.customer_id !== params.customerId || existing.environment !== params.environment) {
      throw purchasesError('checkout_idempotency_conflict', 'Checkout idempotency key is already bound to another customer or environment', 409);
    }
    if (existing.checkout_url && existing.provider_session_id) {
      return completedCheckoutResult(env, existing, true);
    }
  }
  const [product, successUrl, cancelUrl] = await Promise.all([
    productForCheckout(env.DB, params.projectId, params.packageIdentifier, params.offeringIdentifier),
    allowedReturnUrl(env.DB, params.projectId, params.successUrl, params.environment),
    allowedReturnUrl(env.DB, params.projectId, params.cancelUrl, params.environment),
  ]);
  const customer = await env.DB.prepare('SELECT attributes FROM billing_customers WHERE id = ? AND project_id = ? LIMIT 1')
    .bind(params.customerId, params.projectId).first<{ attributes: string }>();
  if (!customer) throw purchasesError('customer_not_found', 'Customer not found', 404);
  const stripeCustomerId = String(parseObject(customer.attributes).stripe_customer_id || '');
  if (stripeCustomerId && !stripeCustomerId.startsWith('cus_')) {
    throw purchasesError('stripe_customer_invalid', 'The stored Stripe customer identifier is invalid', 409);
  }
  const connection = await connectionForCheckout(env, params.projectId, params.provider || product.store, params.environment);
  const credentials = await providerCredentials(env, connection);
  const priceId = product.provider_price_id || product.store_product_id;
  const proposedId = crypto.randomUUID();
  const proposedLease = crypto.randomUUID();
  const proposedRedemptionCode = crypto.randomUUID().replaceAll('-', '');
  const requestFingerprint = await sha256(JSON.stringify([
    params.customerId,
    params.environment,
    connection.id,
    product.package_id,
    product.product_id,
    priceId,
    successUrl,
    cancelUrl,
  ]));
  const encryptedRedemptionCode = await encryptCredential(env, proposedRedemptionCode);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_checkout_sessions (
      id, project_id, customer_id, connection_id, provider, environment, package_id,
      product_id, success_url, cancel_url, idempotency_key, status, expires_at,
      request_fingerprint, redemption_code_encrypted, processing_lease_id, processing_started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', datetime('now', '+24 hours'), ?, ?, ?, datetime('now'))
  `).bind(
    proposedId, params.projectId, params.customerId, connection.id, connection.provider,
    params.environment, product.package_id, product.product_id, successUrl, cancelUrl,
    params.idempotencyKey, requestFingerprint, encryptedRedemptionCode, proposedLease,
  ).run();
  let checkout = await checkoutByIdempotency(env.DB, params.projectId, params.idempotencyKey);
  if (!checkout) throw purchasesError('checkout_reservation_failed', 'Checkout could not be reserved', 503, true);
  if (checkout.customer_id !== params.customerId || checkout.environment !== params.environment
    || (checkout.request_fingerprint && checkout.request_fingerprint !== requestFingerprint)) {
    throw purchasesError('checkout_idempotency_conflict', 'Checkout idempotency key is already bound to different checkout parameters', 409);
  }
  if (checkout.checkout_url && checkout.provider_session_id) return completedCheckoutResult(env, checkout, true);
  if (checkout.status === 'failed') {
    throw purchasesError('checkout_previously_failed', 'Checkout previously failed; start a new checkout with a new idempotency key', 409);
  }
  if (!checkout.request_fingerprint) {
    throw purchasesError('checkout_recovery_unavailable', 'This unfinished checkout cannot be recovered; start a new checkout with a new idempotency key', 409);
  }
  if (checkout.processing_lease_id !== proposedLease) {
    await env.DB.prepare(`
      UPDATE billing_checkout_sessions
      SET processing_lease_id = ?, processing_started_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'creating'
        AND (processing_lease_id IS NULL OR processing_started_at IS NULL OR datetime(processing_started_at) <= datetime('now', '-2 minutes'))
    `).bind(proposedLease, checkout.id).run();
    checkout = await checkoutByIdempotency(env.DB, params.projectId, params.idempotencyKey);
    if (!checkout || checkout.processing_lease_id !== proposedLease) {
      throw purchasesError('checkout_in_progress', 'Checkout creation is already in progress', 409, true);
    }
  }
  if (!checkout.redemption_code_encrypted) {
    await releaseCheckoutLease(env.DB, checkout.id, proposedLease, 'failed');
    throw purchasesError('checkout_redemption_unavailable', 'Checkout recovery data is unavailable; start a new checkout with a new idempotency key', 409);
  }
  const localId = checkout.id;
  let redemptionCode: string;
  try {
    redemptionCode = await decryptCredential(env, checkout.redemption_code_encrypted);
  } catch {
    await releaseCheckoutLease(env.DB, localId, proposedLease, 'failed');
    throw purchasesError('checkout_redemption_invalid', 'Checkout recovery data could not be decrypted; start a new checkout with a new idempotency key', 409);
  }
  await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_redemptions (id, project_id, checkout_session_id, code_hash, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+24 hours'))
  `).bind(crypto.randomUUID(), params.projectId, localId, await sha256(redemptionCode)).run();
  const secretKey = credentials.secret_key;
  const mode = product.product_type === 'subscription' ? 'subscription' : 'payment';
  const values: Record<string, string> = {
    mode,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: params.customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'metadata[opengrow_project_id]': params.projectId,
    'metadata[opengrow_customer_id]': params.customerId,
    'metadata[opengrow_checkout_id]': localId,
    'metadata[opengrow_redemption_code]': redemptionCode,
  };
  if (stripeCustomerId) values.customer = stripeCustomerId;
  else if (mode === 'payment') values.customer_creation = 'always';
  if (mode === 'subscription') {
    values['subscription_data[metadata][opengrow_project_id]'] = params.projectId;
    values['subscription_data[metadata][opengrow_customer_id]'] = params.customerId;
    values['subscription_data[metadata][opengrow_checkout_id]'] = localId;
  } else {
    values['payment_intent_data[metadata][opengrow_project_id]'] = params.projectId;
    values['payment_intent_data[metadata][opengrow_customer_id]'] = params.customerId;
    values['payment_intent_data[metadata][opengrow_checkout_id]'] = localId;
  }
  let session: Record<string, any>;
  const stripeIdempotencyKey = `opengrow-checkout-${await sha256(`${params.projectId}:${params.idempotencyKey}`)}`;
  try {
    session = await stripeRequest(secretKey, '/checkout/sessions', values, stripeIdempotencyKey);
  } catch (error) {
    const retryable = (error as { retryable?: boolean }).retryable === true;
    await releaseCheckoutLease(env.DB, localId, proposedLease, retryable ? 'creating' : 'failed');
    throw error;
  }
  const providerSessionId = String(session.id || '');
  const checkoutUrl = String(session.url || '');
  if (!providerSessionId || !checkoutUrl) {
    await releaseCheckoutLease(env.DB, localId, proposedLease, 'creating');
    throw purchasesError('checkout_session_incomplete', 'Provider did not return a checkout URL', 502, true);
  }
  await env.DB.prepare(`
    UPDATE billing_checkout_sessions
    SET provider_session_id = ?, checkout_url = ?, status = 'created',
      processing_lease_id = NULL, processing_started_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND processing_lease_id = ?
  `).bind(providerSessionId, checkoutUrl, localId, proposedLease).run();
  const persisted = await checkoutByIdempotency(env.DB, params.projectId, params.idempotencyKey);
  if (!persisted?.checkout_url || persisted.provider_session_id !== providerSessionId) {
    throw purchasesError('checkout_persistence_pending', 'Checkout was created but has not been persisted yet', 503, true);
  }
  return completedCheckoutResult(env, persisted, false);
}

type ReservedCheckout = {
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

async function checkoutByIdempotency(db: D1Database, projectId: string, idempotencyKey: string) {
  return db.prepare(`
    SELECT id, customer_id, environment, provider, status, checkout_url, provider_session_id,
      request_fingerprint, redemption_code_encrypted, processing_lease_id, processing_started_at
    FROM billing_checkout_sessions WHERE project_id = ? AND idempotency_key = ? LIMIT 1
  `).bind(projectId, idempotencyKey).first<ReservedCheckout>();
}

async function releaseCheckoutLease(
  db: D1Database,
  checkoutId: string,
  leaseId: string,
  status: 'creating' | 'failed',
) {
  await db.prepare(`
    UPDATE billing_checkout_sessions
    SET status = ?, processing_lease_id = NULL, processing_started_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND processing_lease_id = ?
  `).bind(status, checkoutId, leaseId).run();
}

async function completedCheckoutResult(env: BillingEnv, checkout: ReservedCheckout, duplicate: boolean) {
  let redemptionCode: string | undefined;
  if (checkout.redemption_code_encrypted) {
    try { redemptionCode = await decryptCredential(env, checkout.redemption_code_encrypted); }
    catch { throw purchasesError('checkout_redemption_invalid', 'Checkout recovery data could not be decrypted', 500, true); }
  }
  return {
    url: String(checkout.checkout_url),
    provider: checkout.provider,
    provider_session_id: String(checkout.provider_session_id),
    ...(redemptionCode ? { redemption_code: redemptionCode } : {}),
    duplicate,
  };
}

export async function createWebPortalSession(env: BillingEnv, params: {
  projectId: string;
  customerId: string;
  environment: 'sandbox' | 'production';
  returnUrl: string;
}) {
  const customer = await env.DB.prepare('SELECT attributes FROM billing_customers WHERE id = ? AND project_id = ?')
    .bind(params.customerId, params.projectId).first<{ attributes: string }>();
  if (!customer) throw purchasesError('customer_not_found', 'Customer not found', 404);
  const attributes = parseObject(customer.attributes);
  const stripeCustomerId = String(attributes.stripe_customer_id || '');
  if (!stripeCustomerId) throw purchasesError('portal_customer_missing', 'This customer has no Stripe billing profile', 409);
  const connection = await connectionForCheckout(env, params.projectId, 'stripe', params.environment);
  const credentials = await providerCredentials(env, connection);
  const returnUrl = await allowedReturnUrl(env.DB, params.projectId, params.returnUrl, params.environment);
  const session = await stripeRequest(credentials.secret_key, '/billing_portal/sessions', {
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

export async function redeemWebPurchase(env: BillingEnv, params: { projectId: string; customerId: string; code: string }) {
  const codeHash = await sha256(params.code.trim());
  const redemption = await env.DB.prepare(`
    SELECT r.id, r.status, r.expires_at, s.customer_id AS original_customer_id, s.status AS checkout_status
    FROM billing_redemptions r JOIN billing_checkout_sessions s ON s.id = r.checkout_session_id
    WHERE r.project_id = ? AND r.code_hash = ? LIMIT 1
  `).bind(params.projectId, codeHash).first<Record<string, any>>();
  if (!redemption || Date.parse(String(redemption.expires_at)) <= Date.now()) throw purchasesError('redemption_not_found', 'Redemption code is invalid or expired', 404);
  if (redemption.status === 'redeemed' && redemption.original_customer_id !== params.customerId) throw purchasesError('redemption_already_used', 'Redemption code has already been used', 409);
  if (!['active', 'trialing', 'cancelled', 'grace_period'].includes(String(redemption.checkout_status))) {
    throw purchasesError('checkout_not_paid', 'Checkout has not completed successfully', 409, true);
  }
  let redeemedCustomerId = params.customerId;
  if (redemption.original_customer_id && redemption.original_customer_id !== params.customerId) {
    const [source, target] = await Promise.all([
      env.DB.prepare('SELECT primary_app_user_id FROM billing_customers WHERE id = ? AND project_id = ?').bind(redemption.original_customer_id, params.projectId).first<{ primary_app_user_id: string }>(),
      env.DB.prepare('SELECT primary_app_user_id FROM billing_customers WHERE id = ? AND project_id = ?').bind(params.customerId, params.projectId).first<{ primary_app_user_id: string }>(),
    ]);
    if (!source || !target) throw purchasesError('redemption_customer_not_found', 'Redemption customer could not be resolved', 404);
    const merged = await identifyCustomer(env.DB, params.projectId, source.primary_app_user_id, target.primary_app_user_id);
    redeemedCustomerId = String(merged?.id || params.customerId);
  }
  await env.DB.prepare(`UPDATE billing_redemptions SET status = 'redeemed', redeemed_by_customer_id = ?, redeemed_at = datetime('now') WHERE id = ?`)
    .bind(redeemedCustomerId, redemption.id).run();
  return { redeemed: true, customer_id: redeemedCustomerId };
}
