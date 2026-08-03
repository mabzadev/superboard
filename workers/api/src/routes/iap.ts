import { Hono } from 'hono';
import { importPKCS8, importX509, jwtVerify, SignJWT } from 'jose';
import { Env } from '../types';
import { getOrCreateProject } from '../lib/db';
import { applyVerifiedPurchase, type BillingStatus, type VerifiedPurchase } from '../lib/billing';

const iap = new Hono<{ Bindings: Env }>();

function b64urlDecode(value: string): any {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return JSON.parse(atob(padded));
}

function decodeJwsPayload(value: unknown): any {
  if (typeof value !== 'string') return value || {};
  const parts = value.split('.');
  if (parts.length < 2) return {};
  return b64urlDecode(parts[1]);
}

function pemFromX5c(value: string): string {
  const lines = value.match(/.{1,64}/g) || [];
  return ['-----BEGIN CERTIFICATE-----', ...lines, '-----END CERTIFICATE-----'].join('\n');
}

async function verifyAppleJws(value: unknown): Promise<any> {
  if (typeof value !== 'string') throw new Error('signedPayload is required');
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('signedPayload must be a compact JWS');
  const header = b64urlDecode(parts[0]);
  const certificate = Array.isArray(header.x5c) ? header.x5c[0] : null;
  if (!certificate) throw new Error('Apple JWS certificate chain is missing');
  const key = await importX509(pemFromX5c(certificate), String(header.alg || 'ES256'));
  const { payload } = await jwtVerify(value, key, { algorithms: ['ES256'] });
  return payload;
}

async function applePayload(body: any, env: Env): Promise<any> {
  if (body.signedPayload) return verifyAppleJws(body.signedPayload);
  if (env.ENVIRONMENT !== 'production' && env.IAP_ALLOW_UNSIGNED_FIXTURES === 'true') return body;
  throw new Error('Unsigned Apple IAP payload rejected');
}

async function appleTransactionPayload(value: unknown, fallback: any): Promise<any> {
  if (!value) return fallback || {};
  return verifyAppleJws(value);
}

function googleRtdnAllowed(c: any, body: any): boolean {
  if (c.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN) {
    const token = c.req.query('token') || c.req.header('X-Goog-Channel-Token') || body.token;
    return token === c.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN;
  }
  return c.env.ENVIRONMENT !== 'production' || c.env.IAP_ALLOW_UNSIGNED_FIXTURES === 'true';
}

function googleServiceAccount(env: Env): any | null {
  if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) return null;
  try {
    return JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is invalid JSON');
  }
}

async function googlePlayAccessToken(env: Env, serviceAccount: any): Promise<string> {
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Google Play service account credentials are incomplete');
  }
  const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(String(serviceAccount.private_key), 'RS256');
  const assertion = await new SignJWT({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }).setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).sign(privateKey);

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Google OAuth token request failed');
  return payload.access_token;
}

async function fetchGooglePlayPurchase(env: Env, params: {
  packageName: string | null;
  productId: string | null;
  purchaseToken: string | null;
  purchaseType: 'subscription' | 'one_time';
}): Promise<any | null> {
  const serviceAccount = googleServiceAccount(env);
  if (!serviceAccount) {
    if (env.ENVIRONMENT === 'production' && env.IAP_ALLOW_UNSIGNED_FIXTURES !== 'true') {
      throw new Error('Google Play verification is not configured');
    }
    return null;
  }
  if (!params.packageName || !params.purchaseToken) {
    throw new Error('Google Play packageName and purchaseToken are required');
  }
  if (params.purchaseType === 'one_time' && !params.productId) {
    throw new Error('Google Play productId is required for one-time purchases');
  }

  const accessToken = await googlePlayAccessToken(env, serviceAccount);
  const packageName = encodeURIComponent(params.packageName);
  const purchaseToken = encodeURIComponent(params.purchaseToken);
  const url = params.purchaseType === 'subscription'
    ? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${purchaseToken}`
    : `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${encodeURIComponent(params.productId!)}/tokens/${purchaseToken}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Google Play purchase verification failed');
  }
  return payload;
}

