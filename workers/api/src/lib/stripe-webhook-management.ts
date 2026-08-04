import type { BillingEnv } from '../types';
import { readTextLimited } from './http-limits';
import { purchasesError } from './purchases-v2';
import type { StripeEnvironment } from './stripe-credentials';

export const STRIPE_WEBHOOK_ENABLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
  'charge.refund.updated',
  'refund.created',
  'refund.failed',
  'refund.updated',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
  'radar.early_fraud_warning.created',
  'radar.early_fraud_warning.updated',
] as const;

export const STRIPE_PURCHASE_EVENT_TYPES = new Set<string>(STRIPE_WEBHOOK_ENABLED_EVENTS);

export type StripeWebhookConfiguration = {
  endpoint_id: string;
  url: string;
  livemode: boolean;
  status: string;
  enabled_events: string[];
  managed: boolean;
};

export function stripeWebhookUrl(apiDomain: string, connectionId: string) {
  const input = String(apiDomain || '').trim().replace(/\/+$/, '');
  const origin = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(origin);
  if (url.protocol !== 'https:') throw purchasesError('stripe_webhook_url_invalid', 'Stripe webhook URL must use HTTPS', 500);
  return `${url.origin}/api/v2/purchases/providers/webhooks/${encodeURIComponent(connectionId)}`;
}

export async function provisionStripeWebhookEndpoint(params: {
  secretKey: string;
  environment: StripeEnvironment;
  url: string;
  connectionId: string;
  fetcher?: typeof fetch;
}) {
  const values = new URLSearchParams({
    url: params.url,
    description: `OpenGrow Purchases ${params.environment === 'sandbox' ? 'test' : 'live'} events`,
  });
  STRIPE_WEBHOOK_ENABLED_EVENTS.forEach((event, index) => values.set(`enabled_events[${index}]`, event));
  const payload = await stripeRequest(params.secretKey, '/webhook_endpoints', {
    method: 'POST',
    body: values,
    idempotencyKey: `opengrow-webhook-${params.connectionId}`.slice(0, 255),
    fetcher: params.fetcher,
  });
  const secret = String(payload.secret || '');
  const endpointId = String(payload.id || '');
  if (!secret.startsWith('whsec_')) {
    if (endpointId.startsWith('we_')) await deleteStripeWebhookEndpoint(params.secretKey, endpointId, params.fetcher || fetch);
    throw purchasesError('stripe_webhook_secret_missing', 'Stripe did not return the webhook signing secret', 502, true);
  }
  try {
    const configuration = await retrieveStripeWebhookConfiguration({
      secretKey: params.secretKey,
      environment: params.environment,
      url: params.url,
      endpointId,
      managed: true,
      fetcher: params.fetcher,
    });
    return { secret, configuration };
  } catch (error) {
    if (endpointId.startsWith('we_')) await deleteStripeWebhookEndpoint(params.secretKey, endpointId, params.fetcher || fetch);
    throw error;
  }
}

export async function retrieveStripeWebhookConfiguration(params: {
  secretKey: string;
  environment: StripeEnvironment;
  url: string;
  endpointId: string;
  managed?: boolean;
  fetcher?: typeof fetch;
}) {
  const payload = await stripeRequest(
    params.secretKey,
    `/webhook_endpoints/${encodeURIComponent(params.endpointId)}`,
    { method: 'GET', fetcher: params.fetcher },
  );
  return validateStripeWebhookConfiguration(payload, params.environment, params.url, params.managed !== false);
}

export async function discoverStripeWebhookConfiguration(params: {
  secretKey: string;
  environment: StripeEnvironment;
  url: string;
  fetcher?: typeof fetch;
}) {
  let startingAfter = '';
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: '100' });
    if (startingAfter) query.set('starting_after', startingAfter);
    const payload = await stripeRequest(params.secretKey, `/webhook_endpoints?${query}`, {
      method: 'GET', fetcher: params.fetcher,
    });
    const endpoints = Array.isArray(payload.data) ? payload.data : [];
    const matching = endpoints.find((item) => normalizedUrl(item?.url) === normalizedUrl(params.url)
      && item?.livemode === (params.environment === 'production'));
    if (matching) return validateStripeWebhookConfiguration(matching, params.environment, params.url, false);
    if (payload.has_more !== true || endpoints.length === 0) break;
    startingAfter = String(endpoints[endpoints.length - 1]?.id || '');
    if (!startingAfter) break;
  }
  throw purchasesError(
    'stripe_webhook_endpoint_not_found',
    'No Stripe webhook endpoint matches the required URL and environment',
    422,
  );
}

