import { Hono } from 'hono';
import type { Env } from '../types';
import { applyVerifiedPurchase, type BillingStatus, type VerifiedPurchase } from '../lib/billing';
import { decryptCredential } from '../lib/secrets';

const webhooks = new Hono<{ Bindings: Env }>();

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function signatureParts(header: string, separator: string) {
  const result: Record<string, string[]> = {};
  for (const item of header.split(separator)) {
    const [key, value] = item.trim().split('=');
    if (!key || !value) continue;
    (result[key] ||= []).push(value);
  }
  return result;
}

async function verifyStripe(payload: string, header: string, secret: string) {
  const parts = signatureParts(header, ',');
  const timestamp = parts.t?.[0];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  return (parts.v1 || []).some((value) => safeEqual(expected, value));
}

async function verifyPaddle(payload: string, header: string, secret: string) {
  const parts = signatureParts(header, ';');
  const timestamp = parts.ts?.[0];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = await hmacHex(secret, `${timestamp}:${payload}`);
  return (parts.h1 || []).some((value) => safeEqual(expected, value));
}

function epoch(value: unknown) {
  const number = Number(value || 0);
  return number > 0 ? new Date(number * 1000).toISOString() : null;
}

async function checkoutProduct(env: Env, checkoutId: string | null, providerSessionId: string | null) {
  return env.DB.prepare(`
    SELECT s.*, p.store_product_id, p.product_type
    FROM billing_checkout_sessions s LEFT JOIN billing_products p ON p.id = s.product_id
    WHERE (? IS NOT NULL AND s.id = ?) OR (? IS NOT NULL AND s.provider_session_id = ?)
    LIMIT 1
  `).bind(checkoutId, checkoutId, providerSessionId, providerSessionId).first<Record<string, any>>();
}

