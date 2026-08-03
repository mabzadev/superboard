import type { BillingEnv } from '../types';
import { applyVerifiedPurchase, type VerifiedPurchase } from './billing';
import { googlePlayAccess } from './store-verification';

type VoidedPurchase = {
  orderId?: string;
  purchaseToken?: string;
  purchaseTimeMillis?: string;
  voidedTimeMillis?: string;
  voidedSource?: number;
  voidedReason?: number;
  voidedQuantity?: number;
};

type MatchedTransaction = {
  project_id: string;
  application_id: string | null;
  customer_id: string | null;
  store_transaction_id: string;
  original_transaction_id: string | null;
  order_id: string | null;
  purchase_token: string | null;
  purchased_at: string | null;
  store_product_id: string;
  product_type: VerifiedPurchase['productType'];
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const OVERLAP_MS = 60 * 60 * 1000;

function reconciliationError(code: string, message: string, retryable = true, retryDelaySeconds = 300) {
  return Object.assign(new Error(message), { code, retryable, retryDelaySeconds });
}

export function googleVoidedPurchasesUrl(
  packageName: string,
  window: { startTime: number; endTime: number },
  pageToken = '',
) {
  const url = new URL(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/voidedpurchases`,
  );
  url.searchParams.set('type', '1');
  url.searchParams.set('includeQuantityBasedPartialRefund', 'true');
  url.searchParams.set('pageSelection.maxResults', '1000');
  if (pageToken) url.searchParams.set('pageSelection.token', pageToken);
  else {
    url.searchParams.set('startTime', String(window.startTime));
    url.searchParams.set('endTime', String(window.endTime));
  }
  return url.toString();
}

export async function reconcileGoogleVoidedPurchases(
  env: BillingEnv,
  projectId: string,
  now = Date.now(),
) {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_google_voided_sync_state (project_id, environment)
    VALUES (?, 'production')
  `).bind(projectId).run();
  const state = await env.DB.prepare(`
    SELECT watermark_ms FROM billing_google_voided_sync_state
    WHERE project_id = ? AND environment = 'production'
  `).bind(projectId).first<{ watermark_ms: number | null }>();
  const claimToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(`
    UPDATE billing_google_voided_sync_state
    SET claim_token = ?, claim_expires_at = datetime('now', '+10 minutes'),
      last_started_at = datetime('now'), last_error = NULL, updated_at = datetime('now')
    WHERE project_id = ? AND environment = 'production'
      AND (claim_token IS NULL OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime('now'))
  `).bind(claimToken, projectId).run();
  if (!claimed.meta.changes) return { claimed: false, scanned: 0, processed: 0, unmatched: 0 };

  const endTime = Math.min(now, Date.now());
  const previousWatermark = Number(state?.watermark_ms || 0);
  const startTime = Math.max(endTime - THIRTY_DAYS_MS, previousWatermark > 0 ? previousWatermark - OVERLAP_MS : 0);
  let scanned = 0;
  let processed = 0;
  let unmatched = 0;
  try {
    const access = await googlePlayAccess(env, projectId);
    await retryUnmatchedVoidedPurchases(env, projectId);
    const seenTokens = new Set<string>();
    let pageToken = '';
    do {
      if (seenTokens.size >= 100 || seenTokens.has(pageToken)) {
        throw reconciliationError('google_voided_pagination_invalid', 'Google Voided Purchases pagination exceeded its safety limit', false);
      }
      seenTokens.add(pageToken);
      const response = await fetch(googleVoidedPurchasesUrl(access.packageName, { startTime, endTime }, pageToken), {
        headers: { Authorization: `Bearer ${access.token}`, Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({})) as Record<string, any>;
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        throw reconciliationError(
          'google_voided_purchases_failed',
          String(payload?.error?.message || `Google Play returned HTTP ${response.status}`),
          response.status === 429 || response.status >= 500,
          retryAfter > 0 ? Math.min(3600, retryAfter) : 300,
        );
      }
      for (const item of Array.isArray(payload.voidedPurchases) ? payload.voidedPurchases as VoidedPurchase[] : []) {
        scanned += 1;
        const result = await processVoidedPurchase(env, projectId, item);
        if (result === 'processed') processed += 1;
        else unmatched += 1;
      }
      pageToken = String(payload.tokenPagination?.nextPageToken || '');
    } while (pageToken);
    await env.DB.prepare(`
      UPDATE billing_google_voided_sync_state
      SET watermark_ms = ?, last_completed_at = datetime('now'), last_error = NULL,
        claim_token = NULL, claim_expires_at = NULL, updated_at = datetime('now')
      WHERE project_id = ? AND environment = 'production' AND claim_token = ?
    `).bind(endTime, projectId, claimToken).run();
    return { claimed: true, scanned, processed, unmatched, start_time: startTime, end_time: endTime };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`
      UPDATE billing_google_voided_sync_state
      SET last_error = ?, claim_token = NULL, claim_expires_at = NULL, updated_at = datetime('now')
      WHERE project_id = ? AND environment = 'production' AND claim_token = ?
    `).bind(message.slice(0, 1000), projectId, claimToken).run();
    throw error;
  }
}

async function processVoidedPurchase(env: BillingEnv, projectId: string, item: VoidedPurchase) {
  const orderId = String(item.orderId || '').trim();
  const purchaseToken = String(item.purchaseToken || '').trim();
  const voidedTime = positiveMillis(item.voidedTimeMillis);
  if (!orderId || !voidedTime) {
    throw reconciliationError('google_voided_purchase_invalid', 'Google returned an incomplete voided purchase', false);
  }
  const externalEventId = `voided:${orderId}:${voidedTime}:${Math.max(1, Number(item.voidedQuantity || 1))}`;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_events (
      id, project_id, provider, environment, external_event_id, event_type,
      status, occurred_at, payload
    ) VALUES (?, ?, 'google', 'production', ?, 'voided_purchase_detected', 'received', ?, ?)
  `).bind(
    crypto.randomUUID(), projectId, externalEventId, new Date(voidedTime).toISOString(),
    JSON.stringify({ source: 'google_voided_purchases_reconciliation', ...item }),
  ).run();
  const matched = await findTransaction(env.DB, projectId, orderId, purchaseToken);
  if (!matched) {
    await env.DB.prepare(`
      UPDATE billing_events SET status = 'failed', attempt_count = attempt_count + 1,
        error_code = 'transaction_not_found', error_message = 'Verified local transaction not found'
      WHERE project_id = ? AND provider = 'google' AND environment = 'production'
        AND external_event_id = ? AND event_type = 'voided_purchase_detected'
    `).bind(projectId, externalEventId).run();
    return 'unmatched' as const;
  }
  const purchase: VerifiedPurchase = {
    projectId,
    applicationId: matched.application_id,
    customerId: matched.customer_id,
    store: 'google',
    environment: 'production',
    storeProductId: matched.store_product_id,
    productType: matched.product_type,
    storeTransactionId: matched.store_transaction_id,
    originalTransactionId: matched.original_transaction_id || matched.store_transaction_id,
    orderId,
    purchaseToken: purchaseToken || matched.purchase_token,
    eventType: 'VOIDED_PURCHASE',
    status: 'refunded',
    quantity: Math.max(1, Number(item.voidedQuantity || 1)),
    purchasedAt: matched.purchased_at,
    eventOccurredAt: new Date(voidedTime).toISOString(),
    autoRenews: false,
    rawPayload: {
      source: 'google_voided_purchases_reconciliation',
      voidedPurchaseId: externalEventId,
      ...item,
    },
  };
  const applied = await applyVerifiedPurchase(env, purchase);
  await env.DB.prepare(`
    UPDATE billing_events SET status = 'processed', processed_at = datetime('now'),
      transaction_id = ?, attempt_count = attempt_count + 1, error_code = NULL, error_message = NULL
    WHERE project_id = ? AND provider = 'google' AND environment = 'production'
      AND external_event_id = ? AND event_type = 'voided_purchase_detected'
  `).bind(applied.transactionId, projectId, externalEventId).run();
  return 'processed' as const;
}

async function retryUnmatchedVoidedPurchases(env: BillingEnv, projectId: string) {
  const rows = await env.DB.prepare(`
    SELECT payload FROM billing_events
    WHERE project_id = ? AND provider = 'google' AND environment = 'production'
      AND event_type = 'voided_purchase_detected' AND status = 'failed'
      AND error_code = 'transaction_not_found' AND attempt_count < 100
    ORDER BY occurred_at LIMIT 100
  `).bind(projectId).all<{ payload: string }>();
  for (const row of rows.results || []) {
    try {
      const parsed = JSON.parse(row.payload) as VoidedPurchase;
      await processVoidedPurchase(env, projectId, parsed);
    } catch (error) {
      if ((error as { code?: string }).code !== 'google_voided_purchase_invalid') throw error;
    }
  }
}

async function findTransaction(db: D1Database, projectId: string, orderId: string, purchaseToken: string) {
  return db.prepare(`
    SELECT t.project_id, t.application_id, t.customer_id, t.store_transaction_id,
      t.original_transaction_id, t.order_id, t.purchase_token, t.purchased_at,
      p.store_product_id, p.product_type
    FROM billing_transactions t
    JOIN billing_products p ON p.id = t.product_id
    WHERE t.project_id = ? AND t.store = 'google' AND t.environment = 'production'
      AND (t.order_id = ? OR (
        t.order_id IS NULL AND p.product_type <> 'subscription'
        AND ? <> '' AND t.purchase_token = ?
      ))
    ORDER BY CASE WHEN t.order_id = ? THEN 0 ELSE 1 END, t.verified_at DESC
    LIMIT 1
  `).bind(projectId, orderId, purchaseToken, purchaseToken, orderId).first<MatchedTransaction>();
}

function positiveMillis(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
