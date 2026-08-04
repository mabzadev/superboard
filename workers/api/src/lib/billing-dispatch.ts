import type { BillingEnv } from '../types';
import { processBillingExport } from './billing-exports';
import {
  deliverBillingWebhook,
  processAppleBillingNotification,
  processGoogleBillingNotification,
  reconcileBillingState,
  reconcileStoreSubscription,
} from './billing-jobs';
import { processStripeBillingNotification } from '../routes/purchases-provider-webhooks';
import { executeRefundProviderAction } from './refund-actions';
import { processLegacyInventoryPage } from './legacy-subscription-inventory';
import { reconcileGoogleVoidedPurchases } from './google-voided-purchases';
import { reconcileStripeCatalog } from './stripe-catalog-reconciliation';

export type BillingQueueJob =
  | { type: 'billing.reconcile' }
  | { type: 'billing.webhook.deliver'; deliveryId: string }
  | { type: 'billing.apple.notification'; eventId: string; projectId: string; signedPayload: string; environment: 'sandbox' | 'production' }
  | { type: 'billing.google.notification'; eventId: string; projectId: string; purchaseToken: string; productId: string; productType: 'subscription' | 'non_consumable' | 'consumable'; eventType: string; eventOccurredAt: string; environment: 'sandbox' | 'production' }
  | { type: 'billing.google.voided.reconcile'; projectId: string }
  | { type: 'billing.stripe.notification'; eventId: string; connectionId: string }
  | { type: 'billing.stripe.catalog.reconcile'; projectId: string; environment: 'sandbox' | 'production' }
  | { type: 'billing.subscription.reconcile'; subscriptionId: string }
  | { type: 'billing.refund.action.execute'; actionId: string }
  | { type: 'billing.legacy.inventory.page'; runId: string; cursor?: string }
  | { type: 'billing.export'; exportId: string };

const BILLING_JOB_TYPES = new Set<BillingQueueJob['type']>([
  'billing.reconcile',
  'billing.webhook.deliver',
  'billing.apple.notification',
  'billing.google.notification',
  'billing.google.voided.reconcile',
  'billing.stripe.notification',
  'billing.stripe.catalog.reconcile',
  'billing.subscription.reconcile',
  'billing.refund.action.execute',
  'billing.legacy.inventory.page',
  'billing.export',
]);

export function isBillingQueueJob(value: unknown): value is BillingQueueJob {
  if (!value || typeof value !== 'object') return false;
  return BILLING_JOB_TYPES.has((value as { type?: BillingQueueJob['type'] }).type as BillingQueueJob['type']);
}

export async function dispatchBillingJob(env: BillingEnv, job: BillingQueueJob) {
  switch (job.type) {
    case 'billing.reconcile':
      return reconcileBillingState(env);
    case 'billing.webhook.deliver':
      return deliverBillingWebhook(env, String(job.deliveryId));
    case 'billing.apple.notification':
      return processAppleBillingNotification(env, job);
    case 'billing.google.notification':
      return processGoogleBillingNotification(env, job);
    case 'billing.google.voided.reconcile':
      return reconcileGoogleVoidedPurchases(env, String(job.projectId));
    case 'billing.stripe.notification':
      return processStripeBillingNotification(env, job);
    case 'billing.stripe.catalog.reconcile':
      return reconcileStripeCatalog(env, String(job.projectId), job.environment);
    case 'billing.subscription.reconcile':
      return reconcileStoreSubscription(env, String(job.subscriptionId));
    case 'billing.refund.action.execute':
      return executeRefundProviderAction(env, String(job.actionId));
    case 'billing.legacy.inventory.page':
      return processLegacyInventoryPage(env, String(job.runId), job.cursor ? String(job.cursor) : undefined);
    case 'billing.export':
      return processBillingExport(env, String(job.exportId));
    default:
      throw new Error(`Unsupported billing queue job: ${(job as { type?: string }).type || 'unknown'}`);
  }
}
