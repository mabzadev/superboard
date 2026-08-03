import { Hono } from 'hono';
import type { BillingEnv, Env } from '../types';
import { applyVerifiedPurchase, type BillingStatus, type VerifiedPurchase } from '../lib/billing';
import { decryptCredential } from '../lib/secrets';
import { readTextLimited } from '../lib/http-limits';

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

function epoch(value: unknown) {
  const number = Number(value || 0);
  return number > 0 ? new Date(number * 1000).toISOString() : null;
}

async function checkoutProduct(env: BillingEnv, checkoutId: string | null, providerSessionId: string | null) {
  return env.DB.prepare(`
    SELECT s.*, p.store_product_id, p.product_type
    FROM billing_checkout_sessions s LEFT JOIN billing_products p ON p.id = s.product_id
    WHERE (? IS NOT NULL AND s.id = ?) OR (? IS NOT NULL AND s.provider_session_id = ?)
    LIMIT 1
  `).bind(checkoutId, checkoutId, providerSessionId, providerSessionId).first<Record<string, any>>();
}

async function updateStripeCustomer(env: BillingEnv, customerId: string, stripeCustomerId: unknown) {
  if (!stripeCustomerId) return;
  const row = await env.DB.prepare('SELECT attributes FROM billing_customers WHERE id = ?').bind(customerId).first<{ attributes: string }>();
  if (!row) return;
  const attributes = parseObject(row.attributes);
  attributes.stripe_customer_id = String(stripeCustomerId);
  await env.DB.prepare(`UPDATE billing_customers SET attributes = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify(attributes), customerId).run();
}

function stripeStatus(type: string, object: Record<string, any>): BillingStatus {
  if (/refunded/.test(type) || (/dispute/.test(type) && object.status === 'lost')) return 'refunded';
  if (/payment_failed/.test(type) || object.status === 'past_due' || object.status === 'unpaid') return 'billing_issue';
  if (/deleted/.test(type) || object.status === 'canceled') return 'expired';
  if (object.status === 'trialing') return 'trialing';
  if (object.cancel_at_period_end) return 'cancelled';
  return 'active';
}

async function stripeCustomerForEvent(env: BillingEnv, connection: Record<string, any>, object: Record<string, any>) {
  if (object.customer) {
    const direct = await env.DB.prepare(`
      SELECT id FROM billing_customers
      WHERE project_id = ? AND json_extract(attributes, '$.stripe_customer_id') = ?
      LIMIT 1
    `).bind(String(connection.project_id), String(object.customer)).first<{ id: string }>();
    if (direct) return direct;
  }
  const providerObjectId = String(object.payment_intent || object.charge || object.id || '');
  if (!providerObjectId) return null;
  return env.DB.prepare(`
    SELECT customer_id AS id FROM billing_transactions
    WHERE project_id = ? AND store = 'stripe' AND customer_id IS NOT NULL
      AND (
        json_extract(raw_payload, '$.data.object.id') = ?
        OR json_extract(raw_payload, '$.data.object.payment_intent') = ?
        OR json_extract(raw_payload, '$.data.object.charge') = ?
      )
    ORDER BY COALESCE(event_occurred_at, created_at) DESC LIMIT 1
  `).bind(String(connection.project_id), providerObjectId, providerObjectId, providerObjectId).first<{ id: string }>();
}

async function latestStripeProduct(env: BillingEnv, connection: Record<string, any>, customerId: string) {
  return env.DB.prepare(`
    SELECT p.store_product_id, p.product_type, t.original_transaction_id,
      t.expires_at, t.currency, t.price_micros
    FROM billing_transactions t
    JOIN billing_products p ON p.id = t.product_id
    WHERE t.project_id = ? AND t.customer_id = ? AND t.store = 'stripe'
    ORDER BY COALESCE(t.event_occurred_at, t.created_at) DESC
    LIMIT 1
  `).bind(String(connection.project_id), customerId).first<Record<string, any>>();
}

async function processStripe(env: BillingEnv, connection: Record<string, any>, event: Record<string, any>) {
  const object = parseObject(event.data?.object);
  const metadata = parseObject(object.metadata || object.subscription_details?.metadata);
  const checkout = await checkoutProduct(env, metadata.opengrow_checkout_id || null, event.type === 'checkout.session.completed' ? object.id : null);
  const providerCustomer = await stripeCustomerForEvent(env, connection, object);
  const customerId = String(metadata.opengrow_customer_id || checkout?.customer_id || providerCustomer?.id || '');
  if (!customerId) return { ignored: true, reason: 'customer_not_found' };
  const prior = checkout ? null : await latestStripeProduct(env, connection, customerId);
  if (!checkout && !prior) return { ignored: true, reason: 'purchase_not_found' };
  const status = stripeStatus(String(event.type), object);
  const isSubscription = (checkout?.product_type || prior?.product_type) === 'subscription';
  const subscriptionId = String(object.subscription || object.id || event.id);
  const transactionId = String(object.payment_intent || object.charge || object.id || event.id);
  const line = object.lines?.data?.[0] || {};
  const periodEnd = epoch(line.period?.end || object.current_period_end);
  const eventType = object.status && /dispute/.test(String(event.type))
    ? `${String(event.type)}.${String(object.status)}`
    : String(event.type);
  const purchase: VerifiedPurchase = {
    projectId: String(connection.project_id),
    customerId,
    store: 'stripe',
    environment: connection.environment,
    storeProductId: String(checkout?.store_product_id || prior?.store_product_id || line.price?.id || 'web-product'),
    productType: isSubscription ? 'subscription' : 'non_consumable',
    storeTransactionId: `${transactionId}:${event.id}`,
    originalTransactionId: isSubscription ? String(checkout?.provider_subscription_id || prior?.original_transaction_id || subscriptionId) : transactionId,
    eventType,
    status,
    priceMicros: object.amount_total != null ? Number(object.amount_total) * 10000
      : object.amount_paid != null ? Number(object.amount_paid) * 10000
        : object.amount != null ? Number(object.amount) * 10000
          : prior?.price_micros ?? null,
    currency: object.currency ? String(object.currency).toUpperCase() : prior?.currency || null,
    purchasedAt: epoch(object.created),
    eventOccurredAt: epoch(event.created) || new Date().toISOString(),
    expiresAt: periodEnd || prior?.expires_at || null,
    autoRenews: isSubscription && !object.cancel_at_period_end && status !== 'expired',
    periodType: status === 'trialing' ? 'trial' : 'normal',
    rawPayload: event,
  };
  const applied = await applyVerifiedPurchase(env, purchase);
  if (checkout) {
    await env.DB.prepare(`UPDATE billing_checkout_sessions SET status = ?, provider_customer_id = COALESCE(?, provider_customer_id), updated_at = datetime('now') WHERE id = ?`)
      .bind(status, object.customer || null, checkout.id).run();
  }
  await updateStripeCustomer(env, customerId, object.customer);
  return applied;
}

export async function processStripeBillingNotification(env: BillingEnv, params: {
  eventId: string;
  connectionId: string;
}) {
  const eventRow = await env.DB.prepare(`
    SELECT id, project_id, environment, payload, status
    FROM billing_webhook_events
    WHERE id = ? AND store = 'stripe' LIMIT 1
  `).bind(params.eventId).first<Record<string, any>>();
  if (!eventRow) throw new Error('Stripe webhook event not found');
  if (eventRow.status === 'processed') return { processed: true, duplicate: true };
  const connection = await env.DB.prepare(`
    SELECT * FROM billing_store_connections
    WHERE id = ? AND project_id = ? AND provider = 'stripe' AND environment = ? LIMIT 1
  `).bind(params.connectionId, eventRow.project_id, eventRow.environment).first<Record<string, any>>();
  if (!connection) throw new Error('Stripe connection not found');
  try {
    const event = JSON.parse(String(eventRow.payload || '{}')) as Record<string, any>;
    const result = await processStripe(env, connection, event);
    await env.DB.prepare(`
      UPDATE billing_webhook_events
      SET status = 'processed', attempts = attempts + 1, processed_at = datetime('now'), error_message = NULL
      WHERE id = ?
    `).bind(params.eventId).run();
    return { processed: true, result };
  } catch (error) {
    await env.DB.prepare(`
      UPDATE billing_webhook_events
      SET status = 'failed', attempts = attempts + 1, error_message = ? WHERE id = ?
    `).bind((error instanceof Error ? error.message : String(error)).slice(0, 1000), params.eventId).run();
    throw error;
  }
}

webhooks.post('/:connectionId', async (c) => {
  let payload: string;
  try { payload = await readTextLimited(c.req.raw, 1_048_576, 'Webhook payload too large'); }
  catch { return c.json({ error: 'Webhook payload too large' }, 413); }
  const connection = await c.env.DB.prepare(`SELECT * FROM billing_store_connections WHERE id = ? AND provider = 'stripe' LIMIT 1`)
    .bind(c.req.param('connectionId')).first<Record<string, any>>();
  if (!connection?.configuration_encrypted) return c.json({ error: 'Connection not found' }, 404);
  let credentials: Record<string, any>;
  try { credentials = parseObject(await decryptCredential(c.env, connection.configuration_encrypted)); }
  catch { return c.json({ error: 'Connection credentials invalid' }, 500); }
  const webhookSecret = String(credentials.webhook_secret || '');
  const valid = await verifyStripe(payload, c.req.header('Stripe-Signature') || '', webhookSecret);
  if (!valid) return c.json({ error: 'Invalid webhook signature' }, 401);
  let event: Record<string, any>;
  try { event = JSON.parse(payload) as Record<string, any>; }
  catch { return c.json({ error: 'Webhook payload is invalid JSON' }, 400); }
  const externalId = String(event.id || event.event_id || '');
  if (!externalId) return c.json({ error: 'Webhook event ID is required' }, 422);
  const eventType = String(event.type || event.event_type || 'unknown');
  const eventId = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO billing_webhook_events (id, project_id, store, environment, external_event_id, event_type, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
  `).bind(eventId, connection.project_id, connection.provider, connection.environment, externalId, eventType, payload).run();
  const persisted = await c.env.DB.prepare(`
    SELECT id, status FROM billing_webhook_events
    WHERE project_id = ? AND store = ? AND environment = ? AND external_event_id = ? LIMIT 1
  `).bind(connection.project_id, connection.provider, connection.environment, externalId)
    .first<{ id: string; status: string }>();
  if (!persisted) return c.json({ error: 'Webhook event persistence failed' }, 503);
  if (persisted.status === 'processed') return c.json({ received: true, duplicate: true });
  const job = { type: 'billing.stripe.notification' as const, eventId: persisted.id, connectionId: String(connection.id) };
  try {
    if (c.env.BILLING_QUEUE) {
      await c.env.BILLING_QUEUE.send(job);
    } else {
      c.executionCtx.waitUntil(processStripeBillingNotification(c.env, job));
    }
  } catch (error) {
    await c.env.DB.prepare(`
      UPDATE billing_webhook_events SET status = 'failed', error_message = ? WHERE id = ?
    `).bind('Queue delivery failed', persisted.id).run();
    console.error(JSON.stringify({
      event: 'stripe_webhook_queue_failed', webhook_event_id: persisted.id,
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ error: 'Webhook queue is temporarily unavailable', retryable: true }, 503);
  }
  return c.json({ received: true, queued: true, duplicate: !inserted.meta.changes }, 202);
});

export default webhooks;
