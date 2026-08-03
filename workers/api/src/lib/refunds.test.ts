import { describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import type { VerifiedPurchase } from './billing';
import { recordRefundCaseForPurchase } from './refunds';

function purchase(overrides: Partial<VerifiedPurchase> = {}): VerifiedPurchase {
  return {
    projectId: 'project-1',
    customerId: 'customer-1',
    store: 'apple',
    environment: 'production',
    storeProductId: 'vocostar_weekly_999',
    productType: 'subscription',
    storeTransactionId: 'transaction-provider-1',
    originalTransactionId: 'original-1',
    eventType: 'REFUND',
    status: 'refunded',
    rawPayload: { notificationUUID: 'notification-1' },
    ...overrides,
  };
}

describe('Refund Center projection', () => {
  it('creates a lost refund case and immutable provider audit event', async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = createFakeD1((call) => {
      if (call.op === 'run') {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      if (call.sql.startsWith('SELECT id FROM billing_refund_cases')) return { id: 'refund-case-1' };
      return undefined;
    });
    const result = await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase(),
      'transaction-1',
    );

    expect(result).toEqual({ caseId: 'refund-case-1', status: 'lost' });
    expect(writes.some((write) => write.sql.startsWith('INSERT INTO billing_refund_cases'))).toBe(true);
    expect(writes.some((write) => write.sql.startsWith('INSERT OR IGNORE INTO billing_refund_audit_events'))).toBe(true);
  });

  it('ignores normal renewal events', async () => {
    const db = createFakeD1(() => undefined);
    await expect(recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase({ eventType: 'DID_RENEW', status: 'active' }),
      'transaction-1',
    )).resolves.toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('prepares Apple consumption information for human approval', async () => {
    const writes: string[] = [];
    const db = createFakeD1((call) => {
      if (call.op === 'run') {
        writes.push(call.sql);
        return true;
      }
      if (call.sql.startsWith('SELECT id FROM billing_refund_cases')) return { id: 'refund-case-2' };
      return undefined;
    });
    const result = await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase({ eventType: 'CONSUMPTION_REQUEST', status: 'active' }),
      'transaction-2',
    );
    expect(result?.status).toBe('evidence_required');
    expect(writes.some((sql) => sql.startsWith('INSERT OR IGNORE INTO billing_refund_provider_actions'))).toBe(true);
  });
});
