import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import { ingestBillingProviderEvent } from './billing-provider-ingress';

const providerMocks = vi.hoisted(() => ({ verifyApple: vi.fn() }));

vi.mock('./store-verification', () => ({
  verifyAppleNotification: providerMocks.verifyApple,
}));

afterEach(() => providerMocks.verifyApple.mockReset());

describe('Billing provider ingress authority', () => {
  it('verifies Apple before the immutable event is persisted and queued', async () => {
    const order: string[] = [];
    providerMocks.verifyApple.mockImplementation(async () => { order.push('verify'); return {}; });
    const queue = { send: vi.fn(async () => { order.push('queue'); }) };
    const db = createFakeD1((call) => {
      if (call.op === 'run' && call.sql.startsWith('INSERT OR IGNORE INTO billing_webhook_events')) {
        order.push('persist');
        return true;
      }
      if (call.op === 'first' && call.sql.includes('FROM billing_webhook_events')) {
        return { id: 'event-1', status: 'received' };
      }
      if (call.op === 'run' && call.sql.includes('SET job_payload = COALESCE')) return true;
      return undefined;
    });
    const env = { DB: db, BILLING_QUEUE: queue } as unknown as BillingEnv;

    await expect(ingestBillingProviderEvent(env, appleRequest())).resolves.toMatchObject({
      event_id: 'event-1', duplicate: false, queued: true, processed: false,
    });
    expect(order).toEqual(['verify', 'persist', 'queue']);
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'billing.apple.notification', eventId: 'event-1', projectId: '11',
    }));
  });

  it('does not enqueue a provider event that is already processed', async () => {
    const queue = { send: vi.fn() };
    const db = createFakeD1((call) => {
      if (call.op === 'run' && call.sql.startsWith('INSERT OR IGNORE INTO billing_webhook_events')) {
        return { success: true, meta: { changes: 0 } };
      }
      if (call.op === 'first' && call.sql.includes('FROM billing_webhook_events')) {
        return { id: 'event-1', status: 'processed' };
      }
      if (call.op === 'run' && call.sql.includes('SET job_payload = COALESCE')) return true;
      return undefined;
    });
    const env = { DB: db, BILLING_QUEUE: queue } as unknown as BillingEnv;

    await expect(ingestBillingProviderEvent(env, googleRequest())).resolves.toEqual({
      event_id: 'event-1', duplicate: true, queued: false, processed: true,
    });
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('rejects mismatched jobs before persistence', async () => {
    const db = createFakeD1(() => undefined);
    const env = { DB: db, BILLING_QUEUE: { send: vi.fn() } } as unknown as BillingEnv;
    const request = googleRequest();
    request.store = 'apple';

    await expect(ingestBillingProviderEvent(env, request)).rejects.toMatchObject({
      code: 'provider_event_job_invalid', retryable: false,
    });
    expect(db.calls).toHaveLength(0);
  });

  it('marks durable ingress as failed when queue delivery fails', async () => {
    const queue = { send: vi.fn().mockRejectedValue(new Error('queue unavailable')) };
    const db = createFakeD1((call) => {
      if (call.op === 'run' && call.sql.startsWith('INSERT OR IGNORE INTO billing_webhook_events')) return true;
      if (call.op === 'first' && call.sql.includes('FROM billing_webhook_events')) return { id: 'event-1', status: 'received' };
      if (call.op === 'run' && call.sql.startsWith('UPDATE billing_webhook_events')) return true;
      return undefined;
    });
    const env = { DB: db, BILLING_QUEUE: queue } as unknown as BillingEnv;

    await expect(ingestBillingProviderEvent(env, googleRequest())).rejects.toMatchObject({
      code: 'billing_queue_unavailable', status: 503, retryable: true,
    });
    expect(db.calls.some((call) => call.sql.includes("status = 'failed'"))).toBe(true);
  });

  it('persists and queues Google refund reviews as a distinct financial job', async () => {
    const queue = { send: vi.fn(async () => undefined) };
    const db = createFakeD1((call) => {
      if (call.op === 'run' && call.sql.startsWith('INSERT OR IGNORE INTO billing_webhook_events')) return true;
      if (call.op === 'first' && call.sql.includes('FROM billing_webhook_events')) return { id: 'refund-event-1', status: 'received' };
      if (call.op === 'run' && call.sql.includes('SET job_payload = COALESCE')) return true;
      return undefined;
    });
    const env = { DB: db, BILLING_QUEUE: queue } as unknown as BillingEnv;

    await expect(ingestBillingProviderEvent(env, {
      projectId: '11',
      store: 'google',
      environment: 'production',
      externalEventId: 'pubsub-review-1',
      eventType: 'PENDING_REFUND_REVIEW_CHARGEBACK',
      payload: '{"pendingRefundReviewNotification":{"pendingRefundToken":"token","orderId":"GPA.1"}}',
      job: {
        type: 'billing.google.refund.review',
        projectId: '11',
        environment: 'production',
        eventOccurredAt: '2026-08-04T08:00:00.000Z',
      },
    })).resolves.toMatchObject({ event_id: 'refund-event-1', queued: true });
    expect(queue.send).toHaveBeenCalledWith({
      type: 'billing.google.refund.review',
      eventId: 'refund-event-1',
      projectId: '11',
      environment: 'production',
      eventOccurredAt: '2026-08-04T08:00:00.000Z',
    });
  });
});

function appleRequest() {
  return {
    projectId: '11',
    store: 'apple' as const,
    environment: 'sandbox' as const,
    externalEventId: 'apple-event-1',
    payload: '{"signedPayload":"signed-apple-payload"}',
    job: {
      type: 'billing.apple.notification' as const,
      projectId: '11',
      signedPayload: 'signed-apple-payload',
      environment: 'sandbox' as const,
    },
  };
}

function googleRequest() {
  return {
    projectId: '11',
    store: 'google' as 'apple' | 'google',
    environment: 'sandbox' as const,
    externalEventId: 'google-event-1',
    eventType: 'SUBSCRIPTION_RENEWED',
    payload: '{"id":"google-event-1"}',
    job: {
      type: 'billing.google.notification' as const,
      projectId: '11',
      purchaseToken: 'purchase-token',
      productId: 'product-id',
      productType: 'subscription' as const,
      eventType: 'SUBSCRIPTION_RENEWED',
      eventOccurredAt: '2026-08-04T08:00:00.000Z',
      environment: 'sandbox' as const,
    },
  };
}
