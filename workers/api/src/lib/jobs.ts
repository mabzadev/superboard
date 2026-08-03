import { Env } from '../types';
import { deliverBillingWebhook, processAppleBillingNotification, processGoogleBillingNotification, reconcileBillingState, reconcileStoreSubscription } from './billing-jobs';
import { processPushNotifications } from '../routes/push';
import { processBillingExport } from './billing-exports';
import { publishApprovedReviewDraft, syncStoreReviews } from './store-reviews';
import {
  cleanupExpiredMcp,
  cleanupOrphanedActions,
  mergeDuplicateVisitors,
  precomputeEnterpriseMau,
  runMaintenance,
  updateQuotaStates,
} from './maintenance';

export type QueueJob =
  | { type: 'maintenance.run'; days?: number }
  | { type: 'events.aggregate'; days?: number }
  | { type: 'push.process'; limit?: number }
  | { type: 'mcp.cleanup' }
  | { type: 'quota.update' }
  | { type: 'visitor.merge' }
  | { type: 'actions.cleanup' }
  | { type: 'enterprise_mau.precompute' }
  | { type: 'billing.reconcile' }
  | { type: 'billing.webhook.deliver'; deliveryId: string }
  | { type: 'billing.apple.notification'; eventId: string; projectId: string; signedPayload: string; environment: 'sandbox' | 'production' }
  | { type: 'billing.google.notification'; eventId: string; projectId: string; purchaseToken: string; productId: string; productType: 'subscription' | 'non_consumable' | 'consumable'; eventType: string; eventOccurredAt: string }
  | { type: 'billing.subscription.reconcile'; subscriptionId: string }
  | { type: 'billing.export'; exportId: string }
  | { type: 'reputation.reviews.sync'; projectId: string }
  | { type: 'reputation.review-response.publish'; draftId: string };

export async function dispatchQueueJob(env: Env, job: QueueJob | any) {
  switch (job?.type) {
    case 'maintenance.run':
      return runMaintenance(env, Math.max(1, Math.min(14, Number(job.days || 3))));
    case 'events.aggregate':
      return runMaintenance(env, Math.max(1, Math.min(14, Number(job.days || 3))));
    case 'push.process':
      return processPushNotifications(env, Math.max(1, Math.min(100, Number(job.limit || 25))));
    case 'mcp.cleanup':
      return cleanupExpiredMcp(env.DB);
    case 'quota.update':
      return updateQuotaStates(env);
    case 'visitor.merge':
      return { merged: await mergeDuplicateVisitors(env.DB) };
    case 'actions.cleanup':
      return { deleted: await cleanupOrphanedActions(env.DB) };
    case 'enterprise_mau.precompute':
      return { updated: await precomputeEnterpriseMau(env) };
    case 'billing.reconcile':
      return reconcileBillingState(env);
    case 'billing.webhook.deliver':
      return deliverBillingWebhook(env, String(job.deliveryId));
    case 'billing.apple.notification':
      return processAppleBillingNotification(env, job);
    case 'billing.google.notification':
      return processGoogleBillingNotification(env, job);
    case 'billing.subscription.reconcile':
      return reconcileStoreSubscription(env, String(job.subscriptionId));
    case 'billing.export':
      return processBillingExport(env, String(job.exportId));
    case 'reputation.reviews.sync':
      return syncStoreReviews(env, String(job.projectId));
    case 'reputation.review-response.publish':
      return publishApprovedReviewDraft(env, String(job.draftId));
    default:
      throw new Error(`Unsupported queue job: ${job?.type || 'unknown'}`);
  }
}
