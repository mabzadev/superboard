import { describe, expect, it, vi } from 'vitest';
import { createFakeD1 } from '../test/fake-d1';
import {
  discoverStripeWebhookConfiguration,
  persistStripeWebhookDeliveryReadiness,
  persistStripeWebhookReadiness,
  provisionStripeWebhookEndpoint,
  retrieveStripeWebhookConfiguration,
  STRIPE_WEBHOOK_ENABLED_EVENTS,
  stripeWebhookUrl,
} from './stripe-webhook-management';

describe('Stripe managed webhooks', () => {
  it('provisions the exact endpoint, environment, and supported event set', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return Response.json({
          id: 'we_test', object: 'webhook_endpoint',
          url: 'https://api.example.test/api/v2/purchases/providers/webhooks/connection-1',
          livemode: false, status: 'enabled', enabled_events: [...STRIPE_WEBHOOK_ENABLED_EVENTS],
        });
      }
      const values = new URLSearchParams(String(init?.body || ''));
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('opengrow-webhook-connection-1');
      expect(values.get('url')).toBe('https://api.example.test/api/v2/purchases/providers/webhooks/connection-1');
      expect(STRIPE_WEBHOOK_ENABLED_EVENTS.every((event, index) => values.get(`enabled_events[${index}]`) === event)).toBe(true);
      return Response.json({
        id: 'we_test',
        object: 'webhook_endpoint',
        secret: 'whsec_generated',
        url: values.get('url'),
        livemode: false,
        status: 'enabled',
        enabled_events: [...STRIPE_WEBHOOK_ENABLED_EVENTS],
      });
    });
    await expect(provisionStripeWebhookEndpoint({
      secretKey: 'sk_test_example',
      environment: 'sandbox',
      url: stripeWebhookUrl('api.example.test', 'connection-1'),
      connectionId: 'connection-1',
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({
      secret: 'whsec_generated',
      configuration: { endpoint_id: 'we_test', livemode: false, managed: true },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects a provider endpoint with a mismatched live mode', async () => {
    const fetcher = vi.fn(async () => Response.json({
      id: 'we_live', object: 'webhook_endpoint', url: 'https://api.example.test/hook',
      livemode: true, status: 'enabled', enabled_events: ['*'],
    }));
    await expect(retrieveStripeWebhookConfiguration({
      secretKey: 'sk_test_example',
      environment: 'sandbox',
      url: 'https://api.example.test/hook',
      endpointId: 'we_live',
      fetcher: fetcher as typeof fetch,
    })).rejects.toMatchObject({ code: 'stripe_webhook_configuration_invalid' });
  });

  it('rejects wildcard delivery instead of treating it as the exact event contract', async () => {
    const fetcher = vi.fn(async () => Response.json({
      id: 'we_test', object: 'webhook_endpoint', url: 'https://api.example.test/hook',
      livemode: false, status: 'enabled', enabled_events: ['*'],
    }));
    await expect(retrieveStripeWebhookConfiguration({
      secretKey: 'sk_test_example', environment: 'sandbox',
      url: 'https://api.example.test/hook', endpointId: 'we_test',
      fetcher: fetcher as typeof fetch,
    })).rejects.toMatchObject({ code: 'stripe_webhook_configuration_invalid' });
  });

  it('removes a newly created endpoint when Stripe does not return its signing secret', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => Response.json({
      id: 'we_incomplete', object: 'webhook_endpoint',
      ...(init?.method === 'POST' ? {} : { deleted: true }),
    }));
    await expect(provisionStripeWebhookEndpoint({
      secretKey: 'sk_test_example', environment: 'sandbox',
      url: 'https://api.example.test/hook', connectionId: 'connection-1',
      fetcher: fetcher as typeof fetch,
    })).rejects.toMatchObject({ code: 'stripe_webhook_secret_missing' });
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'DELETE']);
  });

  it('persists readiness without storing a signing secret', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'run' && call.sql.includes('billing_store_notification_configurations')) return true;
      return undefined;
    });
    await persistStripeWebhookReadiness(db, '11', {
      endpoint_id: 'we_test',
      url: 'https://api.example.test/hook',
      livemode: false,
      status: 'enabled',
      enabled_events: [...STRIPE_WEBHOOK_ENABLED_EVENTS],
      managed: true,
    });
    const serialized = db.calls[0].args.map(String).join(' ');
    expect(serialized).not.toContain('whsec_');
    expect(serialized).toContain('we_test');
  });

  it('requires both endpoint readback and a signed delivery for a manual secret', async () => {
    let currentConfiguration: string | null = null;
    let ready = -1;
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('billing_store_notification_configurations')) {
        return currentConfiguration ? { current_configuration: currentConfiguration } : null;
      }
      if (call.op === 'run' && call.sql.includes('billing_store_notification_configurations')) {
        ready = Number(call.args[1]);
        currentConfiguration = String(call.args[2]);
        return true;
      }
      return undefined;
    });
    const url = 'https://api.example.test/api/v2/purchases/providers/webhooks/connection-1';

    await expect(persistStripeWebhookDeliveryReadiness(db, {
      projectId: '11', connectionId: 'connection-1', environment: 'sandbox', url,
      eventId: 'evt_signed', eventType: 'invoice.paid',
    })).resolves.toMatchObject({ ready: false });
    expect(ready).toBe(0);

    await expect(persistStripeWebhookReadiness(db, '11', {
      endpoint_id: 'we_manual', url, livemode: false, status: 'enabled',
      enabled_events: [...STRIPE_WEBHOOK_ENABLED_EVENTS], managed: false,
    })).resolves.toMatchObject({ ready: true });
    expect(ready).toBe(1);
    expect(currentConfiguration).toContain('"signature_verified":true');
    expect(currentConfiguration).not.toContain('whsec_');
  });

  it('discovers and validates a manually managed endpoint by exact URL', async () => {
    const fetcher = vi.fn(async () => Response.json({
      object: 'list', has_more: false, data: [{
        id: 'we_manual', object: 'webhook_endpoint',
        url: 'https://api.example.test/hook', livemode: false, status: 'enabled',
        enabled_events: [...STRIPE_WEBHOOK_ENABLED_EVENTS],
      }],
    }));
    await expect(discoverStripeWebhookConfiguration({
      secretKey: 'sk_test_example', environment: 'sandbox',
      url: 'https://api.example.test/hook', fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({ endpoint_id: 'we_manual', managed: false });
  });
});
