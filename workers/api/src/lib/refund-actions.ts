import type { BillingEnv } from '../types';
import {
  googlePlayAccess,
  sendAppleConsumptionInformation,
  type AppleConsumptionRequest,
} from './store-verification';
import { readTextLimited } from './http-limits';

export type RefundActionType =
  | 'submit_consumption_info'
  | 'refund_google_order'
  | 'revoke_google_subscription'
  | 'review_google_refund';

type RefundProvider = 'apple' | 'google';

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
    {
      action_type: 'review_google_refund',
      default_payload: {
        pendingRefundToken: '',
        sampleContentProvided: false,
        refundPreference: 'NEUTRAL',
        consumptionPercentageMilliunits: 0,
        consumptionUsageEvents: [],
      },
      recommended_evidence_type: 'access_activity_log',
    },
    { action_type: 'refund_google_order', default_payload: { revoke: true }, recommended_evidence_type: 'customer_context' },
    { action_type: 'revoke_google_subscription', default_payload: { refund_type: 'full' }, recommended_evidence_type: 'customer_context' },
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
const GOOGLE_REFUND_PREFERENCES = new Set(['DECLINE', 'APPROVE', 'NEUTRAL']);
const GOOGLE_USAGE_EVENT_FIELDS = new Set([
  'obfuscatedAccountId',
  'obfuscatedProfileId',
  'consumptionTime',
  'ipAddress',
  'consumptionItemDescription',
  'location',
]);
const GOOGLE_LOCATION_FIELDS = new Set(['regionCode', 'administrativeArea', 'locality', 'sublocality']);

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
  if (actionType === 'review_google_refund') {
    const pendingRefundToken = String(payload.pendingRefundToken || '').trim();
    if (!pendingRefundToken || pendingRefundToken.length > 4096) {
      throw actionError('google_pending_refund_token_invalid', 'A valid pendingRefundToken is required');
    }
    if (typeof payload.sampleContentProvided !== 'boolean') {
      throw actionError('google_sample_content_invalid', 'sampleContentProvided must be true or false');
    }
    const refundPreference = String(payload.refundPreference || '');
    if (!GOOGLE_REFUND_PREFERENCES.has(refundPreference)) {
      throw actionError('google_refund_preference_invalid', 'refundPreference must be DECLINE, APPROVE or NEUTRAL');
    }
    const result: Record<string, unknown> = {
      pendingRefundToken,
      sampleContentProvided: payload.sampleContentProvided,
      refundPreference,
    };
    if (payload.consumptionPercentageMilliunits !== undefined) {
      const percentage = Number(payload.consumptionPercentageMilliunits);
      if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100_000) {
        throw actionError('google_consumption_percentage_invalid', 'consumptionPercentageMilliunits must be an integer from 0 to 100000');
      }
      result.consumptionPercentageMilliunits = percentage;
    }
    if (payload.consumptionUsageEvents !== undefined) {
      if (!Array.isArray(payload.consumptionUsageEvents) || payload.consumptionUsageEvents.length > 1000) {
        throw actionError('google_usage_events_invalid', 'consumptionUsageEvents must contain at most 1000 events');
      }
      result.consumptionUsageEvents = payload.consumptionUsageEvents.map((rawEvent, index) => {
        const event = objectValue(rawEvent);
        for (const key of Object.keys(event)) {
          if (!GOOGLE_USAGE_EVENT_FIELDS.has(key)) {
            throw actionError('google_usage_event_field_invalid', `Google usage event field ${key} is not allowed`);
          }
        }
        const normalized: Record<string, unknown> = {};
        for (const key of ['obfuscatedAccountId', 'obfuscatedProfileId', 'ipAddress'] as const) {
          if (event[key] === undefined) continue;
          const text = String(event[key] || '').trim();
          if (!text || text.length > 1024) throw actionError('google_usage_event_value_invalid', `consumptionUsageEvents[${index}].${key} is invalid`);
          normalized[key] = text;
        }
        if (event.consumptionTime !== undefined) {
          const time = String(event.consumptionTime || '').trim();
          if (!time || !Number.isFinite(Date.parse(time))) {
            throw actionError('google_consumption_time_invalid', `consumptionUsageEvents[${index}].consumptionTime must be an RFC 3339 timestamp`);
          }
          normalized.consumptionTime = new Date(time).toISOString();
        }
        if (event.consumptionItemDescription !== undefined) {
          const description = String(event.consumptionItemDescription || '').trim();
          if (!description || description.length > 5000) {
            throw actionError('google_consumption_description_invalid', `consumptionUsageEvents[${index}].consumptionItemDescription is invalid`);
          }
          normalized.consumptionItemDescription = description;
        }
        if (event.location !== undefined) {
          const location = objectValue(event.location);
          for (const key of Object.keys(location)) {
            if (!GOOGLE_LOCATION_FIELDS.has(key)) {
              throw actionError('google_location_field_invalid', `Google location field ${key} is not allowed`);
            }
          }
          const regionCode = String(location.regionCode || '').trim().toUpperCase();
          if (!/^[A-Z]{2}$/.test(regionCode)) {
            throw actionError('google_location_region_invalid', `consumptionUsageEvents[${index}].location.regionCode is required`);
          }
          const normalizedLocation: Record<string, string> = { regionCode };
          for (const key of ['administrativeArea', 'locality', 'sublocality'] as const) {
            if (location[key] === undefined) continue;
            const text = String(location[key] || '').trim();
            if (!text || text.length > 500) throw actionError('google_location_value_invalid', `consumptionUsageEvents[${index}].location.${key} is invalid`);
            normalizedLocation[key] = text;
          }
          normalized.location = normalizedLocation;
        }
        if (!Object.keys(normalized).length) {
          throw actionError('google_usage_event_empty', `consumptionUsageEvents[${index}] must contain usage evidence`);
        }
        return normalized;
      });
    }
    return result;
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
  throw actionError('refund_action_unsupported', `${actionType || 'Refund action'} is not supported for ${provider || 'this provider'}`);
}

