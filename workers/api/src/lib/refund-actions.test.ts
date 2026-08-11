import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import {
  executeRefundProviderAction,
  googleRefundReviewUrl,
  refundActionDefinitions,
  refundCaseAllowsOperatorAction,
  supportedRefundActions,
  validateRefundActionPayload,
} from './refund-actions';

afterEach(() => vi.unstubAllGlobals());

describe('refund provider actions', () => {
  it('treats provider-terminal refund cases as immutable', async () => {
    expect(refundCaseAllowsOperatorAction('open')).toBe(true);
    expect(refundCaseAllowsOperatorAction('submitted')).toBe(true);
    expect(refundCaseAllowsOperatorAction('won')).toBe(false);
    expect(refundCaseAllowsOperatorAction('lost')).toBe(false);
    expect(refundCaseAllowsOperatorAction('closed')).toBe(false);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_refund_provider_actions action')) {
        return actionRow({ status: 'approved', refund_status: 'lost' });
      }
      return undefined;
    });

    await expect(executeRefundProviderAction({ DB: db } as BillingEnv, 'action-1'))
      .rejects.toThrow(/terminal refund case/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.calls.some((call) => call.op === 'run')).toBe(false);
  });

  it('requires explicit Apple consent and validates delivery consistency', () => {
    expect(() => validateRefundActionPayload('apple', 'submit_consumption_info', {
      customerConsented: false,
      deliveryStatus: 'DELIVERED',
      sampleContentProvided: false,
    })).toThrow(/consent/i);
    expect(() => validateRefundActionPayload('apple', 'submit_consumption_info', {
      customerConsented: true,
      deliveryStatus: 'UNDELIVERED_OTHER',
      sampleContentProvided: false,
      consumptionPercentage: 1,
    })).toThrow(/zero/i);
    expect(validateRefundActionPayload('apple', 'submit_consumption_info', {
      customerConsented: true,
      deliveryStatus: 'DELIVERED',
      sampleContentProvided: true,
      consumptionPercentage: 25_000,
      refundPreference: 'GRANT_PRORATED',
    })).toMatchObject({ customerConsented: true, consumptionPercentage: 25_000 });
  });

  it('restricts every provider to an explicit action and payload allowlist', () => {
    expect(supportedRefundActions('google')).toEqual(['review_google_refund', 'refund_google_order', 'revoke_google_subscription']);
    expect(refundActionDefinitions('apple')).toEqual([expect.objectContaining({
      action_type: 'submit_consumption_info',
      recommended_evidence_type: 'apple_consumption_consent',
    })]);
    expect(() => validateRefundActionPayload('google', 'create_external_refund', {})).toThrow(/not supported/i);
    expect(supportedRefundActions('external')).toEqual([]);
    expect(validateRefundActionPayload('google', 'revoke_google_subscription', {
      refund_type: 'item', product_id: 'addon',
    })).toEqual({ refund_type: 'item', product_id: 'addon' });
    expect(validateRefundActionPayload('google', 'review_google_refund', {
      pendingRefundToken: 'pending-token',
      sampleContentProvided: true,
      refundPreference: 'DECLINE',
      consumptionPercentageMilliunits: 45_200,
      consumptionUsageEvents: [{
        consumptionTime: '2026-08-04T10:30:00+02:00',
        ipAddress: '192.0.2.10',
        consumptionItemDescription: 'Premium content opened',
        location: { regionCode: 'ch', locality: 'Zurich' },
      }],
    })).toMatchObject({
      pendingRefundToken: 'pending-token',
      refundPreference: 'DECLINE',
      consumptionPercentageMilliunits: 45_200,
      consumptionUsageEvents: [{
        consumptionTime: '2026-08-04T08:30:00.000Z',
        location: { regionCode: 'CH', locality: 'Zurich' },
      }],
    });
    expect(() => validateRefundActionPayload('google', 'review_google_refund', {
      pendingRefundToken: 'pending-token',
      sampleContentProvided: false,
      refundPreference: 'DECLINE',
      consumptionUsageEvents: [{ location: { locality: 'Zurich' } }],
    })).toThrow(/regionCode/i);
    expect(googleRefundReviewUrl('com.example app', 'GPA.1/2')).toBe(
      'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example%20app/orders/GPA.1%2F2:reviewrefund',
    );
  });

  it('never executes a provider request before human approval', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_refund_provider_actions action')) {
        return actionRow({ status: 'draft' });
      }
      return undefined;
    });

    await expect(executeRefundProviderAction({ DB: db } as BillingEnv, 'action-1')).rejects.toThrow(/human approval/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not execute a provider request when another worker holds the action lease', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_refund_provider_actions action')) {
        return actionRow({ status: 'queued' });
      }
      if (call.op === 'run' && call.sql.includes('claim_expires_at')) {
        return { success: true, meta: { changes: 0 } };
      }
      return undefined;
    });

    await expect(executeRefundProviderAction({ DB: db } as BillingEnv, 'action-1'))
      .resolves.toEqual({ sent: false, claimed: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not contact the provider when the case becomes terminal after the lease claim', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    let actionReads = 0;
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_refund_provider_actions action')) {
        actionReads += 1;
        return actionReads === 1 ? actionRow({ status: 'approved' }) : null;
      }
      if (call.op === 'run' && call.sql.includes('attempts = attempts + 1')) return true;
      return undefined;
    });

    await expect(executeRefundProviderAction({ DB: db } as BillingEnv, 'action-1'))
      .resolves.toEqual({ sent: false, cancelled: true, provider: 'google' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

});

function actionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'action-1',
    case_id: 'case-1',
    action_type: 'refund_google_order',
    payload: JSON.stringify({ revoke: true }),
    status: 'approved',
    idempotency_key: 'refund:case-1:submit',
    attempts: 0,
    project_id: '11',
    provider: 'google',
    environment: 'sandbox',
    provider_case_id: 'GPA.test',
    provider_payload: '{}',
    refund_status: 'open',
    store_transaction_id: null,
    original_transaction_id: null,
    order_id: 'GPA.test',
    purchase_token: null,
    store_product_id: 'vocostar_weekly_999',
    product_type: 'subscription',
    ...overrides,
  };
}
