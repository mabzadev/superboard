import type { Env } from '../types';
import type { BillingQueueJob } from './billing-dispatch';
import { identifyCustomer } from './billing';
import {
  purchasesSigningJwks,
  resolveSdkCustomer,
  signedCustomerInfo,
  verifiedAppUserId,
} from './billing-identity';
import { readTextLimited } from './http-limits';
import type { BillingProviderIngressRequest } from './billing-provider-ingress';

type SignedCustomerInfo = Awaited<ReturnType<typeof signedCustomerInfo>>;
type PurchasesJwks = ReturnType<typeof purchasesSigningJwks>;
type ResolvedSdkCustomer = Awaited<ReturnType<typeof resolveSdkCustomer>>;

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
    signal: AbortSignal.timeout(10_000),
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

export async function ingestProviderEventWithBillingAuthority(env: Env, request: BillingProviderIngressRequest) {
  const response = await callBillingService<{ data?: unknown }>(env, '/internal/v1/provider-events/ingest', {
    project_id: request.projectId,
    store: request.store,
    environment: request.environment,
    external_event_id: request.externalEventId,
    event_type: request.eventType || null,
    payload: request.payload,
    job: request.job,
  });
  if (!isProviderIngressResult(response.data)) {
    throw invalidBillingAuthorityResponse('Billing returned an invalid provider ingress result');
  }
  return response.data;
}

export async function classifyGooglePurchaseWithBillingAuthority(env: Env, params: {
  projectId: string | number;
  purchaseToken: string;
  productId: string;
  productType: 'subscription' | 'non_consumable' | 'consumable';
}) {
  const response = await callBillingServiceBinding<{ data?: { environment?: unknown } }>(
    env,
    '/internal/v1/google/purchases/classify',
    {
      project_id: String(params.projectId),
      purchase_token: params.purchaseToken,
      product_id: params.productId,
      product_type: params.productType,
    },
  );
  const environment = response.data?.environment;
  if (environment !== 'sandbox' && environment !== 'production') {
    throw invalidBillingAuthorityResponse('Billing returned an invalid Google Play environment');
  }
  return environment;
}

export async function customerInfoFromBillingAuthority(
  env: Env,
  projectId: string | number,
  customerId: string,
): Promise<SignedCustomerInfo> {
  if (!billingServiceEnabled(env)) return signedCustomerInfo(env, projectId, customerId);
  const response = await callBillingServiceBinding<{ data?: unknown }>(env, '/internal/v1/customer-info', {
    project_id: String(projectId),
    customer_id: customerId,
  });
  if (!isSignedCustomerInfo(response.data)) {
    throw invalidBillingAuthorityResponse('Billing returned invalid signed CustomerInfo');
  }
  return response.data as SignedCustomerInfo;
}

export async function purchasesJwksFromBillingAuthority(env: Env): Promise<PurchasesJwks> {
  if (!billingServiceEnabled(env)) return purchasesSigningJwks(env);
  const response = await callBillingServiceBinding<unknown>(env, '/internal/v1/jwks');
  if (!isPurchasesJwks(response)) {
    throw invalidBillingAuthorityResponse('Billing returned an invalid purchases key set');
  }
  return response as PurchasesJwks;
}

export async function resolveCustomerFromBillingAuthority(env: Env, params: {
  projectId: string | number;
  authorization?: string;
  anonymousId?: string;
}): Promise<ResolvedSdkCustomer> {
  if (!billingServiceEnabled(env)) return resolveSdkCustomer(env, params);
  const response = await callBillingServiceBinding<{ data?: unknown }>(env, '/internal/v1/customers/resolve', {
    project_id: String(params.projectId),
    authorization: params.authorization || null,
    anonymous_id: params.anonymousId || null,
  });
  if (!isResolvedSdkCustomer(response.data)) {
    throw invalidBillingAuthorityResponse('Billing returned an invalid customer context');
  }
  return response.data as ResolvedSdkCustomer;
}

export async function identifyCustomerFromBillingAuthority(env: Env, params: {
  projectId: string | number;
  authorization?: string;
  currentAppUserId: string;
}): Promise<SignedCustomerInfo> {
  if (!billingServiceEnabled(env)) {
    const targetAppUserId = await verifiedAppUserId(env, params.projectId, params.authorization);
    if (!targetAppUserId) throw identityRequired();
    const customer = await identifyCustomer(env.DB, params.projectId, params.currentAppUserId, targetAppUserId);
    return signedCustomerInfo(env, params.projectId, String(customer?.id));
  }
  const response = await callBillingServiceBinding<{ data?: unknown }>(env, '/internal/v1/customers/identify', {
    project_id: String(params.projectId),
    authorization: params.authorization || null,
    current_app_user_id: params.currentAppUserId,
  });
  if (!isSignedCustomerInfo(response.data)) {
    throw invalidBillingAuthorityResponse('Billing returned invalid identified CustomerInfo');
  }
  return response.data as SignedCustomerInfo;
}

function isSignedCustomerInfo(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.customer_id === 'string'
    && typeof record.signature === 'string'
    && record.signature.length > 0
    && record.signature_algorithm === 'ES256'
    && typeof record.signature_key_id === 'string'
    && record.signature_key_id.length > 0;
}

function isPurchasesJwks(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = (value as { keys?: unknown }).keys;
  return Array.isArray(keys) && keys.length > 0 && keys.every((key) => {
    if (!key || typeof key !== 'object' || Array.isArray(key)) return false;
    const record = key as Record<string, unknown>;
    return record.kty === 'EC' && record.crv === 'P-256'
      && record.alg === 'ES256' && record.use === 'sig'
      && typeof record.kid === 'string' && typeof record.x === 'string' && typeof record.y === 'string'
      && record.d == null;
  });
}

function isResolvedSdkCustomer(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!record.customer || typeof record.customer !== 'object' || Array.isArray(record.customer)) return false;
  const customer = record.customer as Record<string, unknown>;
  return (typeof customer.id === 'string' || typeof customer.id === 'number')
    && typeof record.appUserId === 'string'
    && typeof record.identified === 'boolean';
}

function isProviderIngressResult(value: unknown): value is {
  event_id: string; duplicate: boolean; queued: boolean; processed: boolean;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.event_id === 'string' && typeof record.duplicate === 'boolean'
    && typeof record.queued === 'boolean' && typeof record.processed === 'boolean';
}

function invalidBillingAuthorityResponse(message: string) {
  return Object.assign(new Error(message), {
    code: 'billing_authority_invalid_response', status: 503, retryable: true,
  });
}

function identityRequired() {
  return Object.assign(new Error('A verified identity token is required'), {
    code: 'identity_required', status: 401, retryable: false,
  });
}
