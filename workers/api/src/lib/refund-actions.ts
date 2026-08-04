import type { BillingEnv } from '../types';
import { decryptCredential, scopedStoreCredential } from './secrets';
import {
  googlePlayAccess,
  sendAppleConsumptionInformation,
  type AppleConsumptionRequest,
} from './store-verification';

export type RefundActionType =
  | 'submit_consumption_info'
  | 'refund_google_order'
  | 'revoke_google_subscription'
  | 'submit_stripe_dispute_evidence'
  | 'create_stripe_refund';

type RefundProvider = 'apple' | 'google' | 'stripe';

export type RefundActionDefinition = {
  action_type: RefundActionType;
  default_payload: Record<string, unknown>;
  recommended_evidence_type: string;
};

type ActionRow = {
  id: string;
  case_id: string;
  action_type: RefundActionType;
  payload: string;
  status: 'draft' | 'approved' | 'queued' | 'sent' | 'failed' | 'cancelled';
  idempotency_key: string;
  attempts: number;
  project_id: string;
  provider: RefundProvider;
  environment: 'sandbox' | 'production';
  provider_case_id: string;
  provider_payload: string;
  refund_status: string;
  store_transaction_id: string | null;
  original_transaction_id: string | null;
  order_id: string | null;
  purchase_token: string | null;
  store_product_id: string | null;
  product_type: string | null;
};

const TERMINAL_REFUND_CASE_STATUSES = new Set(['won', 'lost', 'closed']);

export function refundCaseAllowsOperatorAction(status: unknown) {
  return !TERMINAL_REFUND_CASE_STATUSES.has(String(status || '').toLowerCase());
}

const ACTION_DEFINITIONS: Record<RefundProvider, RefundActionDefinition[]> = {
  apple: [{
    action_type: 'submit_consumption_info',
    default_payload: {
      customerConsented: false,
      deliveryStatus: 'DELIVERED',
      sampleContentProvided: false,
      consumptionPercentage: 0,
      refundPreference: 'DECLINE',
    },
    recommended_evidence_type: 'apple_consumption_consent',
  }],
  google: [
    { action_type: 'refund_google_order', default_payload: { revoke: true }, recommended_evidence_type: 'customer_context' },
    { action_type: 'revoke_google_subscription', default_payload: { refund_type: 'full' }, recommended_evidence_type: 'customer_context' },
  ],
  stripe: [
    { action_type: 'submit_stripe_dispute_evidence', default_payload: { evidence: {} }, recommended_evidence_type: 'access_activity_log' },
    { action_type: 'create_stripe_refund', default_payload: { reason: 'requested_by_customer' }, recommended_evidence_type: 'customer_context' },
  ],
};

const APPLE_DELIVERY = new Set([
  'DELIVERED',
  'UNDELIVERED_QUALITY_ISSUE',
  'UNDELIVERED_WRONG_ITEM',
  'UNDELIVERED_SERVER_OUTAGE',
  'UNDELIVERED_OTHER',
]);
const APPLE_PREFERENCES = new Set(['DECLINE', 'GRANT_FULL', 'GRANT_PRORATED']);
const STRIPE_TEXT_EVIDENCE = new Set([
  'access_activity_log',
  'billing_address',
  'cancellation_policy_disclosure',
  'cancellation_rebuttal',
  'customer_communication',
  'customer_email_address',
  'customer_name',
  'customer_purchase_ip',
  'duplicate_charge_explanation',
  'duplicate_charge_id',
  'product_description',
  'refund_policy_disclosure',
  'refund_refusal_explanation',
  'service_date',
  'shipping_address',
  'shipping_carrier',
  'shipping_date',
  'shipping_tracking_number',
  'uncategorized_text',
]);

function objectValue(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  try { return JSON.parse(String(value || '{}')) as Record<string, any>; } catch { return {}; }
}

function actionError(code: string, message: string, retryable = false) {
  return Object.assign(new Error(message), { code, retryable });
}

export function supportedRefundActions(provider: string): RefundActionType[] {
  return refundActionDefinitions(provider).map((definition) => definition.action_type);
}

export function refundActionDefinitions(provider: string): RefundActionDefinition[] {
  if (!(provider in ACTION_DEFINITIONS)) return [];
  return ACTION_DEFINITIONS[provider as RefundProvider].map((definition) => ({
    ...definition,
    default_payload: structuredClone(definition.default_payload),
  }));
}

