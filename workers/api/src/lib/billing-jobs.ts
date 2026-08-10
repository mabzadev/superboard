import type { BillingEnv } from '../types';
import { decryptCredential, hmacSha256 } from './secrets';
import { verifyAppleNotification } from './store-verification';
import { reconcileAppleSubscription, verifyGooglePurchase } from './store-verification';
import { applyVerifiedPurchase, queueCustomerEntitlementChanged, type BillingEnvironment } from './billing';
import { recordGooglePendingRefundReview } from './refunds';
import { readTextLimited } from './http-limits';

export async function reconcileRefundDeadlines(env: BillingEnv, limit = 100) {
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit || 100)));
  const deadlines = await env.DB.prepare(`
    SELECT deadline.id, deadline.case_id, deadline.deadline_type, deadline.due_at
    FROM billing_refund_deadlines deadline
    JOIN billing_refund_cases refund ON refund.id = deadline.case_id
    WHERE deadline.status = 'open' AND datetime(deadline.due_at) <= datetime('now')
      AND refund.status NOT IN ('won','lost','closed')
    ORDER BY deadline.due_at ASC, deadline.id ASC
    LIMIT ?
  `).bind(boundedLimit).all<{
    id: string;
    case_id: string;
    deadline_type: string;
    due_at: string;
  }>();
  const rows = deadlines.results || [];
  if (!rows.length) return 0;
  const statements = rows.flatMap((deadline) => [
    env.DB.prepare(`
      UPDATE billing_refund_deadlines
      SET status = 'missed', completed_at = COALESCE(completed_at, datetime('now')), updated_at = datetime('now')
      WHERE id = ? AND status = 'open' AND datetime(due_at) <= datetime('now')
        AND case_id IN (
          SELECT id FROM billing_refund_cases WHERE status NOT IN ('won','lost','closed')
        )
    `).bind(deadline.id),
    env.DB.prepare(`
      INSERT OR IGNORE INTO billing_refund_audit_events (id, case_id, event_type, actor_type, payload)
      SELECT ?, ?, 'deadline.missed', 'system', ?
      WHERE EXISTS (
        SELECT 1 FROM billing_refund_deadlines WHERE id = ? AND status = 'missed'
      )
    `).bind(
      `refund-deadline:${deadline.id}:missed`,
      deadline.case_id,
      JSON.stringify({ deadline_id: deadline.id, deadline_type: deadline.deadline_type, due_at: deadline.due_at }),
      deadline.id,
    ),
  ]);
  const results = await env.DB.batch(statements);
  return rows.reduce((total, _deadline, index) => total + Number((results[index * 2] as D1Result | undefined)?.meta?.changes || 0), 0);
}

