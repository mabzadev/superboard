import { consumeCoreCollection } from "@superboard/contracts/core-collection";

import { ingestAnalyticsEvents } from "./ingestion.js";
import type { Env } from "./types.js";

export async function collectAnalyticsProjection(env: Env) {
	const policies = new Map<string, { enabled: number; active: number }>();
	return consumeCoreCollection(env, "superboard-analytics", async (item) => {
		const policyKey = `${item.project.projectId}:${item.event.application_id}`;
		let policy = policies.get(policyKey);
		if (!policy) {
			policy = (await env.DB.prepare(`SELECT
			 COALESCE((SELECT data_collection_enabled FROM analytics_project_settings WHERE project_id=?),1) enabled,
			 COALESCE((SELECT active FROM analytics_applications WHERE project_id=? AND application_id=?),1) active`)
				.bind(
					String(item.project.projectId),
					String(item.project.projectId),
					item.event.application_id,
				)
				.first<{ enabled: number; active: number }>()) ?? { enabled: 1, active: 1 };
			policies.set(policyKey, policy);
		}
		if (policy.enabled !== 1) return false;
		if (policy.active !== 1) return true;
		const customer = item.event.properties.customer_event;
		const event =
			item.format === "customer" &&
			customer &&
			typeof customer === "object" &&
			!Array.isArray(customer)
				? { ...item.event, properties: customerProperties(customer) }
				: item.event;
		const results = await ingestAnalyticsEvents(
			env,
			{
				...item.project,
				actorId: 0,
				role: item.trusted ? "system" : "sdk",
				requestId: `collection-${item.sequence}`,
				issuedAt: Math.floor(Date.now() / 1000),
			},
			[event],
			{ coreCollection: true },
		);
		return (
			results.length === 1 &&
			(results[0]?.status !== "rejected" || results[0]?.code === "analytics_application_disabled")
		);
	});
}

function customerProperties(customer: object): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if ("engagement_time" in customer) result.engagement_time = customer.engagement_time;
	if ("revenue_cents" in customer) result.reported_revenue_cents = customer.revenue_cents;
	return result;
}
