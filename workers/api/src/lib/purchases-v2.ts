import type { Env } from '../types';
import type { BillingStatus, VerifiedPurchase } from './billing';

export const PURCHASE_EVENT_TYPES = [
  'initial_purchase',
  'trial_started',
  'trial_converted',
  'renewal',
  'product_changed',
  'cancelled',
  'reactivated',
  'grace_period_started',
  'billing_issue',
  'expired',
  'refunded',
  'refund_reversed',
  'revoked',
  'transferred',
  'promotional_granted',
  'promotional_revoked',
  'virtual_currency_adjusted',
] as const;

export const PAYWALL_EVENT_TYPES = [
  'impression',
  'package_selected',
  'closed',
  'purchase_started',
  'purchase_succeeded',
  'purchase_cancelled',
  'purchase_failed',
  'restore_started',
  'restore_succeeded',
  'restore_failed',
] as const;

export type PurchaseEventType = typeof PURCHASE_EVENT_TYPES[number];
export type PaywallEventType = typeof PAYWALL_EVENT_TYPES[number];

export type TargetingContext = {
  platform?: string | null;
  country?: string | null;
  storefront?: string | null;
  appVersion?: string | null;
  sdkVersion?: string | null;
  campaign?: string | null;
  attributes?: Record<string, unknown>;
};

type TargetingCondition = {
  field: string;
  operator?: string;
  value?: unknown;
};

export type PurchasesApiError = Error & {
  code?: string;
  status?: number;
  retryable?: boolean;
};

export function purchasesError(code: string, message: string, status = 422, retryable = false): PurchasesApiError {
  const error = new Error(message) as PurchasesApiError;
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  return error;
}

