import { describe, expect, it } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import { reconcileRefundDeadlines } from './billing-jobs';

describe('billing refund deadline reconciliation', () => {
  it('marks overdue non-terminal deadlines once and appends immutable audit events', async () => {
    const writes: string[] = [];
    const db = createFakeD1((call) => {
      if (call.op === 'all' && call.sql.includes('FROM billing_refund_deadlines deadline')) {
        return [{
          id: 'deadline-1',
          case_id: 'case-1',
          deadline_type: 'provider_response',
          due_at: '2026-08-04T00:00:00.000Z',
        }];
      }
      if (call.op === 'run') {
        writes.push(call.sql);
        return true;
      }
      return undefined;
    });

    await expect(reconcileRefundDeadlines({ DB: db } as BillingEnv)).resolves.toBe(1);
    expect(writes.some((sql) => sql.includes("SET status = 'missed'"))).toBe(true);
    expect(writes.some((sql) => sql.includes("'deadline.missed', 'system'"))).toBe(true);
    expect(db.calls.find((call) => call.sql.includes("'deadline.missed', 'system'"))?.args[0])
      .toBe('refund-deadline:deadline-1:missed');
  });

  it('does no writes when there are no overdue active deadlines', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'all' && call.sql.includes('FROM billing_refund_deadlines deadline')) return [];
      return undefined;
    });

    await expect(reconcileRefundDeadlines({ DB: db } as BillingEnv)).resolves.toBe(0);
    expect(db.calls).toHaveLength(1);
  });
});
