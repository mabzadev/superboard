import { describe, expect, it } from 'vitest';
import { normalizeBillingEventType, targetingMatches } from './purchases-v2';

describe('Purchases v2 targeting', () => {
  it('matches country, platform, semantic versions and attributes', () => {
    expect(targetingMatches([
      { field: 'country', operator: 'in', value: ['CH', 'FR'] },
      { field: 'platform', operator: 'equals', value: 'ios' },
      { field: 'app_version', operator: 'gte', value: '2.3.0' },
      { field: 'attribute.plan', operator: 'equals', value: 'creator' },
    ], {
      country: 'CH',
      platform: 'ios',
      appVersion: '2.10.1',
      attributes: { plan: 'creator' },
    })).toBe(true);
  });

  it('requires every condition and supports missing values', () => {
    expect(targetingMatches([
      { field: 'country', operator: 'equals', value: 'CH' },
      { field: 'attribute.vip', operator: 'exists' },
    ], { country: 'CH', attributes: {} })).toBe(false);
    expect(targetingMatches([
      { field: 'attribute.vip', operator: 'not_exists' },
    ], { attributes: {} })).toBe(true);
  });
});

describe('Purchases v2 event normalization', () => {
  it.each([
    ['DID_RENEW', 'active', 'normal', 'renewal'],
    ['DID_FAIL_TO_RENEW', 'billing_issue', 'normal', 'billing_issue'],
    ['REFUND', 'refunded', 'normal', 'refunded'],
    ['DID_CHANGE_RENEWAL_STATUS', 'cancelled', 'normal', 'cancelled'],
    ['PURCHASED', 'trialing', 'trial', 'trial_started'],
    ['PURCHASED', 'active', 'normal', 'initial_purchase'],
  ] as const)('normalizes %s to %s', (event, status, period, expected) => {
    expect(normalizeBillingEventType(event, status, period)).toBe(expected);
  });
});
