import { describe, expect, it } from 'vitest';
import { accessEndsImmediately, entitlementIsActive, shouldApplySubscriptionEvent } from './billing-state';

describe('billing subscription state rules', () => {
  const future = '2030-01-01T00:00:00.000Z';
  const past = '2020-01-01T00:00:00.000Z';
  const now = Date.parse('2026-01-01T00:00:00.000Z');

  it.each([
    ['trialing', true],
    ['active', true],
    ['grace_period', true],
    ['billing_issue', true],
    ['cancelled', true],
    ['pending', false],
    ['paused', false],
    ['expired', false],
    ['revoked', false],
    ['refunded', false],
  ])('maps %s entitlement access', (status, expected) => {
    expect(entitlementIsActive(status, future, now)).toBe(expected);
  });

  it('keeps a cancellation active only until its paid expiration', () => {
    expect(entitlementIsActive('cancelled', future, now)).toBe(true);
    expect(entitlementIsActive('cancelled', past, now)).toBe(false);
  });

  it('rejects delayed and out-of-order events while accepting an idempotent replay', () => {
    const current = '2026-01-10T10:00:00.000Z';
    expect(shouldApplySubscriptionEvent(current, '2026-01-09T10:00:00.000Z')).toBe(false);
    expect(shouldApplySubscriptionEvent(current, current)).toBe(true);
    expect(shouldApplySubscriptionEvent(current, '2026-01-11T10:00:00.000Z')).toBe(true);
  });

  it('removes access immediately on refund or revocation', () => {
    expect(accessEndsImmediately('refunded')).toBe(true);
    expect(accessEndsImmediately('revoked')).toBe(true);
    expect(accessEndsImmediately('cancelled')).toBe(false);
  });
});
