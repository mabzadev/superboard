import { Env } from '../types';
import { decryptCredential, hmacSha256 } from './secrets';
import { verifyAppleNotification } from './store-verification';
import { reconcileAppleSubscription, verifyGooglePurchase } from './store-verification';
import { applyVerifiedPurchase, queueCustomerEntitlementChanged, type BillingEnvironment } from './billing';

export async function processAppleBillingNotification(env: Env, params: {
  eventId: string;
  projectId: string;
  signedPayload: string;
  environment: BillingEnvironment;
}) {
  try {
    const result = await verifyAppleNotification(env, params);
    if (result.purchase?.customerId) {
      const customer = await env.DB.prepare('SELECT id FROM billing_customers WHERE id = ? AND project_id = ?')
        .bind(result.purchase.customerId, params.projectId).first();
      if (!customer) result.purchase.customerId = null;
    }
    const applied = result.purchase ? await applyVerifiedPurchase(env, result.purchase) : null;
    await env.DB.prepare(`
      UPDATE billing_webhook_events SET status = 'processed', attempts = attempts + 1,
        event_type = ?, processed_at = datetime('now'), error_message = NULL WHERE id = ?
    `).bind(String(result.notification.notificationType || 'UNKNOWN'), params.eventId).run();
    return { processed: true, transaction_id: applied?.transactionId || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`
      UPDATE billing_webhook_events SET status = 'failed', attempts = attempts + 1, error_message = ? WHERE id = ?
    `).bind(message.slice(0, 1000), params.eventId).run();
    throw error;
  }
}

export async function processGoogleBillingNotification(env: Env, params: {
  eventId: string;
  projectId: string;
  purchaseToken: string;
  productId: string;
  productType: 'subscription' | 'non_consumable' | 'consumable';
  eventType: string;
  eventOccurredAt: string;
}) {
  try {
    const verified = await verifyGooglePurchase(env, {
      projectId: params.projectId,
      customerId: null,
      purchaseToken: params.purchaseToken,
      storeProductId: params.productId,
      productType: params.productType,
      environment: 'production',
      allowTransfer: true,
    });
    verified.purchase.eventType = params.eventType;
    verified.purchase.eventOccurredAt = params.eventOccurredAt;
    if (verified.purchase.customerId) {
      const customer = await env.DB.prepare('SELECT id FROM billing_customers WHERE id = ? AND project_id = ?')
        .bind(verified.purchase.customerId, params.projectId).first();
      if (!customer) verified.purchase.customerId = null;
    }
    const applied = await applyVerifiedPurchase(env, verified.purchase);
    await env.DB.prepare(`
      UPDATE billing_webhook_events SET status = 'processed', attempts = attempts + 1,
        event_type = ?, processed_at = datetime('now'), error_message = NULL WHERE id = ?
    `).bind(params.eventType, params.eventId).run();
    return { processed: true, transaction_id: applied.transactionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`
      UPDATE billing_webhook_events SET status = 'failed', attempts = attempts + 1, error_message = ? WHERE id = ?
    `).bind(message.slice(0, 1000), params.eventId).run();
    throw error;
  }
}

function safeWebhookUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Billing webhook URL must use HTTPS');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1') {
    throw new Error('Billing webhook URL is not allowed');
  }
  return url;
}

export async function deliverBillingWebhook(env: Env, deliveryId: string) {
  const delivery = await env.DB.prepare(`
    SELECT d.id, d.payload, d.attempts, e.url, e.signing_secret_encrypted, e.active
    FROM billing_webhook_deliveries d
    JOIN billing_webhook_endpoints e ON e.id = d.endpoint_id
    WHERE d.id = ?
    LIMIT 1
  `).bind(deliveryId).first<Record<string, unknown>>();
  if (!delivery) throw new Error('Billing webhook delivery not found');
  if (Number(delivery.active) !== 1) return { skipped: true };
  safeWebhookUrl(String(delivery.url));
  const payload = String(delivery.payload);
  const secretReference = String(delivery.signing_secret_encrypted);
  const secret = secretReference === 'env:OPENGROW_VOCOSTAR_WEBHOOK_SECRET'
    ? env.OPENGROW_VOCOSTAR_WEBHOOK_SECRET
    : await decryptCredential(env, secretReference);
  if (!secret) throw new Error('Billing webhook signing secret is unavailable');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacSha256(secret, `${timestamp}.${payload}`);
  const attempt = Number(delivery.attempts || 0) + 1;
  const response = await fetch(String(delivery.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'OpenGrow-Purchases-Webhook/1.0',
      'X-OpenGrow-Delivery': deliveryId,
      'X-OpenGrow-Timestamp': timestamp,
      'X-OpenGrow-Signature': `v1=${signature}`,
    },
    body: payload,
    redirect: 'error',
  });
  const responseBody = (await response.text()).slice(0, 4096);
  await env.DB.prepare(`
    UPDATE billing_webhook_deliveries
    SET attempts = ?, last_attempt_at = datetime('now'), response_status = ?, response_body = ?,
        status = ?, delivered_at = CASE WHEN ? THEN datetime('now') ELSE delivered_at END,
        next_attempt_at = CASE WHEN ? THEN NULL ELSE datetime('now', '+' || MIN(3600, 30 * (1 << MIN(7, ?))) || ' seconds') END
    WHERE id = ?
  `).bind(
    attempt,
    response.status,
    responseBody,
    response.ok ? 'delivered' : 'failed',
    response.ok ? 1 : 0,
    response.ok ? 1 : 0,
    attempt,
    deliveryId,
  ).run();
  if (!response.ok) throw new Error(`Billing webhook returned HTTP ${response.status}`);
  return { delivered: true, status: response.status };
}

