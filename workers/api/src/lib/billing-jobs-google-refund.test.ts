import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1 } from '../test/fake-d1';

const refundMocks = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('./refunds', async (importOriginal) => ({
  ...await importOriginal<typeof import('./refunds')>(),
  recordGooglePendingRefundReview: refundMocks.record,
}));

import { processGooglePendingRefundReview } from './billing-jobs';

afterEach(() => refundMocks.record.mockReset());

describe('Google pending refund review processing', () => {
  it('loads the durable provider payload, records the case, and completes the event', async () => {
    const writes: string[] = [];
    const payload = {
      pendingRefundReviewNotification: {
        pendingRefundToken: 'pending-token',
        orderId: 'GPA.1',
      },
    };
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('SELECT payload FROM billing_webhook_events')) {
        return { payload: JSON.stringify(payload) };
      }
      if (call.op === 'run') {
        writes.push(call.sql);
        return true;
      }
      return undefined;
    });
    refundMocks.record.mockResolvedValue({ caseId: 'case-1', status: 'evidence_required' });

    await expect(processGooglePendingRefundReview({ DB: db } as BillingEnv, {
      eventId: 'event-1',
      projectId: '11',
      environment: 'production',
      eventOccurredAt: '2026-08-04T08:00:00.000Z',
    })).resolves.toEqual({ processed: true, refund_case_id: 'case-1' });

    expect(refundMocks.record).toHaveBeenCalledWith(expect.anything(), {
      projectId: '11',
      environment: 'production',
      eventOccurredAt: '2026-08-04T08:00:00.000Z',
      payload,
    });
    expect(writes.some((sql) => sql.includes("event_type = 'PENDING_REFUND_REVIEW_CHARGEBACK'"))).toBe(true);
  });
});
