import { describe, expect, it } from 'vitest';
import { isBillingQueueJob } from './billing-dispatch';

describe('billing queue routing', () => {
  it('recognizes financial jobs and excludes unrelated queues', () => {
    expect(isBillingQueueJob({ type: 'billing.stripe.notification', eventId: 'event', connectionId: 'connection' })).toBe(true);
    expect(isBillingQueueJob({ type: 'billing.unknown' })).toBe(false);
    expect(isBillingQueueJob({ type: 'reputation.reviews.sync' })).toBe(false);
    expect(isBillingQueueJob(null)).toBe(false);
  });
});