async function providerFetch(input: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw actionError('refund_provider_timeout', 'The provider request timed out', true);
    throw actionError('refund_provider_unavailable', error instanceof Error ? error.message : 'The provider request failed', true);
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedProviderJson(response: Response): Promise<Record<string, any>> {
  let text = '';
  try {
    text = await readTextLimited(response, 65_536, 'Provider response is too large');
  } catch (error) {
    if ((error as { code?: string })?.code === 'body_too_large') {
      throw actionError('refund_provider_response_too_large', 'The provider response exceeded 64 KB');
    }
    throw actionError('refund_provider_response_unavailable', 'The provider response could not be read', true);
  }
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, any>; }
  catch { throw actionError('refund_provider_response_invalid', 'The provider returned invalid JSON', response.status === 429 || response.status >= 500); }
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
    const response = await providerFetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(access.packageName)}/orders/${encodeURIComponent(orderId)}:refund?revoke=${payload.revoke === false ? 'false' : 'true'}`,
      { method: 'POST', headers: { Authorization: `Bearer ${access.token}`, Accept: 'application/json' } },
    );
    if (!response.ok) {
      const result = await boundedProviderJson(response);
      throw actionError('google_refund_failed', String(result?.error?.message || `Google Play returned HTTP ${response.status}`), response.status === 429 || response.status >= 500);
    }
    return { accepted: true, order_id: orderId, revoked: payload.revoke !== false };
  }
  if (row.action_type === 'review_google_refund') {
    const providerPayload = objectValue(row.provider_payload);
    const notification = objectValue(providerPayload.pendingRefundReviewNotification);
    const orderId = String(row.order_id || row.store_transaction_id || notification.orderId || '').trim();
    if (!orderId) throw actionError('google_order_missing', 'Google order ID is unavailable');
    const access = await googlePlayAccess(env, row.project_id);
    const response = await providerFetch(
      googleRefundReviewUrl(access.packageName, orderId),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      const result = await boundedProviderJson(response);
      throw actionError('google_refund_review_failed', String(result?.error?.message || `Google Play returned HTTP ${response.status}`), response.status === 408 || response.status === 429 || response.status >= 500);
    }
    await boundedProviderJson(response);
    return { accepted: true, order_id: orderId, refund_preference: payload.refundPreference };
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
    const response = await providerFetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(access.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}:revoke`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ revocationContext }),
      },
    );
    if (!response.ok) {
      const result = await boundedProviderJson(response);
      throw actionError('google_revoke_failed', String(result?.error?.message || `Google Play returned HTTP ${response.status}`), response.status === 429 || response.status >= 500);
    }
    return { accepted: true, refund_type: refundType };
  }
  throw actionError('refund_action_unsupported', 'The refund action is not supported for this provider');
}

export function googleRefundReviewUrl(packageName: string, orderId: string) {
  return `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/orders/${encodeURIComponent(orderId)}:reviewrefund`;
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