function eventTypeForNotification(source: 'apple' | 'google', notificationType: string, purchaseType: string) {
  const type = notificationType.toUpperCase();
  if (source === 'google') {
    if (type.includes('VOID') || type.includes('REFUND')) return purchaseType === 'subscription' ? 'refund' : 'cancel';
    if (type.includes('CANCEL') || type.includes('REVOKE') || type.includes('EXPIRE')) return 'cancel';
    if (type.includes('RECOVER') || type.includes('RENEW') || type.includes('PURCHASE')) return 'buy';
  }
  if (type.includes('REFUND_REVERSED')) return 'refund_reversed';
  if (type.includes('REFUND')) return 'refund';
  if (type.includes('EXPIRED') || type.includes('REVOKE') || type.includes('DID_FAIL_TO_RENEW') || type.includes('CANCEL')) return 'cancel';
  return 'buy';
}

function msDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number)) return new Date(number > 100000000000 ? number : number * 1000).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function projectForInstance(db: D1Database, instanceId: number, test: boolean) {
  return getOrCreateProject(db, instanceId, test ? 'test' : 'production');
}

async function recordWebhook(db: D1Database, params: {
  source: string;
  notificationType: string;
  payload: unknown;
  instanceId: number;
  projectId: number | string;
}) {
  await db.prepare(`
    INSERT INTO iap_webhook_messages (
      store, source, event_type, notification_type, payload, instance_id, project_id,
      processed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
  `).bind(
    params.source,
    params.source,
    params.notificationType,
    params.notificationType,
    JSON.stringify(params.payload),
    params.instanceId,
    String(params.projectId),
  ).run();
}

async function markWebhookQueueFailure(db: D1Database, eventId: string) {
  await db.prepare(`
    UPDATE billing_webhook_events
    SET status = 'failed', error_message = 'Queue delivery failed'
    WHERE id = ?
  `).bind(eventId).run();
}

async function upsertPurchaseEvent(db: D1Database, event: {
  projectId: number | string;
  source: 'apple' | 'google';
  eventType: string;
  purchaseType: string;
  productId: string | null;
  transactionId: string;
  originalTransactionId: string;
  orderId?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  quantity?: number | null;
  purchaseDate?: string | null;
  expiresDate?: string | null;
}) {
  await db.prepare(`
    INSERT INTO purchase_events (
      project_id, product_id, transaction_id, original_transaction_id, order_id,
      event_type, purchase_type, price_cents, usd_price_cents, currency, quantity,
      date, occurred_at, expires_date, amount, raw_payload, store, store_source, webhook_validated, processed,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 0, datetime('now'), datetime('now'))
    ON CONFLICT(project_id, transaction_id, event_type) DO UPDATE SET
      product_id = excluded.product_id,
      original_transaction_id = excluded.original_transaction_id,
      order_id = excluded.order_id,
      purchase_type = excluded.purchase_type,
      price_cents = excluded.price_cents,
      usd_price_cents = excluded.usd_price_cents,
      currency = excluded.currency,
      quantity = excluded.quantity,
      date = excluded.date,
      occurred_at = excluded.occurred_at,
      expires_date = excluded.expires_date,
      amount = excluded.amount,
      raw_payload = excluded.raw_payload,
      store = 1,
      store_source = excluded.store_source,
      webhook_validated = 1,
      updated_at = datetime('now')
  `).bind(
    String(event.projectId),
    event.productId,
    event.transactionId,
    event.originalTransactionId,
    event.orderId || null,
    event.eventType,
    event.purchaseType,
    event.priceCents || null,
    event.currency === 'USD' ? event.priceCents || null : null,
    event.currency || null,
    event.quantity || 1,
    event.purchaseDate || new Date().toISOString(),
    event.purchaseDate || new Date().toISOString(),
    event.expiresDate || null,
    event.priceCents ? event.priceCents / 100 : null,
    JSON.stringify(event),
    event.source,
  ).run();

  if (event.purchaseType === 'subscription') {
    await db.prepare(`
      INSERT INTO subscription_states (
        project_id, product_id, transaction_id, latest_transaction_id,
        original_transaction_id, purchase_type, store, status, starts_at,
        expires_at, auto_renews, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(project_id, original_transaction_id) DO UPDATE SET
        product_id = excluded.product_id,
        transaction_id = excluded.transaction_id,
        latest_transaction_id = excluded.latest_transaction_id,
        purchase_type = excluded.purchase_type,
        store = excluded.store,
        status = excluded.status,
        starts_at = excluded.starts_at,
        expires_at = excluded.expires_at,
        auto_renews = excluded.auto_renews,
        updated_at = datetime('now')
    `).bind(
      String(event.projectId),
      event.productId,
      event.transactionId,
      event.transactionId,
      event.originalTransactionId,
      event.purchaseType,
      event.source,
      event.eventType === 'cancel' || event.eventType === 'refund' ? 'inactive' : 'active',
      event.purchaseDate || new Date().toISOString(),
      event.expiresDate || null,
      event.eventType === 'cancel' || event.eventType === 'refund' ? 0 : 1,
    ).run();
  }
}

