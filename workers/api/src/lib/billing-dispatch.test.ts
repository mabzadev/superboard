import { describe, expect, it } from 'vitest';
import { isBillingQueueJob } from './billing-dispatch';

describe('billing queue routing', () => {
  it('recognizes financial jobs and excludes unrelated queues', () => {
    expect(isBillingQueueJob({ type: 'billing.stripe.notification', eventId: 'event', connectionId: 'connection' })).toBe(true);
    expect(isBillingQueueJob({ type: 'billing.stripe.catalog.reconcile', projectId: '11', environment: 'sandbox' })).toBe(true);
    expect(isBillingQueueJob({ type: 'billing.refund.action.execute', actionId: 'action' })).toBe(true);
    expect(isBillingQueueJob({ type: 'billing.google.voided.reconcile', projectId: '11' })).toBe(true);
    expect(isBillingQueueJob({ type: 'billing.legacy.inventory.page', runId: 'run-1' })).toBe(true);
    expect(isBillingQueueJob({ type: 'billing.unknown' })).toBe(false);
    expect(isBillingQueueJob({ type: 'reputation.reviews.sync' })).toBe(false);
    expect(isBillingQueueJob(null)).toBe(false);
  });
});
