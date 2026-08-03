import { describe, expect, it } from 'vitest';
import {
  buildReleaseGate,
  nativeCatalogCoverage,
  RELEASE_GATE_CHECKS,
  validateReleaseGateEvidence,
  type ReleaseGateCatalogProduct,
} from './purchases-release-gate';

function passedChecks() {
  return RELEASE_GATE_CHECKS.map((check) => ({
    check_key: check.key,
    status: 'passed',
    evidence_json: JSON.stringify(Object.fromEntries(check.required_evidence.map((field) => [field, `${field}-evidence`]))),
  }));
}

describe('Purchases release gate', () => {
  it('stays closed until every provider scenario and prerequisite has evidence', () => {
    expect(buildReleaseGate(passedChecks(), [{ key: 'stores', label: 'Stores', passed: false, detail: 'Connect every store.' }]))
      .toMatchObject({ ready: false, publication_allowed: false, legacy_dependency_removal_allowed: false });
  });

  it('opens only when all required evidence and prerequisites pass', () => {
    const gate = buildReleaseGate(passedChecks(), [{ key: 'stores', label: 'Stores', passed: true, detail: 'All stores connected.' }]);
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
    const gate = buildReleaseGate(stored, []);
    const check = gate.checks.find((item) => item.key === 'apple.weekly_purchase');
    expect(check).toMatchObject({ status: 'passed', evidence_valid: false, certified: false });
    expect(check?.missing_evidence).toEqual(['build', 'device']);
    expect(gate).toMatchObject({ ready: false, progress: { passed: RELEASE_GATE_CHECKS.length - 1 } });
  });

  it('requires structured device evidence for native and FlutterFlow checks', () => {
    const native = RELEASE_GATE_CHECKS.find((check) => check.key === 'apple.weekly_purchase')!;
    expect(validateReleaseGateEvidence(native, { build: '104', device: 'iPhone 16 / iOS 19', reference: 'test-run-1' })).toEqual({ valid: true, missing: [] });
    expect(validateReleaseGateEvidence(native, { reference: 'test-run-1' })).toEqual({ valid: false, missing: ['build', 'device'] });
  });

  it('detects weekly and annual products from provider metadata without product ID assumptions', () => {
    const products: ReleaseGateCatalogProduct[] = [
      product('arbitrary-product-a', '{"subscription_period":"ONE_WEEK"}', 1, 'weekly'),
      product('arbitrary-product-b', '{"subscription_period":"ONE_YEAR"}', 1, 'annual'),
    ];
    expect(nativeCatalogCoverage(products, 'project-1', 'apple', 'production')).toEqual({
      catalog: true,
      premium: true,
      packages: true,
    });
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
    });
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