async function handleApple(c: any, test: boolean) {
  const instanceId = Number(c.req.param('path'));
  if (!instanceId) return c.json({ error: 'Invalid instance' }, 422);
  const body = await c.req.json().catch(() => ({}));
  const project = await projectForInstance(c.env.DB, instanceId, test);
  if (typeof body.signedPayload === 'string' && body.signedPayload && c.env.IAP_ALLOW_UNSIGNED_FIXTURES !== 'true') {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.signedPayload)));
    const externalEventId = Array.from(digest).map((value) => value.toString(16).padStart(2, '0')).join('');
    const eventId = crypto.randomUUID();
    const inserted = await c.env.DB.prepare(`
      INSERT OR IGNORE INTO billing_webhook_events (
        id, project_id, store, environment, external_event_id, payload, status
      ) VALUES (?, ?, 'apple', ?, ?, ?, 'received')
    `).bind(eventId, project.id, test ? 'sandbox' : 'production', externalEventId, JSON.stringify(body)).run();
    const environment = test ? 'sandbox' as const : 'production' as const;
    const persisted = await c.env.DB.prepare(`
      SELECT id, status FROM billing_webhook_events
      WHERE project_id = ? AND store = 'apple' AND environment = ? AND external_event_id = ? LIMIT 1
    `).bind(project.id, environment, externalEventId).first() as { id: string; status: string } | null;
    if (!persisted) return c.json({ error: 'Apple notification persistence failed' }, 503);
    if (persisted.status === 'processed') {
      return c.json({ message: 'Apple IAP notification already processed', duplicate: true }, 202);
    }
    const job = {
      type: 'billing.apple.notification' as const,
      eventId: persisted.id,
      projectId: String(project.id),
      signedPayload: body.signedPayload,
      environment,
    };
    try {
      if (c.env.BILLING_QUEUE) await c.env.BILLING_QUEUE.send(job);
      else c.executionCtx.waitUntil(import('../lib/billing-jobs').then(({ processAppleBillingNotification }) => processAppleBillingNotification(c.env, job)));
    } catch (error) {
      await markWebhookQueueFailure(c.env.DB, persisted.id);
      console.error(JSON.stringify({
        event: 'apple_notification_queue_failed', webhook_event_id: persisted.id,
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ error: 'Apple notification queue is temporarily unavailable', retryable: true }, 503);
    }
    return c.json({ message: 'Apple IAP notification accepted', duplicate: inserted.meta.changes === 0 }, 202);
  }
  let payload: any;
  try {
    payload = await applePayload(body, c.env);
  } catch (error: any) {
    return c.json({ error: error?.message || 'Invalid Apple signature' }, 400);
  }
  const data = payload.data || body.data || {};
  let transaction: any;
  try {
    transaction = await appleTransactionPayload(data.signedTransactionInfo, data.transactionInfo || body.transactionInfo || data);
  } catch (error: any) {
    return c.json({ error: error?.message || 'Invalid Apple transaction signature' }, 400);
  }
  const notificationType = String(payload.notificationType || body.notificationType || 'DID_RENEW');
  const purchaseType = transaction.type === 'Consumable' || transaction.type === 'Non-Consumable' ? 'one_time' : 'subscription';
  await recordWebhook(c.env.DB, { source: 'apple', notificationType, payload: body, instanceId, projectId: project.id });
  await upsertPurchaseEvent(c.env.DB, {
    projectId: project.id,
    source: 'apple',
    eventType: eventTypeForNotification('apple', notificationType, purchaseType),
    purchaseType,
    productId: transaction.productId || body.product_id || null,
    transactionId: String(transaction.transactionId || body.transaction_id || crypto.randomUUID()),
    originalTransactionId: String(transaction.originalTransactionId || transaction.transactionId || body.original_transaction_id || crypto.randomUUID()),
    priceCents: transaction.price ? Math.round(Number(transaction.price) / 10000) : body.price_cents || null,
    currency: transaction.currency || body.currency || null,
    quantity: Number(transaction.quantity || body.quantity || 1),
    purchaseDate: msDate(transaction.purchaseDate || body.date),
    expiresDate: msDate(transaction.expiresDate || body.expires_date),
  });
  return c.json({ message: 'Apple IAP webhook processed' });
}

