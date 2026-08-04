import { describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import type { VerifiedPurchase } from './billing';
import { recordRefundCaseForPurchase, refundProjectionVersion } from './refunds';

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
  it('orders projections by provider time and terminal-event priority', () => {
    const eventOccurredAt = '2026-08-04T00:00:00.000Z';
    const evidenceRequest = refundProjectionVersion(purchase({
      eventType: 'CONSUMPTION_REQUEST',
      status: 'active',
      eventOccurredAt,
    }));
    const refund = refundProjectionVersion(purchase({
      eventType: 'REFUND',
      status: 'refunded',
      eventOccurredAt,
    }));
    const reversal = refundProjectionVersion(purchase({
      eventType: 'REFUND_REVERSED',
      status: 'active',
      eventOccurredAt,
    }));

    expect(refund > evidenceRequest).toBe(true);
    expect(reversal > refund).toBe(true);
    expect(refundProjectionVersion(purchase({
      eventType: 'CONSUMPTION_REQUEST',
      status: 'active',
      eventOccurredAt: '2026-08-04T00:00:01.000Z',
    })) > reversal).toBe(true);
  });

  it('creates a lost refund case and immutable provider audit event', async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = createFakeD1((call) => {
      if (call.op === 'run') {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      if (call.sql.startsWith('SELECT id, status, projection_version FROM billing_refund_cases')) return { id: 'refund-case-1' };
      return undefined;
    });
    const result = await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase(),
      'transaction-1',
    );

    expect(result).toEqual({ caseId: 'refund-case-1', status: 'lost' });
    const insert = writes.find((write) => write.sql.startsWith('INSERT INTO billing_refund_cases'));
    expect(insert?.args[6]).toBe('original-1');
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
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = createFakeD1((call) => {
      if (call.op === 'run') {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      if (call.sql.startsWith('SELECT id, status, projection_version FROM billing_refund_cases')) return { id: 'refund-case-2' };
      return undefined;
    });
    const result = await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase({ eventType: 'CONSUMPTION_REQUEST', status: 'active' }),
      'transaction-2',
    );
    expect(result?.status).toBe('evidence_required');
    expect(writes.some(({ sql }) => sql.startsWith('INSERT OR IGNORE INTO billing_refund_provider_actions'))).toBe(true);
    const deadline = writes.find(({ sql }) => sql.startsWith('INSERT INTO billing_refund_cases'))?.args[12];
    expect(Date.parse(String(deadline))).toBeGreaterThan(Date.now() + 11 * 60 * 60_000);
  });

  it('prepares Stripe dispute evidence but never submits it automatically', async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = createFakeD1((call) => {
      if (call.op === 'run') {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      if (call.sql.startsWith('SELECT id, status, projection_version FROM billing_refund_cases')) return { id: 'refund-case-stripe' };
      return undefined;
    });
    await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase({
        store: 'stripe',
        eventType: 'dispute.needs_response',
        status: 'active',
        rawPayload: { data: { object: { id: 'dp_123', evidence_details: { due_by: Math.floor(Date.now() / 1000) + 3600 } } } },
      }),
      'transaction-stripe',
    );
    const action = writes.find(({ sql }) => sql.startsWith('INSERT OR IGNORE INTO billing_refund_provider_actions'));
    expect(action?.sql).toContain("'submit_stripe_dispute_evidence'");
    expect(action?.sql).toContain("'draft'");
  });

  it('does not reopen a terminal case from an older provider event', async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const terminalPurchase = purchase({
      eventType: 'REFUND',
      status: 'refunded',
      eventOccurredAt: '2026-08-04T00:00:02.000Z',
    });
    const db = createFakeD1((call) => {
      if (call.op === 'run') {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      if (call.sql.startsWith('SELECT id, status, projection_version FROM billing_refund_cases')) {
        return {
          id: 'refund-case-terminal',
          status: 'lost',
          projection_version: refundProjectionVersion(terminalPurchase),
        };
      }
      return undefined;
    });

    const result = await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase({
        eventType: 'CONSUMPTION_REQUEST',
        status: 'active',
        eventOccurredAt: '2026-08-04T00:00:01.000Z',
      }),
      'transaction-stale',
    );

    expect(result).toEqual({ caseId: 'refund-case-terminal', status: 'lost' });
    expect(writes.some(({ sql }) => sql.startsWith('INSERT INTO billing_refund_deadlines'))).toBe(false);
    expect(writes.some(({ sql }) => sql.startsWith('INSERT OR IGNORE INTO billing_refund_provider_actions'))).toBe(false);
    expect(writes.some(({ sql }) => sql.startsWith('INSERT OR IGNORE INTO billing_refund_audit_events'))).toBe(true);
  });

  it('closes open deadlines and unsent actions after a terminal provider outcome', async () => {
    const writes: string[] = [];
    const terminalPurchase = purchase({
      eventType: 'REFUND_REVERSED',
      status: 'active',
      eventOccurredAt: '2026-08-04T00:00:02.000Z',
    });
    const db = createFakeD1((call) => {
      if (call.op === 'run') {
        writes.push(call.sql);
        return true;
      }
      if (call.sql.startsWith('SELECT id, status, projection_version FROM billing_refund_cases')) {
        return {
          id: 'refund-case-won',
          status: 'won',
          projection_version: refundProjectionVersion(terminalPurchase),
        };
      }
      return undefined;
    }) as D1Database & { batch: (statements: D1PreparedStatement[]) => Promise<unknown> };
    db.batch = async (statements) => Promise.all(statements.map((statement) => statement.run()));

    await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      terminalPurchase,
      'transaction-terminal',
    );

    expect(writes.some((sql) => sql.startsWith('UPDATE billing_refund_deadlines'))).toBe(true);
    expect(writes.some((sql) => sql.startsWith('UPDATE billing_refund_provider_actions'))).toBe(true);
  });
});