export async function deleteStripeWebhookEndpoint(
  secretKey: string,
  endpointId: string,
  fetcher: typeof fetch = fetch,
) {
  try {
    await stripeRequest(secretKey, `/webhook_endpoints/${encodeURIComponent(endpointId)}`, {
      method: 'DELETE',
      fetcher,
    });
  } catch {
    // Rollback is best-effort. The failed setup remains auditable in OpenGrow.
  }
}

export async function persistStripeWebhookReadiness(
  db: D1Database,
  projectId: string | number,
  configuration: StripeWebhookConfiguration,
) {
  let previous: Record<string, unknown> = {};
  let signatureVerified = configuration.managed;
  if (!configuration.managed) {
    const existing = await db.prepare(`
      SELECT current_configuration FROM billing_store_notification_configurations
      WHERE project_id = ? AND provider = 'stripe' LIMIT 1
    `).bind(String(projectId)).first<{ current_configuration: string }>();
    try {
      previous = existing?.current_configuration ? JSON.parse(existing.current_configuration) : {};
      signatureVerified = previous.signature_verified === true
        && normalizedUrl(previous.url) === normalizedUrl(configuration.url)
        && previous.livemode === configuration.livemode;
    } catch { previous = {}; signatureVerified = false; }
  }
  const ready = configuration.managed || signatureVerified;
  const current = {
    ...(!configuration.managed && signatureVerified ? previous : {}),
    ...configuration,
    configuration_verified: true,
    signature_verified: signatureVerified,
  };
  const required = {
    url: configuration.url,
    livemode: configuration.livemode,
    status: 'enabled',
    enabled_events: [...STRIPE_WEBHOOK_ENABLED_EVENTS],
    configuration_verified: true,
    signature_verified: true,
  };
  await db.prepare(`
    INSERT INTO billing_store_notification_configurations (
      project_id, provider, ready, current_configuration, required_configuration,
      checked_at, configured_at, updated_at
    ) VALUES (?, 'stripe', ?, ?, ?, datetime('now'), ?, datetime('now'))
    ON CONFLICT(project_id, provider) DO UPDATE SET
      ready = excluded.ready,
      current_configuration = excluded.current_configuration,
      required_configuration = excluded.required_configuration,
      checked_at = excluded.checked_at,
      configured_at = CASE WHEN excluded.ready = 1
        THEN COALESCE(billing_store_notification_configurations.configured_at, excluded.configured_at)
        ELSE NULL END,
      updated_at = excluded.updated_at
  `).bind(
    String(projectId), ready ? 1 : 0, JSON.stringify(current), JSON.stringify(required),
    ready ? new Date().toISOString() : null,
  ).run();
  return { ready, configuration: current };
}

export async function persistStripeWebhookDeliveryReadiness(
  db: D1Database,
  params: {
    projectId: string | number;
    connectionId: string;
    environment: StripeEnvironment;
    url: string;
    eventId: string;
    eventType: string;
  },
) {
  const existing = await db.prepare(`
    SELECT current_configuration FROM billing_store_notification_configurations
    WHERE project_id = ? AND provider = 'stripe' LIMIT 1
  `).bind(String(params.projectId)).first<{ current_configuration: string }>();
  let current: Record<string, unknown> = {};
  try { current = existing?.current_configuration ? JSON.parse(existing.current_configuration) : {}; }
  catch { current = {}; }
  const configurationVerified = current.configuration_verified === true
    && normalizedUrl(current.url) === normalizedUrl(params.url)
    && current.livemode === (params.environment === 'production');
  current = {
    ...current,
    authentication: 'stripe_signature_v1',
    connection_id: params.connectionId,
    url: params.url,
    livemode: params.environment === 'production',
    signature_verified: true,
    last_event_id: params.eventId,
    last_event_type: params.eventType,
    last_delivery_at: new Date().toISOString(),
  };
  const required = {
    authentication: 'stripe_signature_v1',
    connection_id: params.connectionId,
    url: params.url,
    livemode: params.environment === 'production',
    configuration_verified: true,
    signature_verified: true,
  };
  const ready = configurationVerified;
  await db.prepare(`
    INSERT INTO billing_store_notification_configurations (
      project_id, provider, ready, current_configuration, required_configuration,
      checked_at, configured_at, updated_at
    ) VALUES (?, 'stripe', ?, ?, ?, datetime('now'), ?, datetime('now'))
    ON CONFLICT(project_id, provider) DO UPDATE SET
      ready = excluded.ready,
      current_configuration = excluded.current_configuration,
      required_configuration = excluded.required_configuration,
      checked_at = excluded.checked_at,
      configured_at = CASE WHEN excluded.ready = 1
        THEN COALESCE(billing_store_notification_configurations.configured_at, excluded.configured_at)
        ELSE NULL END,
      updated_at = excluded.updated_at
  `).bind(
    String(params.projectId), ready ? 1 : 0, JSON.stringify(current), JSON.stringify(required),
    ready ? new Date().toISOString() : null,
  ).run();
  return { ready, configuration: current };
}