export function validateRefundActionPayload(provider: string, actionType: string, value: unknown): Record<string, unknown> {
  if (!supportedRefundActions(provider).includes(actionType as RefundActionType)) {
    throw actionError('refund_action_unsupported', `${actionType || 'Refund action'} is not supported for ${provider || 'this provider'}`);
  }
  const payload = objectValue(value);
  if (actionType === 'submit_consumption_info') {
    if (payload.customerConsented !== true) {
      throw actionError('apple_consumption_consent_required', 'Explicit customer consent is required before sharing consumption data with Apple');
    }
    const deliveryStatus = String(payload.deliveryStatus || '');
    if (!APPLE_DELIVERY.has(deliveryStatus)) throw actionError('apple_delivery_status_invalid', 'A valid Apple deliveryStatus is required');
    if (typeof payload.sampleContentProvided !== 'boolean') {
      throw actionError('apple_sample_content_invalid', 'sampleContentProvided must be true or false');
    }
    const result: Record<string, unknown> = {
      customerConsented: true,
      deliveryStatus,
      sampleContentProvided: payload.sampleContentProvided,
    };
    if (payload.refundPreference !== undefined) {
      const preference = String(payload.refundPreference);
      if (!APPLE_PREFERENCES.has(preference)) throw actionError('apple_refund_preference_invalid', 'Apple refundPreference is invalid');
      result.refundPreference = preference;
    }
    if (payload.consumptionPercentage !== undefined) {
      const percentage = Number(payload.consumptionPercentage);
      if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100_000) {
        throw actionError('apple_consumption_percentage_invalid', 'consumptionPercentage must be an integer from 0 to 100000');
      }
      if (deliveryStatus !== 'DELIVERED' && percentage !== 0) {
        throw actionError('apple_consumption_delivery_mismatch', 'Undelivered purchases must have a zero consumptionPercentage');
      }
      result.consumptionPercentage = percentage;
    }
    return result;
  }
  if (actionType === 'refund_google_order') {
    return { revoke: payload.revoke !== false };
  }
  if (actionType === 'revoke_google_subscription') {
    const refundType = String(payload.refund_type || 'full');
    if (!['full', 'prorated', 'item'].includes(refundType)) throw actionError('google_refund_type_invalid', 'Google refund_type must be full, prorated or item');
    const result: Record<string, unknown> = { refund_type: refundType };
    if (refundType === 'item') {
      const productId = String(payload.product_id || '').trim();
      if (!productId) throw actionError('google_refund_product_required', 'product_id is required for an item-based refund');
      result.product_id = productId;
    }
    return result;
  }
  if (actionType === 'submit_stripe_dispute_evidence') {
    const evidence = objectValue(payload.evidence);
    const normalized: Record<string, string> = {};
    for (const [key, raw] of Object.entries(evidence)) {
      if (!STRIPE_TEXT_EVIDENCE.has(key)) throw actionError('stripe_evidence_field_invalid', `Stripe evidence field ${key} is not allowed`);
      const text = String(raw || '').trim();
      if (text.length > 20_000) throw actionError('stripe_evidence_too_large', `Stripe evidence field ${key} exceeds 20000 characters`);
      if (text) normalized[key] = text;
    }
    if (Object.values(normalized).reduce((total, text) => total + text.length, 0) > 150_000) {
      throw actionError('stripe_evidence_too_large', 'Combined Stripe evidence exceeds 150000 characters');
    }
    return { evidence: normalized };
  }
  const paymentIntent = String(payload.payment_intent || '').trim();
  const charge = String(payload.charge || '').trim();
  const result: Record<string, unknown> = {};
  if (paymentIntent) result.payment_intent = paymentIntent;
  if (charge) result.charge = charge;
  if (payload.amount !== undefined) {
    const amount = Number(payload.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw actionError('stripe_refund_amount_invalid', 'Stripe refund amount must be a positive integer in the smallest currency unit');
    result.amount = amount;
  }
  if (payload.reason !== undefined) {
    const reason = String(payload.reason);
    if (!['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason)) throw actionError('stripe_refund_reason_invalid', 'Stripe refund reason is invalid');
    result.reason = reason;
  }
  return result;
}

async function stripeConnection(env: BillingEnv, row: ActionRow) {
  const connection = await env.DB.prepare(`
    SELECT configuration_encrypted, billing_configuration_encrypted FROM billing_store_connections
    WHERE project_id = ? AND provider = 'stripe' AND environment = ?
      AND status IN ('configured','connected')
    LIMIT 1
  `).bind(row.project_id, row.environment).first<{
    configuration_encrypted: string | null;
    billing_configuration_encrypted: string | null;
  }>();
  const encrypted = connection && scopedStoreCredential(connection, env);
  if (!encrypted) throw actionError('stripe_connection_missing', 'Stripe is not configured for this project and environment');
  const credentials = objectValue(await decryptCredential(env, encrypted));
  const secretKey = String(credentials.secret_key || credentials.api_key || '');
  if (!secretKey.startsWith('sk_')) throw actionError('stripe_secret_invalid', 'Stripe secret key is invalid');
  return secretKey;
}

async function stripePost(secretKey: string, path: string, values: Record<string, string>, idempotencyKey: string) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey.slice(0, 255),
    },
    body: new URLSearchParams(values),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    throw actionError('stripe_refund_action_failed', String(payload?.error?.message || `Stripe returned HTTP ${response.status}`), response.status === 429 || response.status >= 500);
  }
  return payload;
}

