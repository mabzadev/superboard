import { describe, expect, it } from 'vitest';
import { buildReleaseGate, RELEASE_GATE_CHECKS } from './purchases-release-gate';

describe('Purchases release gate', () => {
  it('stays closed until every provider scenario and prerequisite has evidence', () => {
    const stored = RELEASE_GATE_CHECKS.map((check) => ({ check_key: check.key, status: 'passed', evidence_json: '{"test_run":"run-1"}' }));
    expect(buildReleaseGate(stored, [{ key: 'stores', label: 'Stores', passed: false, detail: 'Connect every store.' }]))
      .toMatchObject({ ready: false, publication_allowed: false, legacy_dependency_removal_allowed: false });
  });

  it('opens only when all required evidence and prerequisites pass', () => {
    const stored = RELEASE_GATE_CHECKS.map((check) => ({ check_key: check.key, status: 'passed', evidence_json: '{"test_run":"run-1"}' }));
    const gate = buildReleaseGate(stored, [{ key: 'stores', label: 'Stores', passed: true, detail: 'All stores connected.' }]);
    expect(gate.ready).toBe(true);
    expect(gate.progress).toEqual({ passed: RELEASE_GATE_CHECKS.length, total: RELEASE_GATE_CHECKS.length });
  });
});