export async function invalidateStripeWebhookReadiness(
  db: D1Database,
  projectId: string | number,
  reason: string,
) {
  await db.prepare(`
    INSERT INTO billing_store_notification_configurations (
      project_id, provider, ready, current_configuration, required_configuration,
      checked_at, configured_at, updated_at
    ) VALUES (?, 'stripe', 0, ?, '{}', datetime('now'), NULL, datetime('now'))
    ON CONFLICT(project_id, provider) DO UPDATE SET
      ready = 0,
      current_configuration = excluded.current_configuration,
      required_configuration = excluded.required_configuration,
      checked_at = excluded.checked_at,
      configured_at = NULL,
      updated_at = excluded.updated_at
  `).bind(String(projectId), JSON.stringify({ reason })).run();
}

function validateStripeWebhookConfiguration(
  payload: Record<string, any>,
  environment: StripeEnvironment,
  expectedUrl: string,
  managed: boolean,
): StripeWebhookConfiguration {
  const endpointId = String(payload.id || '');
  const enabledEvents = Array.isArray(payload.enabled_events) ? payload.enabled_events.map(String) : [];
  const expectedLiveMode = environment === 'production';
  const enabledEventSet = new Set(enabledEvents);
  const eventsReady = enabledEventSet.size === STRIPE_WEBHOOK_ENABLED_EVENTS.length
    && STRIPE_WEBHOOK_ENABLED_EVENTS.every((event) => enabledEventSet.has(event));
  if (payload.object !== 'webhook_endpoint' || !endpointId.startsWith('we_')
    || normalizedUrl(payload.url) !== normalizedUrl(expectedUrl)
    || payload.livemode !== expectedLiveMode || payload.status !== 'enabled' || !eventsReady) {
    throw purchasesError(
      'stripe_webhook_configuration_invalid',
      'Stripe webhook endpoint does not match the required URL, environment, status, and event set',
      422,
    );
  }
  return {
    endpoint_id: endpointId,
    url: expectedUrl,
    livemode: expectedLiveMode,
    status: 'enabled',
    enabled_events: enabledEvents,
    managed,
  };
}

async function stripeRequest(
  secretKey: string,
  path: string,
  options: {
    method: 'GET' | 'POST' | 'DELETE';
    body?: URLSearchParams;
    idempotencyKey?: string;
    fetcher?: typeof fetch;
  },
) {
  const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}` };
  if (options.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await (options.fetcher || fetch)(`https://api.stripe.com/v1${path}`, {
    method: options.method,
    headers,
    body: options.body,
  });
  const text = await readTextLimited(response, 1_048_576, 'Stripe webhook response is too large');
  let payload: Record<string, any>;
  try { payload = JSON.parse(text || '{}') as Record<string, any>; }
  catch { throw purchasesError('stripe_webhook_response_invalid', 'Stripe returned an invalid webhook response', 502, true); }
  if (!response.ok) {
    throw purchasesError(
      'stripe_webhook_request_failed',
      String(payload.error?.message || 'Stripe webhook request failed'),
      response.status >= 500 ? 503 : 422,
      response.status >= 500,
    );
  }
  return payload;
}

function normalizedUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''));
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch { return ''; }
}