async function approvedStripeEvidence(env: BillingEnv, row: ActionRow, payload: Record<string, unknown>) {
  const values = objectValue(payload.evidence);
  const evidenceRows = await env.DB.prepare(`
    SELECT evidence_type, content FROM billing_refund_evidence
    WHERE case_id = ? AND review_status = 'approved' AND content IS NOT NULL
    ORDER BY created_at
  `).bind(row.case_id).all<{ evidence_type: string; content: string }>();
  const uncategorized: string[] = [];
  for (const evidence of evidenceRows.results || []) {
    const key = String(evidence.evidence_type || '');
    const content = String(evidence.content || '').slice(0, 20_000);
    if (STRIPE_TEXT_EVIDENCE.has(key) && !values[key]) values[key] = content;
    else if (content) uncategorized.push(`${key}: ${content}`);
  }
  if (uncategorized.length && !values.uncategorized_text) {
    values.uncategorized_text = uncategorized.join('\n\n').slice(0, 20_000);
  }
  if (!Object.keys(values).length) throw actionError('stripe_evidence_required', 'At least one approved Stripe evidence field is required');
  if (Object.values(values).reduce((total, text) => total + String(text).length, 0) > 150_000) {
    throw actionError('stripe_evidence_too_large', 'Combined Stripe evidence exceeds 150000 characters');
  }
  return values as Record<string, string>;
}

async function runProviderAction(env: BillingEnv, row: ActionRow, payload: Record<string, unknown>) {
  if (row.action_type === 'submit_consumption_info') {
    const consent = await env.DB.prepare(`
      SELECT id FROM billing_refund_evidence
      WHERE case_id = ? AND evidence_type = 'apple_consumption_consent'
        AND review_status = 'approved' AND content IS NOT NULL
      LIMIT 1
    `).bind(row.case_id).first<{ id: string }>();
    if (!consent) throw actionError('apple_consumption_consent_evidence_required', 'Approved apple_consumption_consent evidence is required');
    const transactionId = String(row.store_transaction_id || row.original_transaction_id || '').trim();
    if (!transactionId) throw actionError('apple_transaction_missing', 'Apple transaction ID is unavailable');
    return sendAppleConsumptionInformation(env, {
      projectId: row.project_id,
      environment: row.environment,
      transactionId,
      payload: payload as AppleConsumptionRequest,
    });
  }
  if (row.action_type === 'refund_google_order') {
    const orderId = String(row.order_id || row.store_transaction_id || '').trim();
    if (!orderId) throw actionError('google_order_missing', 'Google order ID is unavailable');
    const access = await googlePlayAccess(env, row.project_id);
    const response = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(access.packageName)}/orders/${encodeURIComponent(orderId)}:refund?revoke=${payload.revoke === false ? 'false' : 'true'}`,
      { method: 'POST', headers: { Authorization: `Bearer ${access.token}`, Accept: 'application/json' } },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as Record<string, any>;
      throw actionError('google_refund_failed', String(result?.error?.message || `Google Play returned HTTP ${response.status}`), response.status === 429 || response.status >= 500);
    }
    return { accepted: true, order_id: orderId, revoked: payload.revoke !== false };
  }
  if (row.action_type === 'revoke_google_subscription') {
    const purchaseToken = String(row.purchase_token || '').trim();
    if (!purchaseToken) throw actionError('google_purchase_token_missing', 'Google purchase token is unavailable');
    const access = await googlePlayAccess(env, row.project_id);
    const refundType = String(payload.refund_type || 'full');
    const revocationContext = refundType === 'prorated'
      ? { proratedRefund: {} }
      : refundType === 'item'
        ? { itemBasedRefund: { productId: String(payload.product_id || row.store_product_id || '') } }
        : { fullRefund: {} };
    const response = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(access.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}:revoke`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ revocationContext }),
      },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as Record<string, any>;
      throw actionError('google_revoke_failed', String(result?.error?.message || `Google Play returned HTTP ${response.status}`), response.status === 429 || response.status >= 500);
    }
    return { accepted: true, refund_type: refundType };
  }
  const secretKey = await stripeConnection(env, row);
  if (row.action_type === 'submit_stripe_dispute_evidence') {
    const disputeId = String(row.provider_case_id || '').trim();
    if (!disputeId.startsWith('dp_')) throw actionError('stripe_dispute_missing', 'Stripe dispute ID is unavailable');
    const evidence = await approvedStripeEvidence(env, row, payload);
    const values: Record<string, string> = { submit: 'true' };
    for (const [key, value] of Object.entries(evidence)) values[`evidence[${key}]`] = value;
    const result = await stripePost(secretKey, `/disputes/${encodeURIComponent(disputeId)}`, values, row.idempotency_key);
    return { id: result.id, status: result.status, submitted: Boolean(result.evidence_details?.has_evidence) };
  }
  const providerPayload = objectValue(row.provider_payload);
  const providerObject = objectValue(objectValue(providerPayload.data).object);
  const paymentIntent = String(payload.payment_intent || providerObject.payment_intent || '').trim();
  const charge = String(payload.charge || providerObject.charge || '').trim();
  if (!paymentIntent && !charge) throw actionError('stripe_payment_reference_missing', 'Stripe payment_intent or charge is required');
  const values: Record<string, string> = paymentIntent ? { payment_intent: paymentIntent } : { charge };
  if (payload.amount !== undefined) values.amount = String(payload.amount);
  if (payload.reason) values.reason = String(payload.reason);
  const result = await stripePost(secretKey, '/refunds', values, row.idempotency_key);
  return { id: result.id, status: result.status, amount: result.amount, currency: result.currency };
}

