import type { BillingStatus } from './billing';

export function entitlementIsActive(status: string, expiresAt?: string | null, now = Date.now()): boolean {
  if (['revoked', 'refunded', 'expired', 'pending', 'paused', 'inactive'].includes(status)) return false;
  if (expiresAt && Date.parse(expiresAt) <= now) return false;
  return ['trialing', 'active', 'grace_period', 'billing_issue', 'cancelled'].includes(status);
}

export function shouldApplySubscriptionEvent(currentEventAt: string | null, incomingEventAt: string): boolean {
  if (!currentEventAt) return true;
  const current = Date.parse(currentEventAt);
  const incoming = Date.parse(incomingEventAt);
  if (!Number.isFinite(incoming)) return false;
  if (!Number.isFinite(current)) return true;
  return incoming >= current;
}

export function accessEndsImmediately(status: BillingStatus): boolean {
  return status === 'refunded' || status === 'revoked' || status === 'expired';
}
