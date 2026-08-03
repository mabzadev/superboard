import type { BillingEnvironment } from '../../api/src/lib/billing';
import type { BillingEnv } from '../../api/src/types';

export type ReceiptRequest = {
  project_id: string;
  customer_id: string;
  store: 'apple' | 'google';
  environment: BillingEnvironment;
  signed_transaction?: string;
  purchase_token?: string;
  product_id?: string;
  product_type?: 'subscription' | 'non_consumable' | 'consumable';
};

export function parseReceiptRequest(value: unknown): ReceiptRequest {
  const body = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const projectId = String(body.project_id || '').trim();
  const customerId = String(body.customer_id || '').trim();
  const store = String(body.store || '');
  const environment = String(body.environment || '');
  if (!projectId || !customerId) throw publicError('receipt_context_invalid', 'project_id and customer_id are required');
  if (!['apple', 'google'].includes(store)) throw publicError('receipt_store_invalid', 'store must be apple or google');
  if (!['sandbox', 'production'].includes(environment)) throw publicError('receipt_environment_invalid', 'environment must be sandbox or production');
  if (store === 'apple' && !String(body.signed_transaction || '').trim()) {
    throw publicError('receipt_required', 'signed_transaction is required for Apple');
  }
  if (store === 'google' && (
    !String(body.purchase_token || '').trim()
    || !String(body.product_id || '').trim()
    || !['subscription', 'non_consumable', 'consumable'].includes(String(body.product_type || ''))
  )) {
    throw publicError('receipt_required', 'purchase_token, product_id and product_type are required for Google');
  }
  return {
    project_id: projectId,
    customer_id: customerId,
    store: store as ReceiptRequest['store'],
    environment: environment as BillingEnvironment,
    signed_transaction: body.signed_transaction ? String(body.signed_transaction) : undefined,
    purchase_token: body.purchase_token ? String(body.purchase_token) : undefined,
    product_id: body.product_id ? String(body.product_id) : undefined,
    product_type: body.product_type as ReceiptRequest['product_type'],
  };
}

export function publicError(code: string, message: string, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

type BillingSecretEnv = Pick<
  BillingEnv,
  | 'STORE_CREDENTIALS_ENCRYPTION_KEYS'
  | 'STORE_CREDENTIALS_ENCRYPTION_KEY'
  | 'PURCHASES_SIGNING_KEYSET'
  | 'APPLE_ROOT_CERTIFICATES_B64'
  | 'OPENGROW_VOCOSTAR_WEBHOOK_SECRET'
>;

export function billingSecretReadiness(env: BillingSecretEnv) {
  const missing: string[] = [];
  if (!env.STORE_CREDENTIALS_ENCRYPTION_KEYS && !env.STORE_CREDENTIALS_ENCRYPTION_KEY) {
    missing.push('STORE_CREDENTIALS_ENCRYPTION_KEYS');
  }
  if (!env.PURCHASES_SIGNING_KEYSET) missing.push('PURCHASES_SIGNING_KEYSET');
  if (!env.APPLE_ROOT_CERTIFICATES_B64) missing.push('APPLE_ROOT_CERTIFICATES_B64');
  if (!env.OPENGROW_VOCOSTAR_WEBHOOK_SECRET) missing.push('OPENGROW_VOCOSTAR_WEBHOOK_SECRET');
  return { ready: missing.length === 0, missing };
}
