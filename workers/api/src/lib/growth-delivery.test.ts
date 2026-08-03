import { describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { createFakeD1, type FakeD1Call } from '../test/fake-d1';
import {
  billingGrowthEventType,
  deliverGrowthAutomation,
  emitBillingGrowthEvent,
  emitGrowthEvent,
  enqueuePaywallAbandonmentRecovery,
  evaluatePaywallAbandonment,
} from './growth-delivery';

function json(payload: unknown, status = 200) {
  return Response.json(payload, { status });
}

function requestFrom(input: RequestInfo | URL, init?: RequestInit) {
  return input instanceof Request ? input : new Request(input, init);
}

function baseEnv(options: {
  receipt?: { status: string; notification_id: string | null } | null;
  messaging?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  growth?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  queue?: { send: (body: unknown) => Promise<void> };
} = {}) {
  const db = createFakeD1((call: FakeD1Call) => {
    if (call.op === 'first' && call.sql.includes('FROM growth_delivery_receipts')) return options.receipt ?? null;
    if (call.op === 'run' && call.sql.includes('growth_delivery_receipts')) return { meta: { changes: 1 } };
    return undefined;
  });
  const env = {
    DB: db,
    KV: {} as KVNamespace,
    ENVIRONMENT: 'test', SHORTLINK_DOMAIN: 'go.test', API_DOMAIN: 'api.test', SDK_DOMAIN: 'sdk.test', CORS_ORIGIN: '*', JWT_SECRET: 'test',
    GROWTH_INTERNAL_TOKEN: 'growth-token', MESSAGING_INTERNAL_TOKEN: 'messaging-token',
    GROWTH: { fetch: options.growth || (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestFrom(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/claim')) return json({ data: {
        id: 'run-1', status: 'pending', action_type: 'chat', terminal: false,
        action_payload_json: JSON.stringify({ subject_id: 'customer-1', message: { title: 'Update', body: 'Your subscription has been renewed.' } }),
      } });
      return json({ data: { id: 'run-1', status: 'delivered' } });
    }) } as Fetcher,
    MESSAGING: { fetch: options.messaging || (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestFrom(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/conversations')) return json({ data: { id: 'conversation-1' }, duplicate: true });
      return json({ data: { id: 'message-1' }, duplicate: false }, 201);
    }) } as Fetcher,
    EVENT_QUEUE: options.queue as Queue | undefined,
  } as Env;
  return { env, db };
}

