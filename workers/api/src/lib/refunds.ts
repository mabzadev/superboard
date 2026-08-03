import type { Env } from '../types';
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
  if (/DISPUTE|CHARGEBACK/i.test(eventType)) return 'dispute';
  if (/INQUIRY/i.test(eventType)) return 'inquiry';
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
  const candidates = [
    provider.id,
    root.disputeId,
    root.refundId,
    root.voidedPurchaseId,
    root.notificationUUID,
    purchase.originalTransactionId,
    purchase.orderId,
    purchase.storeTransactionId,
  ];
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

export async function recordRefundCaseForPurchase(
  env: Env,
  purchase: VerifiedPurchase,
  transactionId: string,
): Promise<{ caseId: string; status: RefundCaseStatus } | null> {
  if (!relevantRefundEvent(purchase)) return null;
  const externalId = providerCaseId(purchase);
  const status = caseStatus(purchase);
  const deadline = deadlineFromPayload(purchase.rawPayload);
  const proposedId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO billing_refund_cases (
      id, project_id, customer_id, transaction_id, provider, environment,
      provider_case_id, case_type, status, reason, amount_micros, currency,
      deadline_at, provider_payload, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IN ('won','lost','closed') THEN datetime('now') END)
    ON CONFLICT(project_id, provider, environment, provider_case_id) DO UPDATE SET
      customer_id = COALESCE(excluded.customer_id, billing_refund_cases.customer_id),
      transaction_id = excluded.transaction_id,
      case_type = excluded.case_type,
      status = excluded.status,
      reason = excluded.reason,
      amount_micros = COALESCE(excluded.amount_micros, billing_refund_cases.amount_micros),
      currency = COALESCE(excluded.currency, billing_refund_cases.currency),
      deadline_at = COALESCE(excluded.deadline_at, billing_refund_cases.deadline_at),
      provider_payload = excluded.provider_payload,
      resolved_at = CASE WHEN excluded.status IN ('won','lost','closed') THEN datetime('now') ELSE NULL END,
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
  ).run();
  const refundCase = await env.DB.prepare(`
    SELECT id FROM billing_refund_cases
    WHERE project_id = ? AND provider = ? AND environment = ? AND provider_case_id = ?
  `).bind(String(purchase.projectId), purchase.store, purchase.environment, externalId).first<{ id: string }>();
  if (!refundCase) throw new Error('Unable to persist refund case');

  const auditId = `${refundCase.id}:${purchase.eventType}:${transactionId}`;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_refund_audit_events (id, case_id, event_type, actor_type, payload)
    VALUES (?, ?, ?, 'provider', ?)
  `).bind(auditId, refundCase.id, purchase.eventType, JSON.stringify({ transaction_id: transactionId, status })).run();

  if (deadline) {
    await env.DB.prepare(`
      INSERT INTO billing_refund_deadlines (id, case_id, deadline_type, due_at)
      VALUES (?, ?, 'provider_response', ?)
      ON CONFLICT(case_id, deadline_type) DO UPDATE SET due_at = excluded.due_at, status = 'open', updated_at = datetime('now')
    `).bind(crypto.randomUUID(), refundCase.id, deadline).run();
  }

  if (/CONSUMPTION_REQUEST/i.test(purchase.eventType)) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO billing_refund_provider_actions (
        id, case_id, action_type, payload, status, idempotency_key
      ) VALUES (?, ?, 'submit_consumption_info', '{}', 'draft', ?)
    `).bind(crypto.randomUUID(), refundCase.id, `refund:${refundCase.id}:submit_consumption_info`).run();
  }
  return { caseId: refundCase.id, status };
}
