import { Hono } from 'hono';
import { Env } from '../types';
import { getOrCreateProject } from '../lib/db';

const webhooks = new Hono<{ Bindings: Env }>();

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function verifyStripeSignature(payload: string, header: string | undefined, secret: string | undefined) {
  if (!secret) return false;
  const parts = Object.fromEntries((header || '').split(',').map((part) => {
    const [key, value] = part.split('=');
    return [key, value];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  return safeEqualHex(await hmacSha256(secret, `${timestamp}.${payload}`), signature);
}

async function currentMau(db: D1Database, instanceId: number): Promise<number> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const production = await getOrCreateProject(db, instanceId, 'production');
  const test = await getOrCreateProject(db, instanceId, 'test');
  const projectIds = [String(production.id), String(test.id)];
  const visitorStats = await db.prepare(`
    SELECT COUNT(DISTINCT visitor_id) AS total
    FROM visitor_daily_statistics
    WHERE project_id IN (?, ?)
      AND date(COALESCE(event_date, date)) BETWEEN ? AND ?
  `).bind(...projectIds, start, end).first<{ total: number }>().catch(() => null);
  if (Number(visitorStats?.total || 0) > 0) return Number(visitorStats?.total || 0);
  const events = await db.prepare(`
    SELECT COUNT(DISTINCT device_id) AS total
    FROM events
    WHERE project_id IN (?, ?)
      AND device_id IS NOT NULL
      AND date(created_at) BETWEEN ? AND ?
  `).bind(...projectIds, start, end).first<{ total: number }>().catch(() => null);
  return Number(events?.total || 0);
}

async function stripeRequest(env: Env, method: string, path: string, params: Record<string, string | number>) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) body.set(key, String(value));
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) {
    const payload: any = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || 'Stripe request failed');
  }
  return response.json();
}

async function upsertSubscription(db: D1Database, object: any, defaults: Record<string, unknown> = {}) {
  const subscriptionId = object.subscription || object.id;
  if (!subscriptionId) return;
  let instanceId = Number(defaults.instance_id || object.client_reference_id || object.metadata?.instance_id || 0);
  if (!instanceId) {
    const existing = await db.prepare(`
      SELECT instance_id
      FROM stripe_subscriptions
      WHERE stripe_subscription_id = ? OR subscription_id = ?
      LIMIT 1
    `).bind(subscriptionId, subscriptionId).first<{ instance_id: number }>();
    instanceId = Number(existing?.instance_id || 0);
  }
  if (!instanceId) return;
  const customerId = object.customer || defaults.customer_id || null;
  const status = object.status || defaults.status || 'pending';
  const itemId = object.items?.data?.[0]?.id || defaults.subscription_item_id || null;
  const active = ['active', 'trialing', 'past_due'].includes(status) ? 1 : 0;
  const currentPeriodStart = object.current_period_start ? new Date(object.current_period_start * 1000).toISOString() : null;
  const currentPeriodEnd = object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null;
  const canceledAt = object.canceled_at ? new Date(object.canceled_at * 1000).toISOString() : null;
  const cancelAt = object.cancel_at ? new Date(object.cancel_at * 1000).toISOString() : null;

  await db.prepare(`
    INSERT INTO stripe_subscriptions (
      instance_id, stripe_customer_id, customer_id, stripe_subscription_id, subscription_id,
      status, active, product_type, subscription_item_id, current_period_start,
      current_period_end, cancel_at_period_end, canceled_at, cancels_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scale_up', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET
      stripe_customer_id = excluded.stripe_customer_id,
      customer_id = excluded.customer_id,
      subscription_id = excluded.subscription_id,
      status = excluded.status,
      active = excluded.active,
      subscription_item_id = COALESCE(excluded.subscription_item_id, stripe_subscriptions.subscription_item_id),
      current_period_start = COALESCE(excluded.current_period_start, stripe_subscriptions.current_period_start),
      current_period_end = COALESCE(excluded.current_period_end, stripe_subscriptions.current_period_end),
      cancel_at_period_end = excluded.cancel_at_period_end,
      canceled_at = COALESCE(excluded.canceled_at, stripe_subscriptions.canceled_at),
      cancels_at = COALESCE(excluded.cancels_at, stripe_subscriptions.cancels_at),
      updated_at = datetime('now')
  `).bind(
    instanceId,
    customerId,
    customerId,
    subscriptionId,
    subscriptionId,
    status,
    status === 'canceled' || status === 'paused' ? 0 : active,
    itemId,
    currentPeriodStart,
    currentPeriodEnd,
    object.cancel_at_period_end ? 1 : 0,
    canceledAt,
    cancelAt,
  ).run();
}

