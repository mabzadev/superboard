import type { BillingEnv } from '../types';
import type { VerifiedPurchase } from './billing';

type RefundCaseStatus = 'open' | 'evidence_required' | 'awaiting_approval' | 'submitted' | 'won' | 'lost' | 'closed';

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function providerObject(payload: unknown): Record<string, any> {
  const root = objectValue(payload);
  return objectValue(objectValue(root.data).object);
}

function relevantRefundEvent(purchase: VerifiedPurchase): boolean {
  return ['refunded', 'revoked'].includes(purchase.status)
    || /(REFUND|REVOK|VOID|CHARGEBACK|DISPUTE|INQUIRY|CONSUMPTION_REQUEST|FRAUD_WARNING)/i.test(purchase.eventType);
}

function caseType(eventType: string): string {
  if (/CONSUMPTION_REQUEST/i.test(eventType)) return 'consumption_request';
  if (/INQUIRY/i.test(eventType)) return 'inquiry';
  if (/DISPUTE|CHARGEBACK/i.test(eventType)) return 'dispute';
  if (/FRAUD_WARNING/i.test(eventType)) return 'fraud_warning';
  if (/VOID/i.test(eventType)) return 'voided_purchase';
  return 'refund';
}

function caseStatus(purchase: VerifiedPurchase): RefundCaseStatus {
  if (/REFUND[_.](DECLINED|REVERSED)|DISPUTE.*WON/i.test(purchase.eventType)) return 'won';
  if (['refunded', 'revoked'].includes(purchase.status) || /VOID|DISPUTE.*LOST/i.test(purchase.eventType)) return 'lost';
  if (/CONSUMPTION_REQUEST|DISPUTE|INQUIRY/i.test(purchase.eventType)) return 'evidence_required';
  return 'open';
}

function providerCaseId(purchase: VerifiedPurchase): string {
  const root = objectValue(purchase.rawPayload);
  const provider = providerObject(purchase.rawPayload);
  const candidates = purchase.store === 'apple'
    ? [purchase.originalTransactionId, purchase.storeTransactionId, root.notificationUUID]
    : purchase.store === 'google'
      ? [root.voidedPurchaseId, purchase.orderId, purchase.originalTransactionId, purchase.storeTransactionId]
      : [provider.id, root.disputeId, root.refundId, purchase.originalTransactionId, purchase.orderId, purchase.storeTransactionId];
  return String(candidates.find((value) => typeof value === 'string' && value.length > 0));
}

function deadlineFromPayload(payload: unknown): string | null {
  const root = objectValue(payload);
  const provider = providerObject(payload);
  const candidate = provider.evidence_details?.due_by || root.deadline_at || root.deadlineAt;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return new Date(candidate * 1000).toISOString();
  if (typeof candidate === 'string' && Number.isFinite(Date.parse(candidate))) return new Date(candidate).toISOString();
  return null;
}

function normalizedProviderEventAt(purchase: VerifiedPurchase): string {
  for (const value of [purchase.eventOccurredAt, purchase.purchasedAt]) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
      return new Date(value).toISOString();
    }
  }
  return new Date().toISOString();
}

function refundEventPriority(eventType: string): number {
  if (/REFUND[_.](DECLINED|REVERSED)|DISPUTE.*WON/i.test(eventType)) return 90;
  if (/REFUND|REVOK|VOID|DISPUTE.*LOST|CHARGEBACK.*LOST/i.test(eventType)) return 80;
  if (/CONSUMPTION_REQUEST|DISPUTE|CHARGEBACK|INQUIRY/i.test(eventType)) return 40;
  if (/FRAUD_WARNING/i.test(eventType)) return 30;
  return 10;
}

export function refundProjectionVersion(purchase: VerifiedPurchase): string {
  const eventAt = normalizedProviderEventAt(purchase);
  const priority = String(refundEventPriority(purchase.eventType)).padStart(3, '0');
  return `${eventAt}|${priority}|${purchase.eventType.toUpperCase()}|${purchase.storeTransactionId}`;
}

