import { describe, expect, it } from 'vitest';
import {
  billingOperationalPrerequisites,
  buildReleaseGate,
  catalogSyncFresh,
  certificationRunCompatibility,
  nativeCatalogCoverage,
  RELEASE_GATE_CHECKS,
  validateReleaseGateEvidence,
  type ReleaseGateCatalogProduct,
} from './purchases-release-gate';

function passedChecks() {
  return RELEASE_GATE_CHECKS.map((check) => ({
    check_key: check.key,
    status: 'passed',
    evidence_json: JSON.stringify({
      ...Object.fromEntries(check.required_evidence.map((field) => [field, `${field}-evidence`])),
      observation_id: `observation-${check.key}`,
      run_id: `run-${check.key}`,
      evidence_sha256: `digest-${check.key}`,
    }),
  }));
}

function passedObservations() {
  return RELEASE_GATE_CHECKS.map((check) => ({
    id: `observation-${check.key}`,
    run_id: `run-${check.key}`,
    check_key: check.key,
    outcome: 'passed',
    evidence_sha256: `digest-${check.key}`,
    run_status: 'completed',
    digest_valid: true,
  }));
}

describe('Purchases release gate', () => {
  it('stays closed until every provider scenario and prerequisite has evidence', () => {
    expect(buildReleaseGate(passedChecks(), [{ key: 'stores', label: 'Stores', passed: false, detail: 'Connect every store.' }], passedObservations()))
      .toMatchObject({ ready: false, publication_allowed: false, legacy_dependency_removal_allowed: false });
  });

  it('opens only when all required evidence and prerequisites pass', () => {
    const gate = buildReleaseGate(passedChecks(), [{ key: 'stores', label: 'Stores', passed: true, detail: 'All stores connected.' }], passedObservations());
    expect(gate.ready).toBe(true);
    expect(gate.progress).toEqual({ passed: RELEASE_GATE_CHECKS.length, total: RELEASE_GATE_CHECKS.length });
  });

  it('does not trust a stored passed status when required evidence is missing', () => {
    const stored = passedChecks();
    const nativeIndex = stored.findIndex((check) => check.check_key === 'apple.weekly_purchase');
    stored[nativeIndex] = {
      check_key: 'apple.weekly_purchase',
      status: 'passed',
      evidence_json: '{"reference":"transaction-1"}',
    };
    const gate = buildReleaseGate(stored, [], passedObservations());
    const check = gate.checks.find((item) => item.key === 'apple.weekly_purchase');
    expect(check).toMatchObject({ status: 'passed', evidence_valid: false, certified: false });
    expect(check?.missing_evidence).toEqual(['build', 'device', 'certification_observation']);
    expect(gate).toMatchObject({ ready: false, progress: { passed: RELEASE_GATE_CHECKS.length - 1 } });
  });

  it('does not accept a manually passed check without an immutable completed observation', () => {
    const gate = buildReleaseGate(passedChecks(), [], []);
    expect(gate.ready).toBe(false);
    expect(gate.checks.every((check) => !check.certified)).toBe(true);
    expect(gate.checks[0].missing_evidence).toContain('certification_observation');
  });

  it('rejects an observation whose stored snapshot no longer matches its digest', () => {
    const observations = passedObservations();
    observations[0] = { ...observations[0], digest_valid: false };
    const gate = buildReleaseGate(passedChecks(), [], observations);
    expect(gate.ready).toBe(false);
    expect(gate.progress.passed).toBe(RELEASE_GATE_CHECKS.length - 1);
    expect(gate.checks[0].missing_evidence).toContain('certification_observation');
  });

  it('restricts certification runs to the provider platform and test environment', () => {
    const apple = RELEASE_GATE_CHECKS.find((check) => check.key === 'apple.weekly_purchase')!;
    expect(certificationRunCompatibility(apple, 'ios', 'sandbox').valid).toBe(true);
    expect(certificationRunCompatibility(apple, 'android', 'sandbox')).toMatchObject({
      valid: false, expected_platform: 'ios', expected_environment: 'sandbox',
    });
    const inventory = RELEASE_GATE_CHECKS.find((check) => check.key === 'cross_platform.revenuecat_inventory')!;
    expect(certificationRunCompatibility(inventory, 'cross_platform', 'production').valid).toBe(true);
  });

  it('requires structured device evidence for native and FlutterFlow checks', () => {
    const native = RELEASE_GATE_CHECKS.find((check) => check.key === 'apple.weekly_purchase')!;
    expect(validateReleaseGateEvidence(native, { build: '104', device: 'iPhone 16 / iOS 19', reference: 'test-run-1' })).toEqual({ valid: true, missing: [] });
    expect(validateReleaseGateEvidence(native, { reference: 'test-run-1' })).toEqual({ valid: false, missing: ['build', 'device'] });
  });

  it('detects weekly and annual products from provider metadata without product ID assumptions', () => {
    const products: ReleaseGateCatalogProduct[] = [
      product('arbitrary-product-a', '{"subscription_period":"ONE_WEEK","provider_approved":true,"provider_available":true,"provider_purchasable":true}', 1, 'weekly'),
      product('arbitrary-product-b', '{"subscription_period":"ONE_YEAR","provider_approved":true,"provider_available":true,"provider_purchasable":true}', 1, 'annual'),
    ];
    expect(nativeCatalogCoverage(products, 'project-1', 'apple', 'production')).toEqual({
      catalog: true,
      premium: true,
      packages: true,
      approved: true,
      available: true,
      purchasable: true,
    });
  });

  it('fails closed when Apple products are not approved or territory availability is unknown', () => {
    const products: ReleaseGateCatalogProduct[] = [
      product('weekly-plan', '{"subscription_period":"ONE_WEEK","state":"READY_TO_SUBMIT","provider_approved":false,"provider_available":true,"provider_purchasable":false}', 1, 'weekly'),
      product('annual-plan', '{"subscription_period":"ONE_YEAR","state":"APPROVED","provider_approved":true,"provider_available":true,"provider_purchasable":false}', 1, 'annual'),
    ];
    expect(nativeCatalogCoverage(products, 'project-1', 'apple', 'production')).toMatchObject({
      catalog: true,
      approved: false,
      available: true,
      purchasable: false,
    });
  });

  it('requires active and regionally available Google base plans for both cadences', () => {
    const products: ReleaseGateCatalogProduct[] = [
      product('weekly-plan', '{"base_plans":[{"billing_period":"P1W","state":"ACTIVE","new_subscriber_available":true}],"provider_approved":true,"provider_available":true,"provider_purchasable":true}', 1, 'weekly', 'google'),
      product('annual-plan', '{"base_plans":[{"billing_period":"P1Y","state":"ACTIVE","new_subscriber_available":false}],"provider_approved":true,"provider_available":false,"provider_purchasable":false}', 1, 'annual', 'google'),
    ];
    expect(nativeCatalogCoverage(products, 'project-1', 'google', 'production')).toMatchObject({
      catalog: true,
      approved: true,
      available: false,
      purchasable: false,
    });
  });

  it('requires a recent successful provider catalog synchronization', () => {
    const now = Date.parse('2026-08-04T12:00:00.000Z');
    expect(catalogSyncFresh('2026-08-03T12:01:00.000Z', 24, now)).toBe(true);
    expect(catalogSyncFresh('2026-08-03T11:59:59.000Z', 24, now)).toBe(false);
    expect(catalogSyncFresh(null, 24, now)).toBe(false);
  });

  it('uses current package cadence only for legacy catalog rows without provider periods', () => {
    const products: ReleaseGateCatalogProduct[] = [
      product('weekly-plan', '{"base_plans":[{"base_plan_id":"basic"}]}', 1, 'weekly', 'google'),
      product('annual-plan', '{"base_plans":[{"base_plan_id":"plus"}]}', 0, 'annual', 'google'),
    ];
    expect(nativeCatalogCoverage(products, 'project-1', 'google', 'production')).toEqual({
      catalog: true,
      premium: false,
      packages: true,
      approved: false,
      available: false,
      purchasable: false,
    });
  });

  it('blocks publication unless financial execution and delivery pipelines are clean', () => {
    const prerequisites = billingOperationalPrerequisites({
      dedicated_execution: false,
      worker_ready: true,
      canonical_failed: 1,
      canonical_stale_pending: 0,
      provider_failed: 0,
      provider_stale_received: 2,
      entitlement_delivery_failed: 1,
      entitlement_delivery_stale_pending: 0,
      refund_action_failed: 0,
      refund_action_stale: 1,
      missed_refund_deadlines: 1,
    });
    expect(prerequisites.every((item) => item.passed === false)).toBe(true);
    expect(buildReleaseGate(passedChecks(), prerequisites, passedObservations()).ready).toBe(false);
  });

  it('accepts a ready private Billing Worker with no failed or stale financial work', () => {
    expect(billingOperationalPrerequisites({
      dedicated_execution: true,
      worker_ready: true,
      canonical_failed: 0,
      canonical_stale_pending: 0,
      provider_failed: 0,
      provider_stale_received: 0,
      entitlement_delivery_failed: 0,
      entitlement_delivery_stale_pending: 0,
      refund_action_failed: 0,
      refund_action_stale: 0,
      missed_refund_deadlines: 0,
    }).every((item) => item.passed)).toBe(true);
  });
});

function product(
  storeProductId: string,
  metadata: string,
  premiumMapped: number,
  packageTypes: string,
  store = 'apple',
): ReleaseGateCatalogProduct & { store_product_id: string } {
  return {
    project_id: 'project-1',
    store,
    environment: 'production',
    store_product_id: storeProductId,
    metadata,
    premium_mapped: premiumMapped,
    package_types: packageTypes,
  };
}