async function handleGoogle(c: any) {
  const instanceId = Number(c.req.param('path'));
  if (!instanceId) return c.json({ error: 'Invalid instance' }, 422);
  const body = await c.req.json().catch(() => ({}));
  if (!googleRtdnAllowed(c, body)) return c.json({ error: 'Invalid Google Pub/Sub token' }, 400);
  const data = body.message?.data ? JSON.parse(atob(body.message.data)) : body;
  const notification = data.subscriptionNotification || data.oneTimeProductNotification || data.voidedPurchaseNotification || data;
  const project = await projectForInstance(c.env.DB, instanceId, false);
  const notificationType = String(notification.notificationType || data.notificationType || (data.voidedPurchaseNotification ? 'VOIDED_PURCHASE' : 'PURCHASED'));
  const purchaseType = data.subscriptionNotification ? 'subscription' : 'one_time';
  const transactionId = String(notification.purchaseToken || notification.orderId || data.purchaseToken || crypto.randomUUID());
  const productId = notification.subscriptionId || notification.sku || notification.productId || data.productId || null;
  const pubsubMessageId = body.message?.messageId || body.message?.message_id;
  let billingWebhookEventId: string | null = null;
  if (pubsubMessageId) {
    billingWebhookEventId = crypto.randomUUID();
    const inserted = await c.env.DB.prepare(`
      INSERT OR IGNORE INTO billing_webhook_events (
        id, project_id, store, environment, external_event_id, payload, status
      ) VALUES (?, ?, 'google', 'production', ?, ?, 'received')
    `).bind(billingWebhookEventId, project.id, String(pubsubMessageId), JSON.stringify(body)).run();
    const persisted = await c.env.DB.prepare(`
      SELECT id, status FROM billing_webhook_events
      WHERE project_id = ? AND store = 'google' AND environment = 'production' AND external_event_id = ? LIMIT 1
    `).bind(project.id, String(pubsubMessageId)).first() as { id: string; status: string } | null;
    if (!persisted) return c.json({ error: 'Google RTDN persistence failed' }, 503);
    if (persisted.status === 'processed') return c.json({ message: 'Google RTDN already processed', duplicate: true });
    billingWebhookEventId = persisted.id;
    if (c.env.BILLING_QUEUE) {
      let productType: 'subscription' | 'non_consumable' | 'consumable' = purchaseType === 'subscription' ? 'subscription' : 'non_consumable';
      if (purchaseType !== 'subscription' && productId) {
        const configured = await c.env.DB.prepare(`
          SELECT product_type FROM billing_products
          WHERE project_id = ? AND store = 'google' AND store_product_id = ? LIMIT 1
        `).bind(project.id, productId).first() as { product_type: 'non_consumable' | 'consumable' } | null;
        if (configured?.product_type) productType = configured.product_type;
      }
      try {
        await c.env.BILLING_QUEUE.send({
          type: 'billing.google.notification',
          eventId: persisted.id,
          projectId: String(project.id),
          purchaseToken: String(notification.purchaseToken || data.purchaseToken || ''),
          productId: String(productId || ''),
          productType,
          eventType: notificationType,
          eventOccurredAt: msDate(data.eventTimeMillis) || new Date().toISOString(),
        });
      } catch (error) {
        await markWebhookQueueFailure(c.env.DB, persisted.id);
        console.error(JSON.stringify({
          event: 'google_notification_queue_failed', webhook_event_id: billingWebhookEventId,
          error: error instanceof Error ? error.message : String(error),
        }));
        return c.json({ error: 'Google RTDN queue is temporarily unavailable', retryable: true }, 503);
      }
      return c.json({ message: 'Google RTDN accepted', duplicate: inserted.meta.changes === 0 }, 202);
    }
  }
  let verified: any = null;
  try {
    verified = await fetchGooglePlayPurchase(c.env, {
      packageName: data.packageName || body.packageName || null,
      productId,
      purchaseToken: notification.purchaseToken || data.purchaseToken || null,
      purchaseType,
    });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Google Play purchase verification failed' }, c.env.ENVIRONMENT === 'production' ? 503 : 400);
  }
  const verifiedLineItem = Array.isArray(verified?.lineItems) ? verified.lineItems[0] : null;
  await recordWebhook(c.env.DB, { source: 'google', notificationType, payload: body, instanceId, projectId: project.id });
  await upsertPurchaseEvent(c.env.DB, {
    projectId: project.id,
    source: 'google',
    eventType: eventTypeForNotification('google', notificationType, purchaseType),
    purchaseType,
    productId: verifiedLineItem?.productId || productId,
    transactionId,
    originalTransactionId: String(notification.linkedPurchaseToken || transactionId),
    orderId: verified?.latestOrderId || verified?.orderId || notification.orderId || null,
    priceCents: data.price_cents || null,
    currency: data.currency || null,
    quantity: Number(data.quantity || 1),
    purchaseDate: msDate(verified?.startTime || verified?.purchaseTimeMillis || data.eventTimeMillis || data.purchaseTimeMillis),
    expiresDate: msDate(verifiedLineItem?.expiryTime || data.expiryTimeMillis),
  });
  const externalIdentifiers = verified?.externalAccountIdentifiers || {};
  const customerId = externalIdentifiers.obfuscatedExternalAccountId || verified?.obfuscatedExternalAccountId;
  if (verified && customerId) {
    const customer = await c.env.DB.prepare('SELECT id FROM billing_customers WHERE id = ? AND project_id = ?')
      .bind(String(customerId), project.id).first();
    if (customer) {
      const state = String(verified.subscriptionState || '');
      const statusMap: Record<string, BillingStatus> = {
        SUBSCRIPTION_STATE_PENDING: 'pending', SUBSCRIPTION_STATE_ACTIVE: 'active',
        SUBSCRIPTION_STATE_PAUSED: 'paused', SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace_period',
        SUBSCRIPTION_STATE_ON_HOLD: 'billing_issue', SUBSCRIPTION_STATE_CANCELED: 'cancelled',
        SUBSCRIPTION_STATE_EXPIRED: 'expired',
      };
      const purchase: VerifiedPurchase = {
        projectId: project.id,
        customerId: String(customerId),
        store: 'google',
        environment: 'production',
        storeProductId: String(verifiedLineItem?.productId || productId),
        productType: purchaseType === 'subscription' ? 'subscription' : 'non_consumable',
        storeTransactionId: String(verified.latestOrderId || verified.orderId || transactionId),
        originalTransactionId: String(verified.linkedPurchaseToken || transactionId),
        orderId: verified.latestOrderId || verified.orderId || null,
        purchaseToken: notification.purchaseToken || data.purchaseToken || null,
        eventType: notificationType,
        status: purchaseType === 'subscription' ? statusMap[state] || 'pending' : Number(verified.purchaseState) === 0 ? 'active' : 'pending',
        purchasedAt: msDate(verified.startTime || verified.purchaseTimeMillis),
        eventOccurredAt: msDate(data.eventTimeMillis) || new Date().toISOString(),
        expiresAt: msDate(verifiedLineItem?.expiryTime),
        autoRenews: Boolean(verifiedLineItem?.autoRenewingPlan?.autoRenewEnabled),
        rawPayload: verified,
      };
      await applyVerifiedPurchase(c.env, purchase);
    }
  }
  if (billingWebhookEventId) {
    await c.env.DB.prepare(`
      UPDATE billing_webhook_events SET status = 'processed', attempts = attempts + 1,
        event_type = ?, processed_at = datetime('now') WHERE id = ?
    `).bind(notificationType, billingWebhookEventId).run();
  }
  return c.json({ message: 'Google IAP webhook processed' });
}

