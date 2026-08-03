import { Env } from '../types';
import { entitlementIsActive } from './billing-state';
import { recordCanonicalBillingEvent } from './purchases-v2';

export const BILLING_STATUSES = [
  'pending',
  'trialing',
  'active',
  'grace_period',
  'billing_issue',
  'paused',
  'cancelled',
  'expired',
  'revoked',
  'refunded',
] as const;

export type BillingStatus = typeof BILLING_STATUSES[number];
export type BillingStore = 'apple' | 'google' | 'stripe' | 'promotional';
export type BillingEnvironment = 'sandbox' | 'production';

export type VerifiedPurchase = {
  projectId: string | number;
  applicationId?: string | number | null;
  customerId?: string | null;
  store: Exclude<BillingStore, 'promotional'>;
  environment: BillingEnvironment;
  storeProductId: string;
  productType: 'subscription' | 'non_consumable' | 'consumable';
  storeTransactionId: string;
  originalTransactionId?: string | null;
  orderId?: string | null;
  purchaseToken?: string | null;
  eventType: string;
  status: BillingStatus;
  priceMicros?: number | null;
  currency?: string | null;
  quantity?: number;
  purchasedAt?: string | null;
  eventOccurredAt?: string | null;
  expiresAt?: string | null;
  autoRenews?: boolean;
  periodType?: 'normal' | 'trial' | 'intro';
  rawPayload: unknown;
  transfer?: boolean;
};

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function findCustomerByAppUserId(db: D1Database, projectId: string | number, appUserId: string) {
  return db.prepare(`
    SELECT c.*
    FROM billing_customer_aliases a
    JOIN billing_customers c ON c.id = a.customer_id
    WHERE a.project_id = ? AND a.app_user_id = ?
    LIMIT 1
  `).bind(String(projectId), appUserId).first<Record<string, unknown>>();
}

export async function getOrCreateCustomer(
  db: D1Database,
  projectId: string | number,
  appUserId: string,
  anonymous: boolean,
) {
  const normalized = appUserId.trim();
  if (!normalized || normalized.length > 255) throw new Error('Invalid app user ID');
  const existing = await findCustomerByAppUserId(db, projectId, normalized);
  if (existing) {
    await db.prepare('UPDATE billing_customers SET last_seen_at = datetime("now"), updated_at = datetime("now") WHERE id = ?')
      .bind(existing.id).run();
    return existing;
  }
  const customerId = crypto.randomUUID();
  await db.batch([
    db.prepare(`
      INSERT INTO billing_customers (id, project_id, primary_app_user_id, anonymous)
      VALUES (?, ?, ?, ?)
    `).bind(customerId, String(projectId), normalized, anonymous ? 1 : 0),
    db.prepare(`
      INSERT INTO billing_customer_aliases (project_id, customer_id, app_user_id, alias_type)
      VALUES (?, ?, ?, ?)
    `).bind(String(projectId), customerId, normalized, anonymous ? 'anonymous' : 'identified'),
  ]);
  return db.prepare('SELECT * FROM billing_customers WHERE id = ?').bind(customerId).first<Record<string, unknown>>();
}

