import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import { deliverBillingWebhook } from './billing-jobs';

afterEach(() => {
  vi.unstubAllGlobals();
});

function deliveryEnv(options: {
  claimChanges?: number;
  status?: string;
  active?: number;
  onUpdate?: (args: unknown[]) => void;
} = {}) {
  const db = createFakeD1((call) => {
    if (call.op === 'run' && call.sql.startsWith('UPDATE billing_webhook_deliveries SET claim_token')) {
      return { success: true, meta: { changes: options.claimChanges ?? 1 } };
    }
    if (call.op === 'first' && call.sql.startsWith('SELECT status, attempts')) {
      return { status: options.status || 'delivered', attempts: 1 };
    }
    if (call.op === 'first' && call.sql.includes('JOIN billing_webhook_endpoints')) {
      return {
        id: 'delivery-1',
        payload: '{"id":"delivery-1"}',
        attempts: 0,
        url: 'https://api.example.com/webhooks/opengrow/entitlements',
        signing_secret_encrypted: 'env:OPENGROW_ENTITLEMENT_WEBHOOK_SECRET',
        active: options.active ?? 1,
      };
    }
    if (call.op === 'run' && call.sql.startsWith('UPDATE billing_webhook_deliveries')) {
      options.onUpdate?.(call.args);
      return true;
    }
    return undefined;
  });
  return {
    DB: db,
    OPENGROW_ENTITLEMENT_WEBHOOK_SECRET: 'projection-secret',
  } as unknown as Env;
}

describe('billing webhook delivery', () => {
  it('claims, signs, delivers, and records one successful attempt', async () => {
    let update: unknown[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        'X-SuperBoard-Delivery': 'delivery-1',
        'X-OpenGrow-Delivery': 'delivery-1',
      });
      expect(init?.redirect).toBe('manual');
      expect(String((init?.headers as Record<string, string>)['X-OpenGrow-Signature'])).toMatch(/^v1=/);
      expect(String((init?.headers as Record<string, string>)['X-SuperBoard-Signature'])).toMatch(/^v1=/);
      return new Response('{"received":true}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);

    await expect(deliverBillingWebhook(deliveryEnv({ onUpdate: (args) => { update = args; } }), 'delivery-1'))
      .resolves.toEqual({ delivered: true, status: 200 });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(update.slice(0, 3)).toEqual([1, 200, '{"received":true}']);
    expect(update.at(-2)).toBe('delivery-1');
  });

  it('does not redeliver when another consumer owns or completed the delivery', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    await expect(deliverBillingWebhook(deliveryEnv({ claimChanges: 0, status: 'delivered' }), 'delivery-1'))
      .resolves.toEqual({ skipped: true, status: 'delivered' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('honors an application retryable response and persists the failure', async () => {
    let update: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"code":"user_not_found","retryable":true}',
      { status: 404, headers: { 'Retry-After': '45' } },
    )));

    await expect(deliverBillingWebhook(deliveryEnv({ onUpdate: (args) => { update = args; } }), 'delivery-1'))
      .rejects.toMatchObject({ retryable: true, retryDelaySeconds: 45 });

    expect(update.slice(0, 4)).toEqual([
      1,
      404,
      '{"code":"user_not_found","retryable":true}',
      'Billing webhook returned HTTP 404',
    ]);
    expect(update[4]).toBe(1);
    expect(update[5]).toBe(45);
  });

  it('marks an inactive endpoint skipped without making a network request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    await expect(deliverBillingWebhook(deliveryEnv({ active: 0 }), 'delivery-1'))
      .resolves.toEqual({ skipped: true, status: 'inactive' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
