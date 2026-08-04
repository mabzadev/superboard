import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1, type FakeD1Call } from '../test/fake-d1';
import { encryptSecret } from './secrets';
import {
  executeRefundProviderAction,
  refundActionDefinitions,
  supportedRefundActions,
  validateRefundActionPayload,
} from './refund-actions';

afterEach(() => vi.unstubAllGlobals());

describe('refund provider actions', () => {
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
    expect(supportedRefundActions('google')).toEqual(['refund_google_order', 'revoke_google_subscription']);
    expect(refundActionDefinitions('apple')).toEqual([expect.objectContaining({
      action_type: 'submit_consumption_info',
      recommended_evidence_type: 'apple_consumption_consent',
    })]);
    expect(() => validateRefundActionPayload('google', 'create_stripe_refund', {})).toThrow(/not supported/i);
    expect(() => validateRefundActionPayload('stripe', 'submit_stripe_dispute_evidence', {
      evidence: { arbitrary_secret_field: 'no' },
    })).toThrow(/not allowed/i);
    expect(() => validateRefundActionPayload('stripe', 'submit_stripe_dispute_evidence', {
      evidence: {
        access_activity_log: 'x'.repeat(20_000),
        billing_address: 'x'.repeat(20_000),
        cancellation_rebuttal: 'x'.repeat(20_000),
        customer_communication: 'x'.repeat(20_000),
        product_description: 'x'.repeat(20_000),
        refund_policy_disclosure: 'x'.repeat(20_000),
        service_date: 'x'.repeat(20_000),
        uncategorized_text: 'x'.repeat(20_000),
      },
    })).toThrow(/combined/i);
    expect(validateRefundActionPayload('google', 'revoke_google_subscription', {
      refund_type: 'item', product_id: 'addon',
    })).toEqual({ refund_type: 'item', product_id: 'addon' });
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

  it('submits approved Stripe evidence once and stores a sanitized response', async () => {
    const encryptionKey = 'refund-action-test-key';
    const encrypted = await encryptSecret(JSON.stringify({ secret_key: 'sk_test_refund_action' }), encryptionKey);
    const writes: string[] = [];
    const db = createFakeD1((call: FakeD1Call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_refund_provider_actions action')) {
        return actionRow({ status: 'approved' });
      }
      if (call.op === 'run' && call.sql.startsWith('UPDATE billing_refund_provider_actions') && call.sql.includes('attempts = attempts + 1')) return true;
      if (call.op === 'first' && call.sql.includes('FROM billing_store_connections')) return { configuration_encrypted: encrypted };
      if (call.op === 'all' && call.sql.includes('FROM billing_refund_evidence')) {
        return [{ evidence_type: 'access_activity_log', content: 'Customer used the service on 2026-08-01.' }];
      }
      if (call.op === 'run') {
        writes.push(call.sql);
        return true;
      }
      return undefined;
    }) as D1Database & { batch: (statements: D1PreparedStatement[]) => Promise<unknown> };
    db.batch = async (statements) => Promise.all(statements.map((statement) => statement.run()));
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      expect(String(init.body)).toContain('evidence%5Baccess_activity_log%5D=Customer+used+the+service');
      expect(String(init.body)).toContain('submit=true');
      return new Response(JSON.stringify({
        id: 'dp_test', status: 'under_review', evidence_details: { has_evidence: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await executeRefundProviderAction({
      DB: db,
      STORE_CREDENTIALS_ENCRYPTION_KEY: encryptionKey,
    } as BillingEnv, 'action-1');

    expect(result).toMatchObject({ sent: true, provider: 'stripe' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(writes.some((sql) => sql.includes("SET status = 'sent'"))).toBe(true);
    expect(writes.some((sql) => sql.startsWith('INSERT INTO billing_refund_audit_events'))).toBe(true);
  });

  it('does not reopen a case when a terminal event cancels an in-flight provider action', async () => {
    const encryptionKey = 'refund-cancellation-test-key';
    const encrypted = await encryptSecret(JSON.stringify({ secret_key: 'sk_test_refund_action' }), encryptionKey);
    const writes: string[] = [];
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_refund_provider_actions action')) {
        return actionRow({
          action_type: 'create_stripe_refund',
          payload: JSON.stringify({ reason: 'fraudulent' }),
          provider_payload: JSON.stringify({ data: { object: { payment_intent: 'pi_test' } } }),
        });
      }
      if (call.op === 'first' && call.sql.includes('FROM billing_store_connections')) {
        return { configuration_encrypted: encrypted };
      }
      if (call.op === 'run' && call.sql.includes('attempts = attempts + 1')) return true;
      if (call.op === 'run' && call.sql.includes("SET status = 'sent'")) {
        return { success: true, meta: { changes: 0 } };
      }
      if (call.op === 'run') {
        writes.push(call.sql);
        return true;
      }
      return undefined;
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      id: 're_test', status: 'succeeded', amount: 999, currency: 'usd',
    })));

    await expect(executeRefundProviderAction({
      DB: db,
      STORE_CREDENTIALS_ENCRYPTION_KEY: encryptionKey,
    } as BillingEnv, 'action-1')).resolves.toEqual({
      sent: false,
      cancelled: true,
      provider: 'stripe',
    });

    expect(writes.some((sql) => sql.includes('provider_action.result_after_cancellation'))).toBe(true);
  });
});

function actionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'action-1',
    case_id: 'case-1',
    action_type: 'submit_stripe_dispute_evidence',
    payload: JSON.stringify({ evidence: {} }),
    status: 'approved',
    idempotency_key: 'refund:case-1:submit',
    attempts: 0,
    project_id: '11',
    provider: 'stripe',
    environment: 'sandbox',
    provider_case_id: 'dp_test',
    provider_payload: '{}',
    store_transaction_id: null,
    original_transaction_id: null,
    order_id: null,
    purchase_token: null,
    store_product_id: 'vocostar_weekly_999',
    product_type: 'subscription',
    ...overrides,
  };
}