export async function identifyCustomer(
  db: D1Database,
  projectId: string | number,
  currentAppUserId: string,
  targetAppUserId: string,
) {
  const source = await getOrCreateCustomer(db, projectId, currentAppUserId, currentAppUserId.startsWith('$opengrow_anon_'));
  const target = await findCustomerByAppUserId(db, projectId, targetAppUserId)
    || await getOrCreateCustomer(db, projectId, targetAppUserId, false);
  if (!source || !target) throw new Error('Unable to identify customer');
  if (source.id === target.id) return target;

  const targetAnonymous = Number(target.anonymous) === 1;
  const sourceAnonymous = Number(source.anonymous) === 1;
  const destination = targetAnonymous && !sourceAnonymous ? source : target;
  const merged = destination.id === source.id ? target : source;

  await db.batch([
    db.prepare('UPDATE OR IGNORE billing_customer_aliases SET customer_id = ? WHERE customer_id = ?')
      .bind(destination.id, merged.id),
    db.prepare('UPDATE billing_transactions SET customer_id = ? WHERE customer_id = ?').bind(destination.id, merged.id),
    db.prepare('UPDATE billing_subscriptions SET customer_id = ? WHERE customer_id = ?').bind(destination.id, merged.id),
    db.prepare('UPDATE billing_events SET customer_id = ? WHERE customer_id = ?').bind(destination.id, merged.id),
    db.prepare('UPDATE billing_paywall_events SET customer_id = ? WHERE customer_id = ?').bind(destination.id, merged.id),
    db.prepare('UPDATE billing_checkout_sessions SET customer_id = ? WHERE customer_id = ?').bind(destination.id, merged.id),
    db.prepare('UPDATE billing_redemptions SET redeemed_by_customer_id = ? WHERE redeemed_by_customer_id = ?').bind(destination.id, merged.id),
    db.prepare('UPDATE OR IGNORE billing_experiment_assignments SET customer_id = ? WHERE customer_id = ?').bind(destination.id, merged.id),
    db.prepare('DELETE FROM billing_experiment_assignments WHERE customer_id = ?').bind(merged.id),
    db.prepare('UPDATE OR IGNORE billing_customer_entitlements SET customer_id = ? WHERE customer_id = ?').bind(destination.id, merged.id),
    db.prepare('UPDATE billing_balance_ledger SET customer_id = ? WHERE customer_id = ?').bind(destination.id, merged.id),
    db.prepare('DELETE FROM billing_customer_entitlements WHERE customer_id = ?').bind(merged.id),
    db.prepare('DELETE FROM billing_customers WHERE id = ?').bind(merged.id),
    db.prepare(`
      UPDATE billing_customers
      SET primary_app_user_id = ?, anonymous = 0, last_seen_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).bind(targetAppUserId, destination.id),
  ]);
  return db.prepare('SELECT * FROM billing_customers WHERE id = ?').bind(destination.id).first<Record<string, unknown>>();
}

async function getOrCreateProduct(db: D1Database, purchase: VerifiedPurchase) {
  const existing = await db.prepare(`
    SELECT * FROM billing_products
    WHERE project_id = ? AND store = ? AND environment = ? AND store_product_id = ?
    LIMIT 1
  `).bind(String(purchase.projectId), purchase.store, purchase.environment, purchase.storeProductId).first<Record<string, unknown>>();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO billing_products (
      id, project_id, application_id, store, environment, store_product_id, product_type, display_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    String(purchase.projectId),
    purchase.applicationId ? String(purchase.applicationId) : null,
    purchase.store,
    purchase.environment,
    purchase.storeProductId,
    purchase.productType,
    purchase.storeProductId,
  ).run();
  return db.prepare('SELECT * FROM billing_products WHERE id = ?').bind(id).first<Record<string, unknown>>();
}

async function syncEntitlements(db: D1Database, purchase: VerifiedPurchase, productId: string) {
  if (!purchase.customerId || purchase.productType === 'consumable') return;
  const mappings = await db.prepare(`
    SELECT e.id
    FROM billing_product_entitlements pe
    JOIN billing_entitlements e ON e.id = pe.entitlement_id
    WHERE pe.product_id = ? AND e.active = 1
  `).bind(productId).all<{ id: string }>();
  const active = entitlementIsActive(purchase.status, purchase.expiresAt);
  for (const entitlement of mappings.results || []) {
    await db.prepare(`
      INSERT INTO billing_customer_entitlements (
        project_id, customer_id, entitlement_id, product_id, source, status,
        starts_at, expires_at, will_renew, verification
      ) VALUES (?, ?, ?, ?, 'purchase', ?, COALESCE(?, datetime('now')), ?, ?, 'verified')
      ON CONFLICT(customer_id, entitlement_id, source) DO UPDATE SET
        product_id = excluded.product_id,
        status = excluded.status,
        starts_at = excluded.starts_at,
        expires_at = excluded.expires_at,
        will_renew = excluded.will_renew,
        verification = 'verified',
        updated_at = datetime('now')
    `).bind(
      String(purchase.projectId),
      purchase.customerId,
      entitlement.id,
      productId,
      active ? purchase.status : 'inactive',
      purchase.purchasedAt || null,
      purchase.expiresAt || null,
      active && purchase.autoRenews ? 1 : 0,
    ).run();
  }
}

async function creditProductCurrencies(
  db: D1Database,
  purchase: VerifiedPurchase,
  product: Record<string, unknown>,
  transactionId: string,
) {
  if (!purchase.customerId || !['active', 'trialing'].includes(purchase.status)) return;
  const configured = await db.prepare(`
    SELECT vc.code, vcp.grant_amount, vcp.trial_grant_amount, vcp.grant_cadence,
      vcp.expires_after_seconds
    FROM billing_virtual_currency_products vcp
    JOIN billing_virtual_currencies vc ON vc.id = vcp.currency_id AND vc.active = 1
    WHERE vcp.product_id = ?
  `).bind(String(product.id)).all<Record<string, unknown>>();
  if ((configured.results || []).length > 0) {
    for (const currency of configured.results || []) {
      const cadence = String(currency.grant_cadence || 'purchase');
      if (cadence === 'renewal' && !/renew/i.test(purchase.eventType)) continue;
      if (cadence === 'initial' && /renew/i.test(purchase.eventType)) continue;
      const baseAmount = purchase.status === 'trialing' && currency.trial_grant_amount != null
        ? Number(currency.trial_grant_amount)
        : Number(currency.grant_amount || 0);
      const units = baseAmount * Math.max(1, purchase.quantity || 1);
      if (!Number.isSafeInteger(units) || units <= 0) continue;
      const expiresAt = Number(currency.expires_after_seconds || 0) > 0
        ? new Date(Date.now() + Number(currency.expires_after_seconds) * 1000).toISOString()
        : null;
      await db.prepare(`
        INSERT OR IGNORE INTO billing_balance_ledger (
          project_id, customer_id, product_id, transaction_id, currency_identifier,
          amount, reason, idempotency_key, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        String(purchase.projectId), purchase.customerId, product.id, transactionId,
        currency.code, units, purchase.status === 'trialing' ? 'trial_grant' : 'purchase_grant',
        `${purchase.store}:${purchase.environment}:${purchase.storeTransactionId}:${currency.code}:credit`, expiresAt,
      ).run();
    }
    return;
  }
  if (purchase.productType !== 'consumable') return;
  const metadata = parseJson(product.metadata);
  const currencyIdentifier = typeof metadata.currency_identifier === 'string' ? metadata.currency_identifier : purchase.storeProductId;
  const units = Number(metadata.credit_amount || 1) * Math.max(1, purchase.quantity || 1);
  await db.prepare(`
    INSERT OR IGNORE INTO billing_balance_ledger (
      project_id, customer_id, product_id, transaction_id, currency_identifier,
      amount, reason, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, 'purchase', ?)
  `).bind(
    String(purchase.projectId),
    purchase.customerId,
    product.id,
    transactionId,
    currencyIdentifier,
    units,
    `${purchase.store}:${purchase.environment}:${purchase.storeTransactionId}:credit`,
  ).run();
}

async function queueOutboundWebhooks(env: Env, purchase: VerifiedPurchase, transactionId: string) {
  const endpoints = await env.DB.prepare(`
    SELECT id, environments, event_types
    FROM billing_webhook_endpoints
    WHERE project_id = ? AND active = 1
  `).bind(String(purchase.projectId)).all<Record<string, unknown>>();
  for (const endpoint of endpoints.results || []) {
    const environments = Array.isArray(endpoint.environments) ? endpoint.environments : JSON.parse(String(endpoint.environments || '[]'));
    const eventTypes = Array.isArray(endpoint.event_types) ? endpoint.event_types : JSON.parse(String(endpoint.event_types || '[]'));
    if (environments.length > 0 && !environments.includes(purchase.environment)) continue;
    if (eventTypes.length > 0 && !eventTypes.includes(purchase.eventType)) continue;
    const deliveryId = crypto.randomUUID();
    const payload = JSON.stringify({
      id: deliveryId,
      type: purchase.eventType,
      project_id: String(purchase.projectId),
      customer_id: purchase.customerId,
      transaction_id: transactionId,
      store: purchase.store,
      environment: purchase.environment,
      product_id: purchase.storeProductId,
      status: purchase.status,
      occurred_at: new Date().toISOString(),
    });
    await env.DB.prepare(`
      INSERT INTO billing_webhook_deliveries (id, endpoint_id, transaction_id, event_type, payload)
      VALUES (?, ?, ?, ?, ?)
    `).bind(deliveryId, endpoint.id, transactionId, purchase.eventType, payload).run();
    if (env.BILLING_QUEUE) {
      await env.BILLING_QUEUE.send({ type: 'billing.webhook.deliver', deliveryId });
    }
  }
}

export async function applyVerifiedPurchase(env: Env, purchase: VerifiedPurchase) {
  if (!BILLING_STATUSES.includes(purchase.status)) throw new Error(`Unsupported billing status: ${purchase.status}`);
  const product = await getOrCreateProduct(env.DB, purchase);
  if (!product?.id) throw new Error('Unable to resolve billing product');
  const transactionId = crypto.randomUUID();
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_transactions (
      id, project_id, application_id, customer_id, product_id, store, environment,
      store_transaction_id, original_transaction_id, order_id, purchase_token,
      event_type, status, price_micros, currency, quantity, purchased_at,
      expires_at, event_occurred_at, verified_at, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).bind(
    transactionId,
    String(purchase.projectId),
    purchase.applicationId ? String(purchase.applicationId) : null,
    purchase.customerId || null,
    String(product.id),
    purchase.store,
    purchase.environment,
    purchase.storeTransactionId,
    purchase.originalTransactionId || purchase.storeTransactionId,
    purchase.orderId || null,
    purchase.purchaseToken || null,
    purchase.eventType,
    purchase.status,
    purchase.priceMicros ?? null,
    purchase.currency || null,
    Math.max(1, purchase.quantity || 1),
    purchase.purchasedAt || null,
    purchase.expiresAt || null,
    purchase.eventOccurredAt || purchase.purchasedAt || new Date().toISOString(),
    JSON.stringify(purchase.rawPayload),
  ).run();

  const stored = await env.DB.prepare(`
    SELECT id FROM billing_transactions
    WHERE project_id = ? AND store = ? AND environment = ? AND store_transaction_id = ? AND event_type = ?
    LIMIT 1
  `).bind(
    String(purchase.projectId),
    purchase.store,
    purchase.environment,
    purchase.storeTransactionId,
    purchase.eventType,
  ).first<{ id: string }>();
  if (!stored) throw new Error('Unable to persist verified transaction');

  let subscriptionAccepted = true;
  if (purchase.productType === 'subscription') {
    await env.DB.prepare(`
      INSERT INTO billing_subscriptions (
        project_id, application_id, customer_id, product_id, store, environment,
        original_transaction_id, latest_transaction_id, status, period_type,
        starts_at, expires_at, latest_event_at, auto_renews, will_renew
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, store, environment, original_transaction_id) DO UPDATE SET
        application_id = COALESCE(excluded.application_id, billing_subscriptions.application_id),
        customer_id = COALESCE(excluded.customer_id, billing_subscriptions.customer_id),
        product_id = excluded.product_id,
        latest_transaction_id = excluded.latest_transaction_id,
        status = excluded.status,
        period_type = excluded.period_type,
        starts_at = COALESCE(excluded.starts_at, billing_subscriptions.starts_at),
        expires_at = excluded.expires_at,
        latest_event_at = excluded.latest_event_at,
        auto_renews = excluded.auto_renews,
        will_renew = excluded.will_renew,
        updated_at = datetime('now')
      WHERE datetime(COALESCE(excluded.latest_event_at, '1970-01-01')) >=
            datetime(COALESCE(billing_subscriptions.latest_event_at, '1970-01-01'))
    `).bind(
      String(purchase.projectId),
      purchase.applicationId ? String(purchase.applicationId) : null,
      purchase.customerId || null,
      String(product.id),
      purchase.store,
      purchase.environment,
      purchase.originalTransactionId || purchase.storeTransactionId,
      stored.id,
      purchase.status,
      purchase.periodType || (purchase.status === 'trialing' ? 'trial' : 'normal'),
      purchase.purchasedAt || null,
      purchase.expiresAt || null,
      purchase.eventOccurredAt || purchase.purchasedAt || new Date().toISOString(),
      purchase.autoRenews ? 1 : 0,
      purchase.autoRenews && !['cancelled', 'expired', 'revoked', 'refunded'].includes(purchase.status) ? 1 : 0,
    ).run();
    const current = await env.DB.prepare(`
      SELECT latest_transaction_id FROM billing_subscriptions
      WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id = ?
    `).bind(
      String(purchase.projectId),
      purchase.store,
      purchase.environment,
      purchase.originalTransactionId || purchase.storeTransactionId,
    ).first<{ latest_transaction_id: string }>();
    subscriptionAccepted = current?.latest_transaction_id === stored.id;
  }

  if (purchase.customerId && purchase.transfer === true) {
    await env.DB.prepare(`
      DELETE FROM billing_customer_entitlements
      WHERE product_id = ? AND source = 'purchase' AND customer_id <> ?
    `).bind(String(product.id), purchase.customerId).run();
  }
  if (subscriptionAccepted) await syncEntitlements(env.DB, purchase, String(product.id));
  await creditProductCurrencies(env.DB, purchase, product, stored.id);
  await recordCanonicalBillingEvent(env, purchase, stored.id);
  if (insert.meta.changes > 0) await queueOutboundWebhooks(env, purchase, stored.id);
  return { transactionId: stored.id, duplicate: insert.meta.changes === 0 };
}

export async function customerInfo(db: D1Database, projectId: string | number, customerId: string) {
  const customer = await db.prepare('SELECT * FROM billing_customers WHERE id = ? AND project_id = ?')
    .bind(customerId, String(projectId)).first<Record<string, unknown>>();
  if (!customer) throw new Error('Customer not found');
  const aliases = await db.prepare('SELECT app_user_id FROM billing_customer_aliases WHERE customer_id = ? ORDER BY created_at')
    .bind(customerId).all<{ app_user_id: string }>();
  const rows = await db.prepare(`
    SELECT ce.*, e.identifier, p.store_product_id, p.store
    FROM billing_customer_entitlements ce
    JOIN billing_entitlements e ON e.id = ce.entitlement_id
    LEFT JOIN billing_products p ON p.id = ce.product_id
    WHERE ce.customer_id = ?
    ORDER BY e.identifier
  `).bind(customerId).all<Record<string, unknown>>();
  const subscriptions = await db.prepare(`
    SELECT s.*, p.store_product_id
    FROM billing_subscriptions s
    LEFT JOIN billing_products p ON p.id = s.product_id
    WHERE s.customer_id = ?
    ORDER BY COALESCE(s.expires_at, s.updated_at) DESC
  `).bind(customerId).all<Record<string, unknown>>();
  const balances = await db.prepare(`
    SELECT currency_identifier, COALESCE(SUM(amount), 0) AS balance
    FROM billing_balance_ledger
    WHERE customer_id = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    GROUP BY currency_identifier
  `).bind(customerId).all<{ currency_identifier: string; balance: number }>();
  const entitlements: Record<string, unknown> = {};
  for (const row of rows.results || []) {
    entitlements[String(row.identifier)] = {
      identifier: row.identifier,
      is_active: entitlementIsActive(String(row.status), row.expires_at as string | null),
      status: row.status,
      product_id: row.store_product_id,
      store: row.store,
      starts_at: row.starts_at,
      expires_at: row.expires_at,
      will_renew: Number(row.will_renew) === 1,
      verification: row.verification,
    };
  }
  const subscriptionRows: Array<Record<string, unknown>> = (subscriptions.results || []).map((row) => ({
    ...row,
    management_url: row.store === 'apple'
      ? 'https://apps.apple.com/account/subscriptions'
      : row.store === 'google'
        ? 'https://play.google.com/store/account/subscriptions'
        : null,
  }));
  return {
    original_app_user_id: customer.primary_app_user_id,
    aliases: (aliases.results || []).map((row) => row.app_user_id),
    request_date: new Date().toISOString(),
    entitlements,
    active_subscriptions: subscriptionRows
      .filter((row) => entitlementIsActive(String(row.status), row.expires_at as string | null))
      .map((row) => row.store_product_id),
    subscriptions: subscriptionRows,
    balances: Object.fromEntries((balances.results || []).map((row) => [row.currency_identifier, Number(row.balance)])),
  };
}

export async function offeringsForCustomer(
  db: D1Database,
  projectId: string | number,
  platform: string,
  environment: string,
  placement = 'default',
) {
  const offerings = await db.prepare(`
    SELECT * FROM billing_offerings
    WHERE project_id = ? AND active = 1 AND placement = ?
    ORDER BY is_current DESC, created_at ASC
  `).bind(String(projectId), placement).all<Record<string, unknown>>();
  const result: Record<string, unknown> = {};
  for (const offering of offerings.results || []) {
    const packages = await db.prepare(`
      SELECT bp.id, bp.identifier, bp.package_type, bp.position, bp.metadata,
             p.id AS product_record_id, p.store_product_id, p.product_type, p.store, p.metadata AS product_metadata
      FROM billing_packages bp
      JOIN billing_package_products bpp ON bpp.package_id = bp.id
      JOIN billing_products p ON p.id = bpp.product_id
      WHERE bp.offering_id = ? AND p.active = 1
        AND (
          (? = 'web' AND p.store = 'stripe')
          OR (? = 'ios' AND p.store = 'apple')
          OR (? = 'android' AND p.store = 'google')
        )
        AND p.environment = ?
      ORDER BY bp.position ASC
    `).bind(offering.id, platform, platform, platform, environment).all<Record<string, unknown>>();
    result[String(offering.identifier)] = {
      identifier: offering.identifier,
      display_name: offering.display_name,
      description: offering.description,
      placement: offering.placement,
      metadata: parseJson(offering.metadata),
      packages: (packages.results || []).map((row) => ({
        identifier: row.identifier,
        package_type: row.package_type,
        product: {
          id: row.product_record_id,
          store_product_id: row.store_product_id,
          product_type: row.product_type,
          store: row.store,
          metadata: parseJson(row.product_metadata),
        },
        metadata: parseJson(row.metadata),
      })),
    };
  }
  const current = Object.values(result).find((value) => {
    const identifier = (value as Record<string, unknown>).identifier;
    return (offerings.results || []).some((row) => row.identifier === identifier && Number(row.is_current) === 1);
  }) || Object.values(result)[0] || null;
  return { current, all: result };
}
