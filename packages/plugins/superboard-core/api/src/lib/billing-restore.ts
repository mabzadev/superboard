import type { BillingEnv } from '../types';
import { applyVerifiedPurchase, type BillingEnvironment } from './billing';
import { finalizeGooglePurchase, verifyAppleTransaction, verifyGooglePurchase } from './store-verification';

export type RestoreRequest = {
  projectId: string | number;
  customerId: string;
  environment: BillingEnvironment;
  appleTransactions: unknown;
  googlePurchases: unknown;
};

export async function restoreVerifiedPurchases(env: BillingEnv, request: RestoreRequest) {
  const apple = boundedArray(request.appleTransactions, 'apple_transactions');
  const google = boundedArray(request.googlePurchases, 'google_purchases');
  const settings = await env.DB.prepare('SELECT restore_behavior FROM billing_project_settings WHERE project_id = ?')
    .bind(String(request.projectId)).first<{ restore_behavior?: string }>();
  const allowTransfer = settings?.restore_behavior !== 'block';
  const restored: Array<Record<string, unknown>> = [];

  for (const value of apple) {
    const signedTransaction = typeof value === 'string' ? value.trim() : '';
    if (!signedTransaction) throw restoreError('restore_apple_transaction_invalid', 'Every Apple transaction must be a non-empty string');
    const verified = await verifyAppleTransaction(env, {
      projectId: request.projectId,
      customerId: request.customerId,
      signedTransaction,
      environment: request.environment,
      allowTransfer,
    });
    const applied = await applyVerifiedPurchase(env, verified.purchase);
    restored.push({ store: 'apple', transaction_id: applied.transactionId, duplicate: applied.duplicate });
  }

  for (const value of google) {
    const item = object(value);
    const purchaseToken = text(item.purchase_token);
    const productId = text(item.product_id);
    const productType = text(item.product_type);
    if (!purchaseToken || !productId) {
      throw restoreError('restore_google_purchase_invalid', 'Every Google purchase requires purchase_token and product_id');
    }
    const verified = await verifyGooglePurchase(env, {
      projectId: request.projectId,
      customerId: request.customerId,
      purchaseToken,
      storeProductId: productId,
      productType: ['subscription', 'non_consumable', 'consumable'].includes(productType)
        ? productType as 'subscription' | 'non_consumable' | 'consumable'
        : undefined,
      environment: request.environment,
      allowTransfer,
    });
    const applied = await applyVerifiedPurchase(env, verified.purchase);
    await finalizeGooglePurchase(verified);
    restored.push({ store: 'google', transaction_id: applied.transactionId, duplicate: applied.duplicate });
  }

  return restored;
}

function boundedArray(value: unknown, field: string) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw restoreError('restore_payload_invalid', `${field} must be an array`);
  if (value.length > 100) throw restoreError('restore_payload_too_large', `${field} is limited to 100 items`, 413);
  return value;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function restoreError(code: string, message: string, status = 422) {
  return Object.assign(new Error(message), { code, status, retryable: false });
}