export async function reconcileBillingState(env: Env) {
  const entitlementExpirations = await env.DB.prepare(`
    SELECT DISTINCT ce.project_id, ce.customer_id, COALESCE(p.environment, 'production') AS environment
    FROM billing_customer_entitlements ce
    LEFT JOIN billing_products p ON p.id = ce.product_id
    WHERE ce.source = 'purchase'
      AND ce.status NOT IN ('inactive', 'revoked', 'refunded')
      AND ce.expires_at IS NOT NULL
      AND datetime(ce.expires_at) <= datetime('now')
  `).all<{ project_id: string; customer_id: string; environment: BillingEnvironment }>();
  const expiredSubscriptions = await env.DB.prepare(`
    UPDATE billing_subscriptions
    SET status = 'expired', will_renew = 0, updated_at = datetime('now')
    WHERE status NOT IN ('expired', 'revoked', 'refunded')
      AND expires_at IS NOT NULL
      AND datetime(expires_at) <= datetime('now')
  `).run();
  const expiredEntitlements = await env.DB.prepare(`
    UPDATE billing_customer_entitlements
    SET status = 'inactive', will_renew = 0, updated_at = datetime('now')
    WHERE source = 'purchase'
      AND status NOT IN ('inactive', 'revoked', 'refunded')
      AND expires_at IS NOT NULL
      AND datetime(expires_at) <= datetime('now')
  `).run();
  for (const expiration of entitlementExpirations.results || []) {
    await queueCustomerEntitlementChanged(env, {
      projectId: expiration.project_id,
      customerId: expiration.customer_id,
      environment: expiration.environment,
      reason: 'entitlement_expired',
    });
  }
  const pendingDeliveries = await env.DB.prepare(`
    SELECT id FROM billing_webhook_deliveries
    WHERE status IN ('pending', 'failed')
      AND attempts < 10
      AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
    LIMIT 100
  `).all<{ id: string }>();
  if (env.BILLING_QUEUE) {
    for (const row of pendingDeliveries.results || []) {
      await env.BILLING_QUEUE.send({ type: 'billing.webhook.deliver', deliveryId: row.id });
    }
  }
  const subscriptions = await env.DB.prepare(`
    SELECT s.id
    FROM billing_subscriptions s
    WHERE s.status NOT IN ('expired', 'revoked', 'refunded')
      AND datetime(s.updated_at) <= datetime('now', '-15 minutes')
    ORDER BY s.updated_at ASC LIMIT 100
  `).all<{ id: string }>();
  if (env.BILLING_QUEUE) {
    for (const row of subscriptions.results || []) {
      await env.BILLING_QUEUE.send({ type: 'billing.subscription.reconcile', subscriptionId: row.id });
    }
  }
  return {
    subscriptions_expired: expiredSubscriptions.meta.changes,
    entitlements_expired: expiredEntitlements.meta.changes,
    webhook_deliveries_enqueued: pendingDeliveries.results?.length || 0,
    subscriptions_enqueued: subscriptions.results?.length || 0,
  };
}

export async function reconcileStoreSubscription(env: Env, subscriptionId: string) {
  const row = await env.DB.prepare(`
    SELECT s.*, p.store_product_id, t.purchase_token
    FROM billing_subscriptions s
    JOIN billing_products p ON p.id = s.product_id
    LEFT JOIN billing_transactions t ON t.id = s.latest_transaction_id
    WHERE s.id = ? LIMIT 1
  `).bind(subscriptionId).first<Record<string, unknown>>();
  if (!row) return { skipped: true, reason: 'not_found' };
  if (!row.customer_id) return { skipped: true, reason: 'unowned' };
  const environment = String(row.environment) as BillingEnvironment;
  if (row.store === 'apple') {
    const purchase = await reconcileAppleSubscription(env, {
      projectId: String(row.project_id),
      customerId: String(row.customer_id),
      transactionId: String(row.original_transaction_id),
      environment,
    });
    const result = await applyVerifiedPurchase(env, purchase);
    return { store: 'apple', ...result };
  }
  if (row.store === 'google' && row.purchase_token) {
    const verified = await verifyGooglePurchase(env, {
      projectId: String(row.project_id),
      customerId: String(row.customer_id),
      purchaseToken: String(row.purchase_token),
      storeProductId: String(row.store_product_id),
      productType: 'subscription',
      environment,
    });
    verified.purchase.eventType = `RECONCILIATION_${verified.purchase.status.toUpperCase()}`;
    const result = await applyVerifiedPurchase(env, verified.purchase);
    return { store: 'google', ...result };
  }
  return { skipped: true, reason: 'missing_purchase_token' };
}
