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
      return undefined;
    });
    const env = { DB: db, BILLING_QUEUE: queue } as unknown as BillingEnv;

    await expect(ingestBillingProviderEvent(env, stripeRequest())).resolves.toEqual({
      event_id: 'event-1', duplicate: true, queued: false, processed: true,
    });
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('rejects mismatched jobs before persistence', async () => {
    const db = createFakeD1(() => undefined);
    const env = { DB: db, BILLING_QUEUE: { send: vi.fn() } } as unknown as BillingEnv;
    const request = stripeRequest();
    request.store = 'google';

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

    await expect(ingestBillingProviderEvent(env, stripeRequest())).rejects.toMatchObject({
      code: 'billing_queue_unavailable', status: 503, retryable: true,
    });
    expect(db.calls.some((call) => call.sql.includes("status = 'failed'"))).toBe(true);
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

function stripeRequest() {
  return {
    projectId: '11',
    store: 'stripe' as 'apple' | 'google' | 'stripe',
    environment: 'sandbox' as const,
    externalEventId: 'stripe-event-1',
    eventType: 'checkout.session.completed',
    payload: '{"id":"stripe-event-1"}',
    job: { type: 'billing.stripe.notification' as const, connectionId: 'connection-1' },
  };
}
