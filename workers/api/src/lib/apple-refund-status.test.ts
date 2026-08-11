import { describe, expect, it } from 'vitest';
import { appleStatus } from './store-verification';

describe('Apple refund entitlement status', () => {
  const future = Date.now() + 7 * 24 * 60 * 60 * 1000;

  it('revokes only an accepted refund or revocation', () => {
    expect(appleStatus({ expiresDate: future } as never, 'REFUND')).toBe('refunded');
    expect(appleStatus({ expiresDate: future } as never, 'REVOKE')).toBe('revoked');
  });

  it('reinstates a reversed refund even when the signed transaction retains a revocation date', () => {
    expect(appleStatus({
      expiresDate: future,
      revocationDate: Date.now() - 60_000,
    } as never, 'REFUND_REVERSED')).toBe('active');
  });

  it('keeps access after a declined refund request but respects expiration', () => {
    expect(appleStatus({ expiresDate: future } as never, 'REFUND_DECLINED')).toBe('active');
    expect(appleStatus({
      expiresDate: Date.now() - 60_000,
    } as never, 'REFUND_REVERSED')).toBe('expired');
  });
});