async function processStripeEvent(env: Env, event: any) {
  const object = event?.data?.object || {};
  if (event.type === 'checkout.session.completed') {
    await env.DB.prepare(`
      INSERT INTO stripe_payment_intents (instance_id, user_id, stripe_payment_intent_id, intent_id, product_type, created_at, updated_at)
      SELECT ?, COALESCE((SELECT user_id FROM instance_roles WHERE instance_id = ? ORDER BY id ASC LIMIT 1), 0), ?, ?, 'scale_up', datetime('now'), datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM stripe_payment_intents WHERE intent_id = ?)
    `).bind(
      Number(object.client_reference_id || object.metadata?.instance_id || 0),
      Number(object.client_reference_id || object.metadata?.instance_id || 0),
      object.id,
      object.id,
      object.id,
    ).run();
    await upsertSubscription(env.DB, object, {
      status: 'pending',
      customer_id: object.customer,
      instance_id: Number(object.client_reference_id || object.metadata?.instance_id || 0),
    });
    return;
  }

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    await upsertSubscription(env.DB, object, {
      status: event.type === 'customer.subscription.deleted' ? 'canceled' : object.status,
    });
    return;
  }

  if (event.type === 'invoice.payment_failed') {
    await env.DB.prepare(`
      UPDATE stripe_subscriptions
      SET active = 0, status = 'payment_failed', updated_at = datetime('now')
      WHERE customer_id = ? OR stripe_customer_id = ?
    `).bind(object.customer, object.customer).run();
  }
}

webhooks.post('/stripe', async (c) => {
  const payload = await c.req.text();
  if (!(await verifyStripeSignature(payload, c.req.header('Stripe-Signature'), c.env.STRIPE_WEBHOOK_SECRET))) {
    return c.json({ error: 'Failed' }, 400);
  }

  const event = JSON.parse(payload);
  const existing = await c.env.DB.prepare(
    'SELECT processed FROM stripe_webhook_messages WHERE stripe_event_id = ? LIMIT 1'
  ).bind(event.id).first<{ processed: number }>();
  if (existing?.processed === 1) return c.json({ message: 'Stripe webhook already processed' });

  await c.env.DB.prepare(`
    INSERT INTO stripe_webhook_messages (stripe_event_id, event_type, message_type, payload, data, processed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
    ON CONFLICT(stripe_event_id) DO UPDATE SET updated_at = datetime('now')
  `).bind(event.id, event.type, event.type, payload, JSON.stringify(event.data || {})).run();

  await processStripeEvent(c.env, event);

  await c.env.DB.prepare(
    'UPDATE stripe_webhook_messages SET processed = 1, processed_at = datetime("now"), updated_at = datetime("now") WHERE stripe_event_id = ?'
  ).bind(event.id).run();
  return c.json({ message: 'Stripe webhook processed' });
});

webhooks.post('/send_stripe_quotas', async (c) => {
  if (!c.env.SENT_QUOTAS_WEBHOOK_KEY || c.req.header('X-API-KEY') !== c.env.SENT_QUOTAS_WEBHOOK_KEY) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const rows = await c.env.DB.prepare(`
    SELECT instance_id, COALESCE(subscription_item_id, '') AS subscription_item_id
    FROM stripe_subscriptions
    WHERE active = 1 AND subscription_item_id IS NOT NULL
  `).all<{ instance_id: number; subscription_item_id: string }>();
  for (const row of rows.results || []) {
    const quantity = await currentMau(c.env.DB, Number(row.instance_id));
    await stripeRequest(c.env, 'POST', `/subscription_items/${encodeURIComponent(row.subscription_item_id)}/usage_records`, {
      quantity,
      timestamp: Math.floor(Date.now() / 1000),
      action: 'set',
    });
  }
  return c.json({ message: 'Stripe quotas sent' });
});

export default webhooks;
