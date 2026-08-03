import { Env } from '../types';
import { processPushNotifications } from '../routes/push';
import { publishApprovedReviewDraft, syncStoreReviews } from './store-reviews';
import { dispatchBillingJob, isBillingQueueJob, type BillingQueueJob } from './billing-dispatch';
import { deliverGrowthAutomation, evaluatePaywallAbandonment } from './growth-delivery';
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
  | BillingQueueJob
  | { type: 'reputation.reviews.sync'; projectId: string }
  | { type: 'reputation.review-response.publish'; draftId: string }
  | { type: 'growth.automation.deliver'; projectId: string; runId: string }
  | { type: 'growth.paywall-abandonment.evaluate'; projectId: string; paywallEventId: string };

export async function dispatchQueueJob(env: Env, job: QueueJob | any) {
  if (isBillingQueueJob(job)) return dispatchBillingJob(env, job);
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
    case 'reputation.reviews.sync':
      return syncStoreReviews(env, String(job.projectId));
    case 'reputation.review-response.publish':
      return publishApprovedReviewDraft(env, String(job.draftId));
    case 'growth.automation.deliver':
      return deliverGrowthAutomation(env, String(job.projectId), String(job.runId));
    case 'growth.paywall-abandonment.evaluate':
      return evaluatePaywallAbandonment(env, String(job.projectId), String(job.paywallEventId));
    default:
      throw new Error(`Unsupported queue job: ${job?.type || 'unknown'}`);
  }
}
