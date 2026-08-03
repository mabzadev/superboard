import type { BillingEnv } from '../types';
import { decryptCredential } from './secrets';
import { purchasesError } from './purchases-v2';
import { identifyCustomer } from './billing';

type WebConnection = {
  id: string;
  provider: 'stripe';
  environment: 'sandbox' | 'production';
  configuration_encrypted: string;
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
      AND configuration_encrypted IS NOT NULL LIMIT 1
  `).bind(projectId, environment).first<WebConnection>();
  if (row) return row;
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
  try { value = JSON.parse(await decryptCredential(env, connection.configuration_encrypted)); }
  catch { throw purchasesError('connection_credentials_invalid', `${connection.provider} credentials cannot be decrypted`, 500); }
  return parseObject(value);
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
  const existing = await env.DB.prepare(`SELECT checkout_url, provider_session_id FROM billing_checkout_sessions WHERE project_id = ? AND idempotency_key = ?`)
    .bind(params.projectId, params.idempotencyKey).first<{ checkout_url: string; provider_session_id: string }>();
  if (existing) return { url: existing.checkout_url, provider_session_id: existing.provider_session_id, duplicate: true };
  const [product, successUrl, cancelUrl] = await Promise.all([
    productForCheckout(env.DB, params.projectId, params.packageIdentifier, params.offeringIdentifier),
    allowedReturnUrl(env.DB, params.projectId, params.successUrl, params.environment),
    allowedReturnUrl(env.DB, params.projectId, params.cancelUrl, params.environment),
  ]);
  const connection = await connectionForCheckout(env, params.projectId, params.provider || product.store, params.environment);
  const credentials = await providerCredentials(env, connection);
  const priceId = product.provider_price_id || product.store_product_id;
  const localId = crypto.randomUUID();
  const redemptionCode = crypto.randomUUID().replaceAll('-', '');
  const secretKey = String(credentials.secret_key || credentials.api_key || '');
  if (!secretKey.startsWith('sk_')) throw purchasesError('stripe_secret_invalid', 'Stripe secret key is invalid');
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
  if (mode === 'subscription') {
    values['subscription_data[metadata][opengrow_project_id]'] = params.projectId;
    values['subscription_data[metadata][opengrow_customer_id]'] = params.customerId;
    values['subscription_data[metadata][opengrow_checkout_id]'] = localId;
  }
  const session = await stripeRequest(secretKey, '/checkout/sessions', values, `opengrow-${params.projectId}-${params.idempotencyKey}`.slice(0, 255));
  const providerSessionId = String(session.id || '');
  const checkoutUrl = String(session.url || '');
  if (!providerSessionId || !checkoutUrl) throw purchasesError('checkout_session_incomplete', 'Provider did not return a checkout URL', 502, true);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO billing_checkout_sessions (
        id, project_id, customer_id, connection_id, provider, environment, package_id,
        product_id, provider_session_id, checkout_url, success_url, cancel_url,
        idempotency_key, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))
    `).bind(localId, params.projectId, params.customerId, connection.id, connection.provider, params.environment, product.package_id, product.product_id, providerSessionId, checkoutUrl, successUrl, cancelUrl, params.idempotencyKey),
    env.DB.prepare(`
      INSERT INTO billing_redemptions (id, project_id, checkout_session_id, code_hash, expires_at)
      VALUES (?, ?, ?, ?, datetime('now', '+24 hours'))
    `).bind(crypto.randomUUID(), params.projectId, localId, await sha256(redemptionCode)),
  ]);
  return { url: checkoutUrl, provider: connection.provider, provider_session_id: providerSessionId, redemption_code: redemptionCode, duplicate: false };
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
  const session = await stripeRequest(String(credentials.secret_key || credentials.api_key || ''), '/billing_portal/sessions', {
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