export async function recordRefundCaseForPurchase(
  env: BillingEnv,
  purchase: VerifiedPurchase,
  transactionId: string,
): Promise<{ caseId: string; status: RefundCaseStatus } | null> {
  if (!relevantRefundEvent(purchase)) return null;
  const externalId = providerCaseId(purchase);
  const status = caseStatus(purchase);
  const providerEventAt = normalizedProviderEventAt(purchase);
  const projectionVersion = refundProjectionVersion(purchase);
  const deadline = deadlineFromPayload(purchase.rawPayload) || (/CONSUMPTION_REQUEST/i.test(purchase.eventType)
    ? new Date(Date.now() + (purchase.environment === 'sandbox' ? 5 * 60_000 : 12 * 60 * 60_000)).toISOString()
    : null);
  const proposedId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO billing_refund_cases (
      id, project_id, customer_id, transaction_id, provider, environment,
      provider_case_id, case_type, status, reason, amount_micros, currency,
      deadline_at, provider_payload, resolved_at, provider_event_at, projection_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IN ('won','lost','closed') THEN datetime('now') END, ?, ?)
    ON CONFLICT(project_id, provider, environment, provider_case_id) DO UPDATE SET
      customer_id = COALESCE(excluded.customer_id, billing_refund_cases.customer_id),
      transaction_id = CASE WHEN excluded.projection_version >= COALESCE(billing_refund_cases.projection_version, '') THEN excluded.transaction_id ELSE billing_refund_cases.transaction_id END,
      case_type = CASE WHEN excluded.projection_version >= COALESCE(billing_refund_cases.projection_version, '') THEN excluded.case_type ELSE billing_refund_cases.case_type END,
      status = CASE WHEN excluded.projection_version >= COALESCE(billing_refund_cases.projection_version, '') THEN excluded.status ELSE billing_refund_cases.status END,
      reason = CASE WHEN excluded.projection_version >= COALESCE(billing_refund_cases.projection_version, '') THEN excluded.reason ELSE billing_refund_cases.reason END,
      amount_micros = CASE
        WHEN billing_refund_cases.amount_micros IS NULL THEN excluded.amount_micros
        WHEN excluded.projection_version >= COALESCE(billing_refund_cases.projection_version, '') THEN COALESCE(excluded.amount_micros, billing_refund_cases.amount_micros)
        ELSE billing_refund_cases.amount_micros END,
      currency = CASE
        WHEN billing_refund_cases.currency IS NULL THEN excluded.currency
        WHEN excluded.projection_version >= COALESCE(billing_refund_cases.projection_version, '') THEN COALESCE(excluded.currency, billing_refund_cases.currency)
        ELSE billing_refund_cases.currency END,
      deadline_at = CASE WHEN excluded.projection_version >= COALESCE(billing_refund_cases.projection_version, '') THEN excluded.deadline_at ELSE billing_refund_cases.deadline_at END,
      provider_payload = CASE WHEN excluded.projection_version >= COALESCE(billing_refund_cases.projection_version, '') THEN excluded.provider_payload ELSE billing_refund_cases.provider_payload END,
      resolved_at = CASE
        WHEN excluded.projection_version < COALESCE(billing_refund_cases.projection_version, '') THEN billing_refund_cases.resolved_at
        WHEN excluded.status IN ('won','lost','closed') THEN datetime('now')
        ELSE NULL END,
      provider_event_at = CASE WHEN excluded.projection_version >= COALESCE(billing_refund_cases.projection_version, '') THEN excluded.provider_event_at ELSE billing_refund_cases.provider_event_at END,
      projection_version = MAX(COALESCE(billing_refund_cases.projection_version, ''), excluded.projection_version),
      updated_at = datetime('now')
  `).bind(
    proposedId,
    String(purchase.projectId),
    purchase.customerId || null,
    transactionId,
    purchase.store,
    purchase.environment,
    externalId,
    caseType(purchase.eventType),
    status,
    purchase.eventType,
    purchase.priceMicros ?? null,
    purchase.currency || null,
    deadline,
    JSON.stringify(purchase.rawPayload),
    status,
    providerEventAt,
    projectionVersion,
  ).run();
  const refundCase = await env.DB.prepare(`
    SELECT id, status, projection_version FROM billing_refund_cases
    WHERE project_id = ? AND provider = ? AND environment = ? AND provider_case_id = ?
  `).bind(String(purchase.projectId), purchase.store, purchase.environment, externalId)
    .first<{ id: string; status?: RefundCaseStatus; projection_version?: string | null }>();
  if (!refundCase) throw new Error('Unable to persist refund case');
  const projectionAccepted = !refundCase.projection_version || refundCase.projection_version === projectionVersion;

  const auditId = `${refundCase.id}:${purchase.eventType}:${transactionId}`;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_refund_audit_events (id, case_id, event_type, actor_type, payload)
    VALUES (?, ?, ?, 'provider', ?)
  `).bind(auditId, refundCase.id, purchase.eventType, JSON.stringify({ transaction_id: transactionId, status })).run();

  if (projectionAccepted && deadline) {
    await env.DB.prepare(`
      INSERT INTO billing_refund_deadlines (id, case_id, deadline_type, due_at)
      VALUES (?, ?, 'provider_response', ?)
      ON CONFLICT(case_id, deadline_type) DO UPDATE SET due_at = excluded.due_at, status = 'open', updated_at = datetime('now')
    `).bind(crypto.randomUUID(), refundCase.id, deadline).run();
  }

  if (projectionAccepted && ['won', 'lost', 'closed'].includes(refundCase.status || status)) {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE billing_refund_deadlines
        SET status = 'cancelled', updated_at = datetime('now')
        WHERE case_id = ? AND status = 'open'
      `).bind(refundCase.id),
      env.DB.prepare(`
        UPDATE billing_refund_provider_actions
        SET status = 'cancelled', next_attempt_at = NULL, claim_token = NULL,
          claim_expires_at = NULL, updated_at = datetime('now')
        WHERE case_id = ? AND status IN ('draft','approved','queued','failed')
      `).bind(refundCase.id),
    ]);
  }

  if (projectionAccepted && /CONSUMPTION_REQUEST/i.test(purchase.eventType)) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO billing_refund_provider_actions (
        id, case_id, action_type, payload, status, idempotency_key
      ) VALUES (?, ?, 'submit_consumption_info', '{}', 'draft', ?)
    `).bind(crypto.randomUUID(), refundCase.id, `refund:${refundCase.id}:submit_consumption_info`).run();
  }
  if (projectionAccepted && purchase.store === 'stripe' && /DISPUTE|CHARGEBACK|INQUIRY/i.test(purchase.eventType)) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO billing_refund_provider_actions (
        id, case_id, action_type, payload, status, idempotency_key
      ) VALUES (?, ?, 'submit_stripe_dispute_evidence', '{"evidence":{}}', 'draft', ?)
    `).bind(crypto.randomUUID(), refundCase.id, `refund:${refundCase.id}:submit_stripe_dispute_evidence`).run();
  }
  if (projectionAccepted && purchase.store === 'stripe' && /FRAUD_WARNING/i.test(purchase.eventType)) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO billing_refund_provider_actions (
        id, case_id, action_type, payload, status, idempotency_key
      ) VALUES (?, ?, 'create_stripe_refund', '{"reason":"fraudulent"}', 'draft', ?)
    `).bind(crypto.randomUUID(), refundCase.id, `refund:${refundCase.id}:create_stripe_refund`).run();
  }
  return { caseId: refundCase.id, status: refundCase.status || status };
}