iap.post('/apple/production/:path', (c) => handleApple(c, false));
iap.post('/apple/test/:path', (c) => handleApple(c, true));
iap.post('/google/:path', handleGoogle);

iap.post('/reconcile_subscriptions', async (c) => {
  if (!c.env.IAP_PROCESS_KEY || c.req.header('X-API-KEY') !== c.env.IAP_PROCESS_KEY) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const rows = await c.env.DB.prepare(`
    SELECT pe.*
    FROM purchase_events pe
    JOIN (
      SELECT project_id, original_transaction_id, MAX(COALESCE(date, created_at)) AS latest_date
      FROM purchase_events
      WHERE purchase_type = 'subscription'
        AND original_transaction_id IS NOT NULL
      GROUP BY project_id, original_transaction_id
    ) latest ON latest.project_id = pe.project_id
      AND latest.original_transaction_id = pe.original_transaction_id
      AND latest.latest_date = COALESCE(pe.date, pe.created_at)
  `).all<any>();
  for (const row of rows.results || []) {
    await c.env.DB.prepare(`
      INSERT INTO subscription_states (
        project_id, device_id, link_id, product_id, transaction_id,
        latest_transaction_id, original_transaction_id, purchase_type,
        store, status, starts_at, expires_at, auto_renews, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(project_id, original_transaction_id) DO UPDATE SET
        device_id = excluded.device_id,
        link_id = excluded.link_id,
        product_id = excluded.product_id,
        transaction_id = excluded.transaction_id,
        latest_transaction_id = excluded.latest_transaction_id,
        purchase_type = excluded.purchase_type,
        store = excluded.store,
        status = excluded.status,
        starts_at = excluded.starts_at,
        expires_at = excluded.expires_at,
        auto_renews = excluded.auto_renews,
        updated_at = datetime('now')
    `).bind(
      row.project_id,
      row.device_id || null,
      row.link_id || null,
      row.product_id,
      row.transaction_id,
      row.transaction_id,
      row.original_transaction_id,
      row.purchase_type,
      row.store_source || null,
      row.event_type === 'cancel' || row.event_type === 'refund' ? 'inactive' : 'active',
      row.date || row.created_at,
      row.expires_date || null,
      row.event_type === 'cancel' || row.event_type === 'refund' ? 0 : 1,
    ).run();
  }
  return c.json({ reconciled: rows.results?.length || 0 });
});

export default iap;
