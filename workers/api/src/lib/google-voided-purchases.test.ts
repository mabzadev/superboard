import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import { googleVoidedPurchasesUrl, reconcileGoogleVoidedPurchases } from './google-voided-purchases';

const providerMocks = vi.hoisted(() => ({
  access: vi.fn(),
  apply: vi.fn(),
}));

vi.mock('./store-verification', () => ({ googlePlayAccess: providerMocks.access }));
vi.mock('./billing', async (loadOriginal) => ({
  ...await loadOriginal<typeof import('./billing')>(),
  applyVerifiedPurchase: providerMocks.apply,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  providerMocks.access.mockReset();
  providerMocks.apply.mockReset();
});

describe('Google Voided Purchases reconciliation', () => {
  it('builds a bounded request for subscriptions, partial refunds, and token pagination', () => {
    const first = new URL(googleVoidedPurchasesUrl('com.example.app', { startTime: 1000, endTime: 2000 }));
    expect(first.searchParams.get('type')).toBe('1');
    expect(first.searchParams.get('includeQuantityBasedPartialRefund')).toBe('true');
    expect(first.searchParams.get('pageSelection.maxResults')).toBe('1000');
    expect(first.searchParams.get('startTime')).toBe('1000');
    expect(first.searchParams.get('endTime')).toBe('2000');

    const next = new URL(googleVoidedPurchasesUrl('com.example.app', { startTime: 1000, endTime: 2000 }, 'page-2'));
    expect(next.searchParams.get('pageSelection.token')).toBe('page-2');
    expect(next.searchParams.has('startTime')).toBe(false);
    expect(next.searchParams.has('endTime')).toBe(false);
  });

  it('paginates verified provider results and applies matched voids through the canonical purchase pipeline', async () => {
    providerMocks.access.mockResolvedValue({ token: 'google-token', packageName: 'com.example.app' });
    providerMocks.apply.mockResolvedValue({ transactionId: 'refund-transaction', duplicate: false });
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      return Response.json(url.searchParams.get('pageSelection.token')
        ? { voidedPurchases: [voided('GPA.2', 1_800_000_100_000)] }
        : {
            voidedPurchases: [voided('GPA.1', 1_800_000_000_000)],
            tokenPagination: { nextPageToken: 'page-2' },
          });
    }));
    const db = reconciliationDatabase(() => matchedTransaction());
    const now = Date.now() - 1_000;

    const result = await reconcileGoogleVoidedPurchases({ DB: db } as BillingEnv, '11', now);

    expect(result).toMatchObject({ claimed: true, scanned: 2, processed: 2, unmatched: 0, end_time: now });
    expect(requested).toHaveLength(2);
    expect(new URL(requested[1]).searchParams.get('pageSelection.token')).toBe('page-2');
    expect(providerMocks.apply).toHaveBeenCalledTimes(2);
    expect(providerMocks.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: '11',
      store: 'google',
      environment: 'production',
      eventType: 'VOIDED_PURCHASE',
      status: 'refunded',
      autoRenews: false,
    }));
  });

  it('never changes an entitlement when the verified provider event cannot match a local transaction', async () => {
    providerMocks.access.mockResolvedValue({ token: 'google-token', packageName: 'com.example.app' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      voidedPurchases: [voided('GPA.unmatched', 1_800_000_000_000)],
    })));
    const failedWrites: unknown[][] = [];
    const db = reconciliationDatabase(() => null, (sql, args) => {
      if (sql.includes("error_code = 'transaction_not_found'")) failedWrites.push(args);
    });

    const result = await reconcileGoogleVoidedPurchases({ DB: db } as BillingEnv, '11', Date.now() - 1_000);

    expect(result).toMatchObject({ claimed: true, scanned: 1, processed: 0, unmatched: 1 });
    expect(providerMocks.apply).not.toHaveBeenCalled();
    expect(failedWrites).toHaveLength(1);
  });
});

function reconciliationDatabase(
  transaction: () => Record<string, unknown> | null,
  onRun: (sql: string, args: unknown[]) => void = () => undefined,
) {
  return createFakeD1((call) => {
    if (call.op === 'first' && call.sql.includes('SELECT watermark_ms')) return { watermark_ms: null };
    if (call.op === 'first' && call.sql.includes('FROM billing_transactions t')) return transaction();
    if (call.op === 'all' && call.sql.includes("event_type = 'voided_purchase_detected'")) return [];
    if (call.op === 'run') {
      onRun(call.sql, call.args);
      return { success: true, meta: { changes: 1 } };
    }
    return undefined;
  });
}

function matchedTransaction() {
  return {
    project_id: '11',
    application_id: 'android-app',
    customer_id: 'customer-1',
    store_transaction_id: 'provider-transaction-1',
    original_transaction_id: 'provider-original-1',
    order_id: 'GPA.1',
    purchase_token: 'purchase-token',
    purchased_at: '2026-08-01T00:00:00.000Z',
    store_product_id: 'weekly_product',
    product_type: 'subscription',
  };
}

function voided(orderId: string, voidedTimeMillis: number) {
  return {
    orderId,
    purchaseToken: `token-${orderId}`,
    purchaseTimeMillis: String(voidedTimeMillis - 10_000),
    voidedTimeMillis: String(voidedTimeMillis),
    voidedSource: 0,
    voidedReason: 7,
    voidedQuantity: 1,
  };
}