export async function processAppleBillingNotification(env: BillingEnv, params: {
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

export async function processGoogleBillingNotification(env: BillingEnv, params: {
  eventId: string;
  projectId: string;
  purchaseToken: string;
  productId: string;
  productType: 'subscription' | 'non_consumable' | 'consumable';
  eventType: string;
  eventOccurredAt: string;
  environment?: BillingEnvironment;
}) {
  try {
    // Jobs queued before environment classification was introduced were all
    // persisted as production events. Preserve that replay behavior during cutover.
    const environment = params.environment === 'sandbox' ? 'sandbox' : 'production';
    const verified = await verifyGooglePurchase(env, {
      projectId: params.projectId,
      customerId: null,
      purchaseToken: params.purchaseToken,
      storeProductId: params.productId,
      productType: params.productType,
      environment,
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

export async function processGooglePendingRefundReview(env: BillingEnv, params: {
  eventId: string;
  projectId: string;
  eventOccurredAt: string;
  environment: BillingEnvironment;
}) {
  try {
    const event = await env.DB.prepare(`
      SELECT payload FROM billing_webhook_events
      WHERE id = ? AND project_id = ? AND store = 'google' AND environment = ?
      LIMIT 1
    `).bind(params.eventId, params.projectId, params.environment).first<{ payload: string }>();
    if (!event?.payload || event.payload.length > 1_048_576) throw new Error('Google pending refund review payload is unavailable');
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(event.payload) as Record<string, unknown>; }
    catch { throw new Error('Google pending refund review payload is invalid'); }
    const result = await recordGooglePendingRefundReview(env, {
      projectId: params.projectId,
      environment: params.environment,
      eventOccurredAt: params.eventOccurredAt,
      payload,
    });
    await env.DB.prepare(`
      UPDATE billing_webhook_events SET status = 'processed', attempts = attempts + 1,
        event_type = 'PENDING_REFUND_REVIEW_CHARGEBACK', processed_at = datetime('now'), error_message = NULL
      WHERE id = ?
    `).bind(params.eventId).run();
    return { processed: true, refund_case_id: result?.caseId || null };
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

function webhookDeliveryError(message: string, retryable: boolean, retryDelaySeconds?: number) {
  return Object.assign(new Error(message), {
    retryable,
    ...(retryDelaySeconds ? { retryDelaySeconds } : {}),
  });
}

function webhookRetryDelay(attempt: number, response?: Response) {
  const retryAfter = Number(response?.headers.get('Retry-After') || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.max(30, Math.min(3600, Math.trunc(retryAfter)));
  }
  return Math.min(3600, 30 * (1 << Math.min(7, Math.max(1, attempt))));
}

function responseDeclaresRetryable(body: string) {
  try {
    const value = JSON.parse(body);
    return Boolean(value && typeof value === 'object' && value.retryable === true);
  } catch {
    return false;
  }
}

async function responsePreview(response: Response) {
  try {
    return await readTextLimited(response, 4096, 'Webhook response body is too large');
  } catch (error) {
    if ((error as { code?: string })?.code === 'body_too_large') {
      return '[Webhook response body exceeded 4096 bytes]';
    }
    throw error;
  }
}

async function recordWebhookDeliveryFailure(env: BillingEnv, params: {
  deliveryId: string;
  claimToken: string;
  attempt: number;
  message: string;
  retryable: boolean;
  retryDelaySeconds: number;
  responseStatus?: number | null;
  responseBody?: string | null;
}) {
  await env.DB.prepare(`
    UPDATE billing_webhook_deliveries
    SET attempts = ?, last_attempt_at = datetime('now'), response_status = ?, response_body = ?,
        error_message = ?, status = 'failed',
        next_attempt_at = CASE WHEN ? THEN datetime('now', '+' || ? || ' seconds') ELSE NULL END,
        claim_token = NULL, claim_expires_at = NULL
    WHERE id = ? AND claim_token = ?
  `).bind(
    params.attempt,
    params.responseStatus ?? null,
    params.responseBody?.slice(0, 4096) ?? null,
    params.message.slice(0, 1000),
    params.retryable ? 1 : 0,
    params.retryDelaySeconds,
    params.deliveryId,
    params.claimToken,
  ).run();
}

export async function deliverBillingWebhook(env: BillingEnv, deliveryId: string) {
  const claimToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(`
    UPDATE billing_webhook_deliveries
    SET claim_token = ?, claim_expires_at = datetime('now', '+2 minutes')
    WHERE id = ? AND status IN ('pending', 'failed')
      AND attempts < 10
      AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
      AND (claim_token IS NULL OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime('now'))
  `).bind(claimToken, deliveryId).run();
  if (Number(claimed.meta.changes || 0) === 0) {
    const state = await env.DB.prepare(`
      SELECT status, attempts, next_attempt_at, claim_expires_at
      FROM billing_webhook_deliveries WHERE id = ? LIMIT 1
    `).bind(deliveryId).first<Record<string, unknown>>();
    if (!state) throw webhookDeliveryError('Billing webhook delivery not found', false);
    return { skipped: true, status: String(state.status || 'unknown') };
  }
  const delivery = await env.DB.prepare(`
    SELECT d.id, d.payload, d.attempts, e.url, e.signing_secret_encrypted, e.active
    FROM billing_webhook_deliveries d
    JOIN billing_webhook_endpoints e ON e.id = d.endpoint_id
    WHERE d.id = ? AND d.claim_token = ?
    LIMIT 1
  `).bind(deliveryId, claimToken).first<Record<string, unknown>>();
  if (!delivery) throw webhookDeliveryError('Claimed billing webhook delivery not found', false);
  const attempt = Number(delivery.attempts || 0) + 1;
  if (Number(delivery.active) !== 1) {
    await env.DB.prepare(`
      UPDATE billing_webhook_deliveries
      SET status = 'skipped', next_attempt_at = NULL, error_message = 'Webhook endpoint is inactive',
          claim_token = NULL, claim_expires_at = NULL
      WHERE id = ? AND claim_token = ?
    `).bind(deliveryId, claimToken).run();
    return { skipped: true, status: 'inactive' };
  }
  let response: Response | undefined;
  try {
    try {
      safeWebhookUrl(String(delivery.url));
    } catch (error) {
      throw webhookDeliveryError(
        error instanceof Error ? error.message : 'Billing webhook URL is invalid',
        false,
      );
    }
    const payload = String(delivery.payload);
    const secretReference = String(delivery.signing_secret_encrypted);
    const secret = secretReference === 'env:OPENGROW_ENTITLEMENT_WEBHOOK_SECRET'
      ? env.OPENGROW_ENTITLEMENT_WEBHOOK_SECRET
      : await decryptCredential(env, secretReference);
    if (!secret) throw webhookDeliveryError('Billing webhook signing secret is unavailable', false);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await hmacSha256(secret, `${timestamp}.${payload}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('Webhook delivery timed out'), 15_000);
    try {
      response = await fetch(String(delivery.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'OpenGrow-Purchases-Webhook/1.0',
          'X-OpenGrow-Delivery': deliveryId,
          'X-OpenGrow-Timestamp': timestamp,
          'X-OpenGrow-Signature': `v1=${signature}`,
        },
        body: payload,
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const responseBody = await responsePreview(response);
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429
        || response.status >= 500 || responseDeclaresRetryable(responseBody);
      const retryDelaySeconds = webhookRetryDelay(attempt, response);
      const message = `Billing webhook returned HTTP ${response.status}`;
      await recordWebhookDeliveryFailure(env, {
        deliveryId, claimToken, attempt, message, retryable, retryDelaySeconds,
        responseStatus: response.status, responseBody,
      });
      throw webhookDeliveryError(message, retryable, retryDelaySeconds);
    }
    await env.DB.prepare(`
      UPDATE billing_webhook_deliveries
      SET attempts = ?, last_attempt_at = datetime('now'), response_status = ?, response_body = ?,
          error_message = NULL, status = 'delivered', delivered_at = datetime('now'),
          next_attempt_at = NULL, claim_token = NULL, claim_expires_at = NULL
      WHERE id = ? AND claim_token = ?
    `).bind(attempt, response.status, responseBody, deliveryId, claimToken).run();
    return { delivered: true, status: response.status };
  } catch (error) {
    if (response) throw error;
    const tagged = error as { retryable?: boolean; retryDelaySeconds?: number };
    const retryable = tagged.retryable !== false;
    const retryDelaySeconds = tagged.retryDelaySeconds || webhookRetryDelay(attempt);
    const message = error instanceof Error ? error.message : String(error);
    await recordWebhookDeliveryFailure(env, {
      deliveryId, claimToken, attempt, message, retryable, retryDelaySeconds,
    });
    throw webhookDeliveryError(message, retryable, retryDelaySeconds);
  }
}

export async function reconcileBillingState(env: BillingEnv) {
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
  const refundActions = await env.DB.prepare(`
    SELECT action.id
    FROM billing_refund_provider_actions action
    JOIN billing_refund_cases refund ON refund.id = action.case_id
    WHERE refund.status NOT IN ('won','lost','closed')
      AND (action.status = 'approved'
        OR (action.status = 'queued'
          AND (action.claim_token IS NULL OR action.claim_expires_at IS NULL OR datetime(action.claim_expires_at) <= datetime('now')))
        OR (action.status = 'failed' AND action.next_attempt_at IS NOT NULL AND datetime(action.next_attempt_at) <= datetime('now')
          AND (action.claim_token IS NULL OR action.claim_expires_at IS NULL OR datetime(action.claim_expires_at) <= datetime('now'))))
      AND action.attempts < 8
    ORDER BY action.updated_at ASC LIMIT 100
  `).all<{ id: string }>();
  if (env.BILLING_QUEUE) {
    for (const row of refundActions.results || []) {
      await env.BILLING_QUEUE.send({ type: 'billing.refund.action.execute', actionId: row.id });
    }
  }
  const refundDeadlinesMissed = await reconcileRefundDeadlines(env);
  const googleVoidedProjects = await env.DB.prepare(`
    SELECT connection.project_id
    FROM billing_store_connections connection
    LEFT JOIN billing_google_voided_sync_state state
      ON state.project_id = connection.project_id AND state.environment = 'production'
    WHERE connection.provider = 'google' AND connection.environment = 'production'
      AND connection.status IN ('configured', 'connected')
      AND (state.last_completed_at IS NULL OR datetime(state.last_completed_at) <= datetime('now', '-15 minutes'))
      AND (state.claim_token IS NULL OR state.claim_expires_at IS NULL OR datetime(state.claim_expires_at) <= datetime('now'))
    ORDER BY COALESCE(state.last_completed_at, '1970-01-01') LIMIT 25
  `).all<{ project_id: string }>();
  if (env.BILLING_QUEUE) {
    for (const row of googleVoidedProjects.results || []) {
      await env.BILLING_QUEUE.send({ type: 'billing.google.voided.reconcile', projectId: row.project_id });
    }
  }
  const legacyInventoryRuns = await env.DB.prepare(`
    SELECT id, next_cursor
    FROM billing_legacy_inventory_runs
    WHERE status IN ('queued', 'running')
      AND (claim_token IS NULL OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime('now'))
      AND datetime(updated_at) <= datetime('now', '-5 minutes')
    ORDER BY updated_at ASC LIMIT 10
  `).all<{ id: string; next_cursor: string | null }>();
  if (env.BILLING_QUEUE) {
    for (const row of legacyInventoryRuns.results || []) {
      await env.BILLING_QUEUE.send({
        type: 'billing.legacy.inventory.page',
        runId: row.id,
        ...(row.next_cursor ? { cursor: row.next_cursor } : {}),
      });
    }
  }
  return {
    subscriptions_expired: expiredSubscriptions.meta.changes,
    entitlements_expired: expiredEntitlements.meta.changes,
    webhook_deliveries_enqueued: pendingDeliveries.results?.length || 0,
    subscriptions_enqueued: subscriptions.results?.length || 0,
    refund_actions_enqueued: refundActions.results?.length || 0,
    refund_deadlines_missed: refundDeadlinesMissed,
    google_voided_reconciliations_enqueued: googleVoidedProjects.results?.length || 0,
    legacy_inventory_runs_enqueued: legacyInventoryRuns.results?.length || 0,
  };
}

export async function reconcileStoreSubscription(env: BillingEnv, subscriptionId: string) {
  const row = await env.DB.prepare(`
    SELECT s.*, p.store_product_id, t.purchase_token
    FROM billing_subscriptions s
    JOIN billing_products p ON p.id = s.product_id
    LEFT JOIN billing_transactions t ON t.id = s.latest_transaction_id
    WHERE s.id = ? LIMIT 1
  `).bind(subscriptionId).first<Record<string, unknown>>();
  if (!row) return { skipped: true, reason: 'not_found' };
  if (!row.customer_id) return { skipped: true, reason: 'unowned' };
  try {
    const environment = String(row.environment) as BillingEnvironment;
    let result: Record<string, unknown>;
    if (row.store === 'apple') {
      const purchase = await reconcileAppleSubscription(env, {
        projectId: String(row.project_id),
        customerId: String(row.customer_id),
        transactionId: String(row.original_transaction_id),
        environment,
      });
      result = { store: 'apple', ...await applyVerifiedPurchase(env, purchase) };
    } else if (row.store === 'google' && row.purchase_token) {
      const verified = await verifyGooglePurchase(env, {
        projectId: String(row.project_id),
        customerId: String(row.customer_id),
        purchaseToken: String(row.purchase_token),
        storeProductId: String(row.store_product_id),
        productType: 'subscription',
        environment,
      });
      verified.purchase.eventType = `RECONCILIATION_${verified.purchase.status.toUpperCase()}`;
      result = { store: 'google', ...await applyVerifiedPurchase(env, verified.purchase) };
    } else {
      throw Object.assign(new Error('Subscription cannot be reconciled without provider verification data'), {
        code: 'subscription_reconciliation_data_missing', retryable: false,
      });
    }
    await env.DB.prepare(`
      UPDATE billing_subscriptions
      SET provider_last_verified_at = datetime('now'), provider_verification_status = 'verified',
        provider_verification_error_code = NULL, provider_verification_error_message = NULL,
        provider_verification_attempts = provider_verification_attempts + 1,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(subscriptionId).run();
    return result;
  } catch (error) {
    const tagged = error as { code?: string; message?: string };
    await env.DB.prepare(`
      UPDATE billing_subscriptions
      SET provider_verification_status = 'failed',
        provider_verification_error_code = ?, provider_verification_error_message = ?,
        provider_verification_attempts = provider_verification_attempts + 1,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      String(tagged.code || 'subscription_reconciliation_failed').slice(0, 100),
      String(tagged.message || 'Subscription reconciliation failed').slice(0, 1000),
      subscriptionId,
    ).run();
    throw error;
  }
}