describe('growth automation delivery', () => {
  it('maps only canonical lifecycle states to supported growth triggers', () => {
    expect(billingGrowthEventType('billing_issue', 'invoice.payment_failed')).toBe('payment_failed');
    expect(billingGrowthEventType('active', 'DID_RENEW')).toBe('renewal_succeeded');
    expect(billingGrowthEventType('refunded', 'REFUND')).toBe('refund_granted');
    expect(billingGrowthEventType('active', 'REFUND_REVERSED')).toBe('refund_reversed');
    expect(billingGrowthEventType('cancelled', 'DID_CHANGE_RENEWAL_STATUS')).toBe('churn_risk');
    expect(billingGrowthEventType('expired', 'EXPIRED')).toBe('entitlement_expired');
    expect(billingGrowthEventType('active', 'INITIAL_BUY')).toBeNull();
  });

  it('projects an identified abandoned paywall session into an idempotent growth event', async () => {
    const growthEvents: Record<string, unknown>[] = [];
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_paywall_events pe')) return {
        id: 'paywall-event-1', project_id: '11', customer_id: 'customer-1',
        primary_app_user_id: 'user-1', anonymous: 0, event_type: 'closed',
        paywall_id: 'paywall-1', paywall_version_id: 'version-1', placement_identifier: 'default',
        package_identifier: 'annual', platform: 'ios', country: 'CH', app_version: '1.0.0', sdk_version: '2.1.0',
        metadata: JSON.stringify({ session_id: 'session-1' }), occurred_at: '2026-08-03T10:00:00.000Z',
        growth_projected_at: null, growth_projection_attempts: 0,
      };
      if (call.op === 'first' && call.sql.includes("event_type = 'purchase_succeeded'")) return null;
      if (call.op === 'run' && call.sql.includes('growth_projected_at')) return { meta: { changes: 1 } };
      return undefined;
    });
    const { env } = baseEnv({
      growth: async (_input, init) => {
        growthEvents.push(JSON.parse(String(init?.body || '{}')));
        return json({ data: { duplicate: false, actions: [] } }, 202);
      },
      queue: { send: async () => undefined },
    });
    env.DB = db;
    await expect(evaluatePaywallAbandonment(env, '11', 'paywall-event-1'))
      .resolves.toMatchObject({ projected: true, duplicate: false });
    expect(growthEvents).toEqual([expect.objectContaining({
      event_id: 'paywall:paywall-event-1:abandoned', event_type: 'paywall_abandoned', subject_id: 'user-1',
    })]);
  });

  it('suppresses abandonment when the same paywall session completed a purchase', async () => {
    let growthCalls = 0;
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_paywall_events pe')) return {
        id: 'paywall-event-1', project_id: '11', customer_id: 'customer-1',
        primary_app_user_id: 'user-1', anonymous: 0, event_type: 'closed', metadata: '{"session_id":"session-1"}',
        occurred_at: '2026-08-03T10:00:00.000Z', growth_projected_at: null, growth_projection_attempts: 0,
      };
      if (call.op === 'first' && call.sql.includes("event_type = 'purchase_succeeded'")) return { id: 'success-1' };
      if (call.op === 'run' && call.sql.includes('growth_projected_at')) return { meta: { changes: 1 } };
      return undefined;
    });
    const { env } = baseEnv({ growth: async () => { growthCalls += 1; return json({}); } });
    env.DB = db;
    await expect(evaluatePaywallAbandonment(env, '11', 'paywall-event-1'))
      .resolves.toEqual({ skipped: true, reason: 'purchase_succeeded' });
    expect(growthCalls).toBe(0);
  });

  it('re-enqueues due paywall projections for recovery', async () => {
    const jobs: unknown[] = [];
    const db = createFakeD1((call) => {
      if (call.op === 'all' && call.sql.includes('growth_projection_attempts < 10')) {
        return [{ id: 'paywall-event-1', project_id: '11' }];
      }
      return undefined;
    });
    const { env } = baseEnv({ queue: { send: async (job) => { jobs.push(job); } } });
    env.DB = db;
    await expect(enqueuePaywallAbandonmentRecovery(env)).resolves.toBe(1);
    expect(jobs).toEqual([{
      type: 'growth.paywall-abandonment.evaluate', projectId: '11', paywallEventId: 'paywall-event-1',
    }]);
  });

  it('delivers a deterministic chat message and marks both receipt and run delivered', async () => {
    const requests: Request[] = [];
    const { env, db } = baseEnv({ messaging: async (input, init) => {
      const request = requestFrom(input, init);
      requests.push(request.clone());
      return new URL(request.url).pathname.endsWith('/conversations')
        ? json({ data: { id: 'conversation-1' } }, 201)
        : json({ data: { id: 'message-1' } }, 201);
    } });

    await expect(deliverGrowthAutomation(env, 11, 'run-1')).resolves.toMatchObject({ status: 'delivered', channel: 'chat' });
    expect(requests).toHaveLength(2);
    expect(await requests[0].json()).toMatchObject({ external_user_id: 'customer-1', client_conversation_id: 'lifecycle-automation' });
    expect(await requests[1].json()).toMatchObject({ client_message_id: 'run-1' });
    expect(requests[1].headers.get('X-OpenGrow-Agent-Id')).toBe('growth-automation');
    expect(db.calls.some((call) => call.sql.includes("status = 'delivered'"))).toBe(true);
  });

  it('does not redeliver an already completed receipt', async () => {
    let messagingCalls = 0;
    const { env } = baseEnv({
      receipt: { status: 'delivered', notification_id: null },
      messaging: async () => { messagingCalls += 1; return json({}); },
    });
    await expect(deliverGrowthAutomation(env, 11, 'run-1')).resolves.toEqual({ status: 'delivered', duplicate: true });
    expect(messagingCalls).toBe(0);
  });

  it('releases a retryable run without converting it to a terminal failure', async () => {
    const growthPaths: string[] = [];
    const { env } = baseEnv({
      growth: async (input, init) => {
        const request = requestFrom(input, init);
        const path = new URL(request.url).pathname;
        growthPaths.push(path);
        if (path.endsWith('/claim')) return json({ data: {
          id: 'run-1', status: 'pending', action_type: 'chat', terminal: false,
          action_payload_json: JSON.stringify({ subject_id: 'customer-1', message: { body: 'Retry this message.' } }),
        } });
        return json({ data: { id: 'run-1', status: 'pending' } });
      },
      messaging: async () => json({ code: 'messaging_unavailable', message: 'Temporarily unavailable', retryable: true }, 503),
    });
    await expect(deliverGrowthAutomation(env, 11, 'run-1')).rejects.toMatchObject({ code: 'messaging_unavailable', retryable: true });
    expect(growthPaths.some((path) => path.endsWith('/release'))).toBe(true);
    expect(growthPaths.some((path) => path.endsWith('/run-1'))).toBe(false);
  });

  it('queues only pending actions returned by an idempotent event evaluation', async () => {
    const sent: unknown[] = [];
    const { env } = baseEnv({
      growth: async () => json({ data: { duplicate: true, actions: [
        { id: 'pending-1', status: 'pending' }, { id: 'delivered-1', status: 'delivered' },
      ] } }, 202),
      queue: { send: async (body) => { sent.push(body); } },
    });
    await expect(emitGrowthEvent(env, 11, { event_id: 'provider-1', event_type: 'renewal_succeeded', subject_id: 'customer-1' }))
      .resolves.toEqual({ duplicate: true, queued: 1 });
    expect(sent).toEqual([{ type: 'growth.automation.deliver', projectId: '11', runId: 'pending-1' }]);
  });

  it('projects a canonical billing transaction without coupling Billing success to delivery', async () => {
    const sent: unknown[] = [];
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_transactions')) return {
        id: 'transaction-1', project_id: '11', store: 'apple', status: 'active', event_type: 'DID_RENEW',
        product_id: 'yearly', purchased_at: '2026-08-03T10:00:00.000Z', expires_at: '2027-08-03T10:00:00.000Z',
        primary_app_user_id: 'customer-1',
      };
      return undefined;
    });
    const { env } = baseEnv({
      growth: async () => json({ data: { duplicate: false, actions: [{ id: 'run-1', status: 'pending' }] } }, 202),
      queue: { send: async (body) => { sent.push(body); } },
    });
    env.DB = db;
    await expect(emitBillingGrowthEvent(env, {
      type: 'billing.apple.notification', eventId: 'event-1', projectId: '11', signedPayload: 'signed', environment: 'production',
    }, { transaction_id: 'transaction-1' })).resolves.toEqual({ duplicate: false, queued: 1 });
    expect(sent).toEqual([{ type: 'growth.automation.deliver', projectId: '11', runId: 'run-1' }]);
  });
});