async function refundActionClaimIsActive(env: BillingEnv, row: ActionRow, claimToken: string) {
  const active = await env.DB.prepare(`
    SELECT action.id
    FROM billing_refund_provider_actions action
    JOIN billing_refund_cases refund ON refund.id = action.case_id
    WHERE action.id = ? AND action.claim_token = ? AND action.status = 'queued'
      AND refund.status NOT IN ('won','lost','closed')
    LIMIT 1
  `).bind(row.id, claimToken).first<{ id: string }>();
  return Boolean(active);
}

export async function executeRefundProviderAction(env: BillingEnv, actionId: string) {
  const row = await env.DB.prepare(`
    SELECT action.*, refund.project_id, refund.provider, refund.environment,
      refund.provider_case_id, refund.provider_payload, refund.status AS refund_status,
      transaction_row.store_transaction_id, transaction_row.original_transaction_id,
      transaction_row.order_id, transaction_row.purchase_token,
      product.store_product_id, product.product_type
    FROM billing_refund_provider_actions action
    JOIN billing_refund_cases refund ON refund.id = action.case_id
    LEFT JOIN billing_transactions transaction_row ON transaction_row.id = refund.transaction_id
    LEFT JOIN billing_products product ON product.id = transaction_row.product_id
    WHERE action.id = ? LIMIT 1
  `).bind(actionId).first<ActionRow>();
  if (!row) throw actionError('refund_action_not_found', 'Refund provider action not found');
  if (row.status === 'sent') return { sent: true, duplicate: true };
  if (!refundCaseAllowsOperatorAction(row.refund_status)) {
    throw actionError('refund_case_terminal', 'A terminal refund case cannot send provider actions');
  }
  if (!['approved', 'queued', 'failed'].includes(row.status)) {
    throw actionError('refund_action_not_approved', 'Refund provider action requires human approval');
  }
  const claimToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(`
    UPDATE billing_refund_provider_actions
    SET status = 'queued', attempts = attempts + 1, last_error = NULL,
      claim_token = ?, claim_expires_at = datetime('now', '+10 minutes'), updated_at = datetime('now')
    WHERE id = ? AND attempts = ? AND status IN ('approved','queued','failed')
      AND (claim_token IS NULL OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime('now'))
      AND EXISTS (
        SELECT 1 FROM billing_refund_cases refund
        WHERE refund.id = billing_refund_provider_actions.case_id
          AND refund.status NOT IN ('won','lost','closed')
      )
  `).bind(claimToken, row.id, Number(row.attempts || 0)).run();
  if (!claimed.meta.changes) return { sent: false, claimed: false };
  try {
    const payload = validateRefundActionPayload(row.provider, row.action_type, row.payload);
    if (!await refundActionClaimIsActive(env, row, claimToken)) {
      return { sent: false, cancelled: true, provider: row.provider };
    }
    const providerResponse = await runProviderAction(env, row, payload);
    const serializedResponse = JSON.stringify(providerResponse);
    const completion = await env.DB.batch([
      env.DB.prepare(`
        UPDATE billing_refund_provider_actions
        SET status = 'sent', sent_at = datetime('now'), provider_response = ?,
          next_attempt_at = NULL, last_error = NULL, claim_token = ?,
          claim_expires_at = NULL, updated_at = datetime('now')
        WHERE id = ? AND claim_token = ?
      `).bind(serializedResponse, claimToken, row.id, claimToken),
      env.DB.prepare(`
        UPDATE billing_refund_cases SET status = 'submitted', updated_at = datetime('now')
        WHERE id = ? AND status NOT IN ('won','lost','closed')
          AND EXISTS (
            SELECT 1 FROM billing_refund_provider_actions
            WHERE id = ? AND status = 'sent' AND provider_response = ? AND claim_token = ?
          )
      `).bind(row.case_id, row.id, serializedResponse, claimToken),
      env.DB.prepare(`
        UPDATE billing_refund_deadlines SET status = 'met', completed_at = datetime('now'), updated_at = datetime('now')
        WHERE case_id = ? AND status = 'open'
          AND EXISTS (
            SELECT 1 FROM billing_refund_provider_actions
            WHERE id = ? AND status = 'sent' AND provider_response = ? AND claim_token = ?
          )
      `).bind(row.case_id, row.id, serializedResponse, claimToken),
      env.DB.prepare(`
        INSERT INTO billing_refund_audit_events (id, case_id, event_type, actor_type, payload)
        SELECT ?, ?, 'provider_action.sent', 'system', ?
        WHERE EXISTS (
          SELECT 1 FROM billing_refund_provider_actions
          WHERE id = ? AND status = 'sent' AND provider_response = ? AND claim_token = ?
        )
      `).bind(
        crypto.randomUUID(),
        row.case_id,
        JSON.stringify({ action_id: row.id, action_type: row.action_type, provider_response: providerResponse }),
        row.id,
        serializedResponse,
        claimToken,
      ),
    ]);
    if (!Number((completion[0] as D1Result | undefined)?.meta?.changes || 0)) {
      await env.DB.prepare(`
        INSERT INTO billing_refund_audit_events (id, case_id, event_type, actor_type, payload)
        VALUES (?, ?, 'provider_action.result_after_cancellation', 'system', ?)
      `).bind(
        crypto.randomUUID(),
        row.case_id,
        JSON.stringify({ action_id: row.id, action_type: row.action_type, provider_response: providerResponse }),
      ).run();
      return { sent: false, cancelled: true, provider: row.provider };
    }
    return { sent: true, provider: row.provider, response: providerResponse };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = Number(row.attempts || 0) + 1;
    const taggedRetryability = Boolean(error && typeof error === 'object' && 'retryable' in error);
    const providerRetryable = taggedRetryability ? (error as { retryable?: boolean }).retryable === true : true;
    const retryable = providerRetryable && attempts < 8;
    const retryDelaySeconds = Math.min(3600, 30 * (2 ** Math.min(7, attempts)));
    const failure = await env.DB.batch([
      env.DB.prepare(`
        UPDATE billing_refund_provider_actions
        SET status = 'failed', last_error = ?, next_attempt_at = CASE WHEN ? AND ? < 8
          THEN datetime('now', '+' || MIN(3600, 30 * (1 << MIN(7, ?))) || ' seconds') ELSE NULL END,
          claim_token = NULL, claim_expires_at = NULL, updated_at = datetime('now')
        WHERE id = ? AND claim_token = ?
      `).bind(message.slice(0, 1000), retryable ? 1 : 0, attempts, attempts, row.id, claimToken),
      env.DB.prepare(`
        INSERT INTO billing_refund_audit_events (id, case_id, event_type, actor_type, payload)
        SELECT ?, ?, 'provider_action.failed', 'system', ?
        WHERE EXISTS (
          SELECT 1 FROM billing_refund_provider_actions
          WHERE id = ? AND status = 'failed' AND last_error = ?
        )
      `).bind(
        crypto.randomUUID(),
        row.case_id,
        JSON.stringify({ action_id: row.id, action_type: row.action_type, retryable, error: message.slice(0, 1000) }),
        row.id,
        message.slice(0, 1000),
      ),
    ]);
    if (!Number((failure[0] as D1Result | undefined)?.meta?.changes || 0)) {
      return { sent: false, cancelled: true, provider: row.provider };
    }
    const output = error instanceof Error ? error : new Error(message);
    throw Object.assign(output, { retryable, retryDelaySeconds });
  }
}