async function updateStripeCustomer(env: Env, customerId: string, stripeCustomerId: unknown) {
  if (!stripeCustomerId) return;
  const row = await env.DB.prepare('SELECT attributes FROM billing_customers WHERE id = ?').bind(customerId).first<{ attributes: string }>();
  if (!row) return;
  const attributes = parseObject(row.attributes);
  attributes.stripe_customer_id = String(stripeCustomerId);
  await env.DB.prepare(`UPDATE billing_customers SET attributes = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify(attributes), customerId).run();
}

function stripeStatus(type: string, object: Record<string, any>): BillingStatus {
  if (/refunded/.test(type)) return 'refunded';
  if (/payment_failed/.test(type) || object.status === 'past_due' || object.status === 'unpaid') return 'billing_issue';
  if (/deleted/.test(type) || object.status === 'canceled') return 'expired';
  if (object.status === 'trialing') return 'trialing';
  if (object.cancel_at_period_end) return 'cancelled';
  return 'active';
}

async function processStripe(env: Env, connection: Record<string, any>, event: Record<string, any>) {
  const object = parseObject(event.data?.object);
  const metadata = parseObject(object.metadata || object.subscription_details?.metadata);
  const checkout = await checkoutProduct(env, metadata.opengrow_checkout_id || null, event.type === 'checkout.session.completed' ? object.id : null);
  const customerId = String(metadata.opengrow_customer_id || checkout?.customer_id || '');
  if (!checkout || !customerId) return { ignored: true, reason: 'checkout_not_found' };
  const status = stripeStatus(String(event.type), object);
  const isSubscription = checkout.product_type === 'subscription';
  const subscriptionId = String(object.subscription || object.id || event.id);
  const transactionId = String(object.payment_intent || object.charge || object.id || event.id);
  const line = object.lines?.data?.[0] || {};
  const periodEnd = epoch(line.period?.end || object.current_period_end);
  const purchase: VerifiedPurchase = {
    projectId: String(connection.project_id),
    customerId,
    store: connection.provider === 'opengrow_web' ? 'opengrow_web' : 'stripe',
    environment: connection.environment,
    storeProductId: String(checkout.store_product_id || line.price?.id || 'web-product'),
    productType: isSubscription ? 'subscription' : 'non_consumable',
    storeTransactionId: `${transactionId}:${event.id}`,
    originalTransactionId: isSubscription ? subscriptionId : transactionId,
    eventType: String(event.type),
    status,
    priceMicros: object.amount_total != null ? Number(object.amount_total) * 10000 : object.amount_paid != null ? Number(object.amount_paid) * 10000 : null,
    currency: object.currency ? String(object.currency).toUpperCase() : null,
    purchasedAt: epoch(object.created),
    eventOccurredAt: epoch(event.created) || new Date().toISOString(),
    expiresAt: periodEnd,
    autoRenews: isSubscription && !object.cancel_at_period_end && status !== 'expired',
    periodType: status === 'trialing' ? 'trial' : 'normal',
    rawPayload: event,
  };
  const applied = await applyVerifiedPurchase(env, purchase);
  await env.DB.prepare(`UPDATE billing_checkout_sessions SET status = ?, provider_customer_id = COALESCE(?, provider_customer_id), updated_at = datetime('now') WHERE id = ?`)
    .bind(status, object.customer || null, checkout.id).run();
  await updateStripeCustomer(env, customerId, object.customer);
  return applied;
}

function paddleStatus(type: string, object: Record<string, any>): BillingStatus {
  if (/adjustment/.test(type) && object.action === 'refund') return 'refunded';
  if (/payment_failed|past_due/.test(type) || object.status === 'past_due') return 'billing_issue';
  if (/canceled/.test(type) || object.status === 'canceled') return 'expired';
  if (object.status === 'trialing') return 'trialing';
  if (object.scheduled_change?.action === 'cancel') return 'cancelled';
  return 'active';
}

async function processPaddle(env: Env, connection: Record<string, any>, event: Record<string, any>) {
  const object = parseObject(event.data);
  const metadata = parseObject(object.custom_data);
  const checkout = await checkoutProduct(env, metadata.opengrow_checkout_id || null, object.id || null);
  const customerId = String(metadata.opengrow_customer_id || checkout?.customer_id || '');
  if (!checkout || !customerId) return { ignored: true, reason: 'checkout_not_found' };
  const status = paddleStatus(String(event.event_type), object);
  const period = object.billing_period || object.current_billing_period || {};
  const total = object.details?.totals?.grand_total ?? object.details?.totals?.total;
  const purchase: VerifiedPurchase = {
    projectId: String(connection.project_id),
    customerId,
    store: 'paddle',
    environment: connection.environment,
    storeProductId: String(checkout.store_product_id || object.items?.[0]?.price?.id || 'web-product'),
    productType: checkout.product_type === 'subscription' ? 'subscription' : 'non_consumable',
    storeTransactionId: `${object.id || event.event_id}:${event.event_id}`,
    originalTransactionId: String(object.subscription_id || object.id || event.event_id),
    eventType: String(event.event_type),
    status,
    priceMicros: total != null ? Number(total) * 10000 : null,
    currency: object.currency_code || object.details?.totals?.currency_code || null,
    purchasedAt: object.created_at || event.occurred_at || null,
    eventOccurredAt: event.occurred_at || new Date().toISOString(),
    expiresAt: period.ends_at || null,
    autoRenews: checkout.product_type === 'subscription' && status !== 'expired' && status !== 'cancelled',
    periodType: status === 'trialing' ? 'trial' : 'normal',
    rawPayload: event,
  };
  const applied = await applyVerifiedPurchase(env, purchase);
  await env.DB.prepare(`UPDATE billing_checkout_sessions SET status = ?, provider_customer_id = COALESCE(?, provider_customer_id), updated_at = datetime('now') WHERE id = ?`)
    .bind(status, object.customer_id || null, checkout.id).run();
  return applied;
}

webhooks.post('/:connectionId', async (c) => {
  const payload = await c.req.text();
  const connection = await c.env.DB.prepare(`SELECT * FROM billing_store_connections WHERE id = ? AND provider IN ('stripe','paddle','opengrow_web') LIMIT 1`)
    .bind(c.req.param('connectionId')).first<Record<string, any>>();
  if (!connection?.configuration_encrypted) return c.json({ error: 'Connection not found' }, 404);
  let credentials: Record<string, any>;
  try { credentials = parseObject(await decryptCredential(c.env, connection.configuration_encrypted)); }
  catch { return c.json({ error: 'Connection credentials invalid' }, 500); }
  const webhookSecret = String(credentials.webhook_secret || '');
  const valid = connection.provider === 'paddle'
    ? await verifyPaddle(payload, c.req.header('Paddle-Signature') || '', webhookSecret)
    : await verifyStripe(payload, c.req.header('Stripe-Signature') || '', webhookSecret);
  if (!valid) return c.json({ error: 'Invalid webhook signature' }, 401);
  const event = JSON.parse(payload) as Record<string, any>;
  const externalId = String(event.id || event.event_id || '');
  if (!externalId) return c.json({ error: 'Webhook event ID is required' }, 422);
  const eventType = String(event.type || event.event_type || 'unknown');
  const inserted = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO billing_webhook_events (id, project_id, store, environment, external_event_id, event_type, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
  `).bind(crypto.randomUUID(), connection.project_id, connection.provider, connection.environment, externalId, eventType, payload).run();
  if (!inserted.meta.changes) return c.json({ received: true, duplicate: true });
  try {
    const result = connection.provider === 'paddle'
      ? await processPaddle(c.env, connection, event)
      : await processStripe(c.env, connection, event);
    await c.env.DB.prepare(`UPDATE billing_webhook_events SET status = 'processed', processed_at = datetime('now') WHERE project_id = ? AND store = ? AND external_event_id = ?`)
      .bind(connection.project_id, connection.provider, externalId).run();
    return c.json({ received: true, result });
  } catch (error) {
    await c.env.DB.prepare(`UPDATE billing_webhook_events SET status = 'failed', error_message = ? WHERE project_id = ? AND store = ? AND external_event_id = ?`)
      .bind((error as Error)?.message || String(error), connection.project_id, connection.provider, externalId).run();
    console.error('purchases_provider_webhook_failed', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

export default webhooks;
