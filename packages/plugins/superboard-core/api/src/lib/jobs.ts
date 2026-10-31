import { processPushNotifications } from "../routes/push";
import { Env } from "../types";
import { dispatchBillingJob, isBillingQueueJob, type BillingQueueJob } from "./billing-dispatch";
import {
	cleanupExpiredMcp,
	cleanupOrphanedActions,
	mergeDuplicateVisitors,
	runMaintenance,
} from "./maintenance";

export type QueueJob =
	| { type: "maintenance.run"; days?: number }
	| { type: "events.aggregate"; days?: number }
	| { type: "push.process"; limit?: number }
	| { type: "mcp.cleanup" }
	| { type: "visitor.merge" }
	| { type: "actions.cleanup" }
	| BillingQueueJob;

/** Reads the `days` field of a loosely typed maintenance job, clamped to 1-14. */
function maintenanceDays(job: unknown): number {
	const days = job && typeof job === "object" && "days" in job ? job.days : undefined;
	return Math.max(1, Math.min(14, Number(days || 3)));
}

export async function dispatchQueueJob(env: Env, job: QueueJob | any) {
	if (isBillingQueueJob(job)) return dispatchBillingJob(env, job);
	switch (job?.type) {
		case "maintenance.run":
			// Only the scheduled handler enqueues this job; aggregate incrementally.
			return runMaintenance(env, maintenanceDays(job), { incremental: true });
		case "events.aggregate":
			return runMaintenance(env, maintenanceDays(job));
		case "push.process":
			return processPushNotifications(env, Math.max(1, Math.min(100, Number(job.limit || 25))));
		case "mcp.cleanup":
			return cleanupExpiredMcp(env.DB);
		case "visitor.merge":
			return { merged: await mergeDuplicateVisitors(env.DB) };
		case "actions.cleanup":
			return { deleted: await cleanupOrphanedActions(env.DB) };
		default:
			throw new Error(`Unsupported queue job: ${job?.type || "unknown"}`);
	}
}
