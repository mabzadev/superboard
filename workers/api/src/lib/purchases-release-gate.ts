export type ReleaseGateCheckDefinition = {
  key: string;
  provider: 'apple' | 'google' | 'stripe' | 'cross_platform';
  group: string;
  label: string;
  description: string;
  required_evidence: Array<'build' | 'device' | 'reference'>;
};

export type StoredReleaseGateCheck = {
  check_key: string;
  status: string;
  evidence_json?: string;
  notes?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  updated_at?: string | null;
};

export type ReleaseGatePrerequisite = {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
};

const nativeScenarios = [
  ['weekly_purchase', 'Weekly subscription purchase', 'Complete a verified purchase for the weekly subscription.'],
  ['yearly_purchase', 'Yearly subscription purchase', 'Complete a verified purchase for the yearly subscription.'],
  ['trial', 'Trial conversion', 'Start a trial and verify the entitlement and period type.'],
  ['pending', 'Pending purchase', 'Keep the purchase pending until the store resolves it.'],
  ['user_cancelled', 'User cancellation', 'Cancel the purchase sheet without granting an entitlement.'],
  ['renewal', 'Renewal', 'Verify a renewal event updates the existing subscription exactly once.'],
  ['upgrade_downgrade', 'Upgrade and downgrade', 'Verify plan changes preserve one canonical subscription state.'],
  ['expiration', 'Expiration', 'Verify expiration removes the entitlement deterministically.'],
  ['refund', 'Refund', 'Verify a provider refund revokes the entitlement.'],
  ['restore', 'Restore purchases', 'Restore verified purchases without duplicating transactions.'],
  ['device_change', 'Device change', 'Sign in on another device and recover the same entitlement.'],
  ['reinstall', 'Reinstallation', 'Reinstall the app and recover pending work and entitlements.'],
  ['interrupted_purchase', 'App closed during purchase', 'Close the app during purchase and resume validation after restart.'],
  ['network_loss', 'Network loss before validation', 'Recover a transaction after connectivity returns.'],
  ['duplicate_event', 'Duplicate provider event', 'Replay the same event without creating another transaction or entitlement.'],
  ['out_of_order_event', 'Out-of-order provider event', 'Apply events according to provider occurrence time.'],
] as const;

export const RELEASE_GATE_CHECKS: ReleaseGateCheckDefinition[] = [
  ...(['apple', 'google'] as const).flatMap((provider) => nativeScenarios.map(([key, label, description]) => ({
    key: `${provider}.${key}`,
    provider,
    group: provider === 'apple' ? 'Apple App Store' : 'Google Play',
    label,
    description,
    required_evidence: ['build', 'device', 'reference'] as Array<'build' | 'device' | 'reference'>,
  }))),
  ...([
    ['checkout', 'Checkout', 'Complete a Stripe Checkout session and redeem it for the identified customer.'],
    ['renewal', 'Renewal', 'Process a recurring invoice exactly once.'],
    ['payment_failed', 'Payment failure', 'Move the subscription to a billing issue without granting new access.'],
    ['portal', 'Billing Portal', 'Open the Billing Portal and return to the configured web application.'],
    ['refund', 'Refund', 'Process a Stripe refund and revoke the entitlement.'],
    ['dispute', 'Dispute', 'Process inquiry, evidence, and final dispute state.'],
  ] as const).map(([key, label, description]) => ({
    key: `stripe.${key}`, provider: 'stripe' as const, group: 'Stripe Web', label, description,
    required_evidence: ['reference'] as Array<'reference'>,
  })),
  ...([
    ['identity_sync', 'Authenticated identity', 'A failed identity synchronization blocks a new purchase.'],
    ['signed_customer_info', 'Signed CustomerInfo', 'The SDK rejects an invalid signature and caches only verified customer data.'],
    ['restart_recovery', 'Restart recovery', 'The encrypted outbox resumes every unfinished server validation.'],
    ['unverified_denied', 'Unverified transaction denied', 'No entitlement is granted from an unverified transaction.'],
    ['authority_convergence', 'Authority convergence', 'Store state, OpenGrow, and the application projection converge.'],
    ['flutterflow_ios', 'FlutterFlow on iOS', 'Run purchase, restore, synchronization, and subscription management on a real iOS device.'],
    ['flutterflow_android', 'FlutterFlow on Android', 'Run purchase, restore, synchronization, and subscription management on a real Android device.'],
    ['revenuecat_inventory', 'Legacy subscription inventory', 'Inventory and import every active legacy subscription before dependency removal.'],
  ] as const).map(([key, label, description]) => ({
    key: `cross_platform.${key}`, provider: 'cross_platform' as const, group: 'Cross-platform integrity', label, description,
    required_evidence: (key === 'flutterflow_ios' || key === 'flutterflow_android'
      ? ['build', 'device', 'reference']
      : key === 'revenuecat_inventory' ? ['reference'] : ['build', 'reference']) as Array<'build' | 'device' | 'reference'>,
  })),
];

export function validateReleaseGateEvidence(definition: ReleaseGateCheckDefinition, evidence: Record<string, unknown>) {
  const missing = definition.required_evidence.filter((field) => {
    const value = evidence[field];
    return typeof value !== 'string' || !value.trim() || value.trim().length > 500;
  });
  return { valid: missing.length === 0, missing };
}

export function buildReleaseGate(stored: StoredReleaseGateCheck[], prerequisites: ReleaseGatePrerequisite[]) {
  const byKey = new Map(stored.map((row) => [row.check_key, row]));
  const checks = RELEASE_GATE_CHECKS.map((definition) => {
    const row = byKey.get(definition.key);
    return {
      ...definition,
      status: row?.status || 'pending',
      evidence: parseObject(row?.evidence_json),
      notes: row?.notes || null,
      verified_by: row?.verified_by || null,
      verified_at: row?.verified_at || null,
      updated_at: row?.updated_at || null,
    };
  });
  const failedChecks = checks.filter((check) => check.status !== 'passed');
  const failedPrerequisites = prerequisites.filter((item) => !item.passed);
  const ready = failedChecks.length === 0 && failedPrerequisites.length === 0;
  return {
    ready,
    publication_allowed: ready,
    legacy_dependency_removal_allowed: ready,
    progress: { passed: checks.length - failedChecks.length, total: checks.length },
    prerequisites,
    checks,
    blockers: [
      ...failedPrerequisites.map((item) => ({ type: 'prerequisite', key: item.key, message: item.detail })),
      ...failedChecks.map((item) => ({ type: 'check', key: item.key, message: `${item.group}: ${item.label}` })),
    ],
  };
}

function parseObject(value: unknown) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return parseObject(JSON.parse(value)); } catch { return {}; }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