export function errorEnvelope(error: unknown, requestId = crypto.randomUUID()) {
  const value = error as PurchasesApiError;
  return {
    error: {
      code: value?.code || 'purchases_request_failed',
      message: value?.message || 'Purchases request failed',
      retryable: value?.retryable === true,
      request_id: requestId,
    },
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function jsonArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function versionParts(value: unknown): number[] {
  const matched = String(value || '').match(/\d+/g) || [];
  return matched.slice(0, 4).map(Number);
}

function compareVersions(left: unknown, right: unknown) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function contextValue(condition: TargetingCondition, context: TargetingContext): unknown {
  if (condition.field.startsWith('attribute.')) {
    return context.attributes?.[condition.field.slice('attribute.'.length)];
  }
  const values: Record<string, unknown> = {
    platform: context.platform,
    country: context.country,
    storefront: context.storefront,
    app_version: context.appVersion,
    sdk_version: context.sdkVersion,
    campaign: context.campaign,
  };
  return values[condition.field];
}

export function targetingMatches(conditionsValue: unknown, context: TargetingContext): boolean {
  const conditions = jsonArray<TargetingCondition>(conditionsValue);
  return conditions.every((condition) => {
    const actual = contextValue(condition, context);
    const expected = condition.value;
    const operator = condition.operator || 'equals';
    if (operator === 'exists') return actual !== null && actual !== undefined && actual !== '';
    if (operator === 'not_exists') return actual === null || actual === undefined || actual === '';
    if (operator === 'in' || operator === 'not_in') {
      const values = Array.isArray(expected) ? expected.map(String) : [String(expected)];
      const included = values.includes(String(actual));
      return operator === 'in' ? included : !included;
    }
    if (operator === 'contains') return String(actual || '').includes(String(expected || ''));
    if (operator === 'not_contains') return !String(actual || '').includes(String(expected || ''));
    if (['gt', 'gte', 'lt', 'lte'].includes(operator)) {
      const difference = condition.field.endsWith('_version')
        ? compareVersions(actual, expected)
        : Number(actual) - Number(expected);
      if (!Number.isFinite(difference)) return false;
      if (operator === 'gt') return difference > 0;
      if (operator === 'gte') return difference >= 0;
      if (operator === 'lt') return difference < 0;
      return difference <= 0;
    }
    if (operator === 'not_equals') return String(actual) !== String(expected);
    return String(actual) === String(expected);
  });
}

async function deterministicBucket(value: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  return (((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) % 10000;
}

export function normalizeBillingEventType(eventType: string, status: BillingStatus, periodType?: string): PurchaseEventType {
  const event = eventType.toUpperCase();
  if (/TRANSFER/.test(event)) return 'transferred';
  if (/REFUND_REVERSED|REFUND_REVERSE/.test(event)) return 'refund_reversed';
  if (/REFUND/.test(event) || status === 'refunded') return 'refunded';
  if (/REVOK/.test(event) || status === 'revoked') return 'revoked';
  if (/EXPIRE/.test(event) || status === 'expired') return 'expired';
  if (/GRACE/.test(event) || status === 'grace_period') return 'grace_period_started';
  if (/FAIL|BILLING_ISSUE/.test(event) || status === 'billing_issue') return 'billing_issue';
  if (/UNCANCEL|REACTIV/.test(event)) return 'reactivated';
  if (/CANCEL|DID_CHANGE_RENEWAL_STATUS/.test(event) || status === 'cancelled') return 'cancelled';
  if (/PRODUCT_CHANGE|UPGRADE|DOWNGRADE/.test(event)) return 'product_changed';
  if (/TRIAL_CONVERT/.test(event)) return 'trial_converted';
  if (periodType === 'trial' || status === 'trialing') return 'trial_started';
  if (/RENEW/.test(event)) return 'renewal';
  return 'initial_purchase';
}

export async function recordCanonicalBillingEvent(
  env: Env,
  purchase: VerifiedPurchase,
  transactionId: string,
) {
  const eventType = normalizeBillingEventType(purchase.eventType, purchase.status, purchase.periodType);
  const originalId = purchase.originalTransactionId || purchase.storeTransactionId;
  const subscription = purchase.productType === 'subscription'
    ? await env.DB.prepare(`
        SELECT id FROM billing_subscriptions
        WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id = ?
      `).bind(String(purchase.projectId), purchase.store, purchase.environment, originalId).first<{ id: string }>()
    : null;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_events (
      id, project_id, application_id, customer_id, transaction_id, subscription_id,
      provider, environment, external_event_id, event_type, status, occurred_at,
      processed_at, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processed', ?, datetime('now'), ?)
  `).bind(
    crypto.randomUUID(),
    String(purchase.projectId),
    purchase.applicationId ? String(purchase.applicationId) : null,
    purchase.customerId || null,
    transactionId,
    subscription?.id || null,
    purchase.store,
    purchase.environment,
    purchase.storeTransactionId,
    eventType,
    purchase.eventOccurredAt || purchase.purchasedAt || new Date().toISOString(),
    JSON.stringify(purchase.rawPayload || {}),
  ).run();
  await env.DB.prepare(`
    UPDATE billing_store_connections
    SET last_event_at = datetime('now'), status = 'connected', updated_at = datetime('now')
    WHERE project_id = ? AND provider = ? AND environment = ?
  `).bind(String(purchase.projectId), purchase.store, purchase.environment).run();
}

type ConfigurationResult = {
  placement: Record<string, unknown>;
  offeringIdentifier: string | null;
  paywall: Record<string, unknown> | null;
  assignment: Record<string, unknown> | null;
  ruleId: string | null;
};

export async function resolvePurchaseConfiguration(
  db: D1Database,
  projectId: string,
  customerId: string,
  placementIdentifier: string,
  context: TargetingContext,
  options: { growthEnabled?: boolean; paywallsEnabled?: boolean } = {},
): Promise<ConfigurationResult> {
  let placement = await db.prepare(`
    SELECT * FROM billing_placements
    WHERE project_id = ? AND identifier = ? AND active = 1 LIMIT 1
  `).bind(projectId, placementIdentifier).first<Record<string, unknown>>();
  if (!placement && placementIdentifier === 'default') {
    const offering = await db.prepare(`
      SELECT id FROM billing_offerings WHERE project_id = ? AND is_current = 1 AND active = 1 LIMIT 1
    `).bind(projectId).first<{ id: string }>();
    if (offering) {
      const id = crypto.randomUUID();
      await db.prepare(`
        INSERT OR IGNORE INTO billing_placements (id, project_id, identifier, display_name, default_offering_id)
        VALUES (?, ?, 'default', 'Default', ?)
      `).bind(id, projectId, offering.id).run();
      placement = await db.prepare(`SELECT * FROM billing_placements WHERE project_id = ? AND identifier = 'default'`)
        .bind(projectId).first<Record<string, unknown>>();
    }
  }
  if (!placement) throw purchasesError('placement_not_found', 'Placement not found', 404);

  let offeringId = placement.default_offering_id ? String(placement.default_offering_id) : null;
  let ruleId: string | null = null;
  const rules = options.growthEnabled === false ? { results: [] } : await db.prepare(`
    SELECT * FROM billing_targeting_rules
    WHERE project_id = ? AND placement_id = ? AND state = 'live'
      AND (starts_at IS NULL OR datetime(starts_at) <= datetime('now'))
      AND (ends_at IS NULL OR datetime(ends_at) > datetime('now'))
    ORDER BY priority ASC, created_at ASC
  `).bind(projectId, String(placement.id)).all<Record<string, unknown>>();
  for (const rule of rules.results || []) {
    if (targetingMatches(rule.conditions, context)) {
      offeringId = String(rule.offering_id);
      ruleId = String(rule.id);
      break;
    }
  }

  let assignment: Record<string, unknown> | null = null;
  const experiments = options.growthEnabled === false ? { results: [] } : await db.prepare(`
    SELECT * FROM billing_experiments
    WHERE project_id = ? AND placement_id = ? AND state = 'running'
      AND (starts_at IS NULL OR datetime(starts_at) <= datetime('now'))
      AND (ends_at IS NULL OR datetime(ends_at) > datetime('now'))
    ORDER BY created_at ASC
  `).bind(projectId, String(placement.id)).all<Record<string, unknown>>();
  for (const experiment of experiments.results || []) {
    if (!targetingMatches(experiment.audience_conditions, context)) continue;
    const existing = await db.prepare(`
      SELECT a.*, v.identifier, v.offering_id, v.is_control
      FROM billing_experiment_assignments a
      JOIN billing_experiment_variants v ON v.id = a.variant_id
      WHERE a.experiment_id = ? AND a.customer_id = ? LIMIT 1
    `).bind(String(experiment.id), customerId).first<Record<string, unknown>>();
    if (existing) {
      assignment = existing;
      offeringId = String(existing.offering_id);
      break;
    }
    const variants = await db.prepare(`
      SELECT * FROM billing_experiment_variants WHERE experiment_id = ? ORDER BY created_at ASC
    `).bind(String(experiment.id)).all<Record<string, unknown>>();
    const bucket = await deterministicBucket(`${experiment.id}:${customerId}`);
    let cursor = 0;
    let selected = (variants.results || [])[0];
    for (const variant of variants.results || []) {
      cursor += Math.max(0, Number(variant.weight || 0));
      if (bucket < cursor) { selected = variant; break; }
    }
    if (!selected) continue;
    const assignmentId = crypto.randomUUID();
    await db.prepare(`
      INSERT OR IGNORE INTO billing_experiment_assignments (id, experiment_id, customer_id, variant_id)
      VALUES (?, ?, ?, ?)
    `).bind(assignmentId, experiment.id, customerId, selected.id).run();
    assignment = {
      id: assignmentId,
      experiment_id: experiment.id,
      variant_id: selected.id,
      identifier: selected.identifier,
      offering_id: selected.offering_id,
      is_control: selected.is_control,
    };
    offeringId = String(selected.offering_id);
    break;
  }

  const offering = offeringId
    ? await db.prepare('SELECT identifier FROM billing_offerings WHERE id = ? AND project_id = ? AND active = 1')
      .bind(offeringId, projectId).first<{ identifier: string }>()
    : null;
  const paywallRow = offeringId && options.paywallsEnabled !== false
    ? await db.prepare(`
        SELECT p.id, p.identifier, p.display_name, p.offering_id,
               v.id AS version_id, v.version, v.configuration, v.localizations, v.published_at
        FROM billing_paywalls p
        JOIN billing_paywall_versions v ON v.id = p.active_version_id
        WHERE p.project_id = ? AND p.offering_id = ? AND p.active = 1 LIMIT 1
      `).bind(projectId, offeringId).first<Record<string, unknown>>()
    : null;
  const paywall = paywallRow ? {
    id: paywallRow.id,
    identifier: paywallRow.identifier,
    display_name: paywallRow.display_name,
    version_id: paywallRow.version_id,
    version: paywallRow.version,
    configuration: jsonObject(paywallRow.configuration),
    localizations: jsonObject(paywallRow.localizations),
    published_at: paywallRow.published_at,
  } : null;
  return {
    placement: {
      id: placement.id,
      identifier: placement.identifier,
      display_name: placement.display_name,
    },
    offeringIdentifier: offering?.identifier || null,
    paywall,
    assignment,
    ruleId,
  };
}
