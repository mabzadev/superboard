import type { Env } from '../types';
import type { BillingQueueJob } from './billing-dispatch';
import { readTextLimited } from './http-limits';

export function billingServiceEnabled(env: Env): boolean {
  return env.BILLING_EXECUTION_MODE === 'service' && Boolean(env.BILLING);
}

export async function callBillingServiceBinding<T>(env: Env, path: string, body?: unknown): Promise<T> {
  if (!env.BILLING) {
    throw Object.assign(new Error('Billing service is not enabled'), {
      code: 'billing_service_unavailable', status: 503, retryable: true,
    });
  }
  const response = await env.BILLING.fetch(new Request(`https://billing.internal${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await readTextLimited(response, 1_048_576, 'Billing service response is too large');
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error('Billing service returned invalid JSON'); }
  if (!response.ok) {
    throw Object.assign(new Error(String(payload.message || 'Billing service request failed')), {
      code: payload.code || 'billing_service_failed',
      status: response.status,
      retryable: payload.retryable === true || response.status >= 500,
    });
  }
  return payload as T;
}

export async function callBillingService<T>(env: Env, path: string, body?: unknown): Promise<T> {
  if (!billingServiceEnabled(env)) {
    throw Object.assign(new Error('Billing service is not enabled'), {
      code: 'billing_service_unavailable', status: 503, retryable: true,
    });
  }
  return callBillingServiceBinding<T>(env, path, body);
}

export async function dispatchBillingServiceJob(env: Env, job: BillingQueueJob) {
  return callBillingService<{ data: unknown }>(env, '/internal/v1/jobs', job).then((value) => value.data);
}
