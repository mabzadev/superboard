import { describe, expect, it } from 'vitest';
import { googlePurchaseEnvironment } from './store-verification';

describe('Google Play purchase environment', () => {
  it('recognizes subscription license tests only from the verified provider marker', () => {
    expect(googlePurchaseEnvironment({ testPurchase: {} }, 'subscription')).toBe('sandbox');
    expect(googlePurchaseEnvironment({}, 'subscription')).toBe('production');
  });

  it('recognizes one-time license tests from current and legacy provider markers', () => {
    expect(googlePurchaseEnvironment({ testPurchaseContext: { fopType: 'TEST' } }, 'non_consumable')).toBe('sandbox');
    expect(googlePurchaseEnvironment({ purchaseType: 0 }, 'consumable')).toBe('sandbox');
    expect(googlePurchaseEnvironment({ purchaseType: 1 }, 'non_consumable')).toBe('production');
  });
});
