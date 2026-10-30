import { consumeCoreCollection } from "@superboard/contracts/core-collection";

import { marketingIdentityHashCandidates } from "./identity.js";
import { acceptMarketingSignal } from "./journeys.js";
import type { Env } from "./types.js";

export async function collectMarketingSignals(env: Env) {
	return consumeCoreCollection(env, "superboard-marketing", async (item) => {
		const event = item.event;
		const kind = event.user_id ? "user" : event.anonymous_id ? "anonymous" : "instance";
		const identity = event.user_id ?? event.anonymous_id ?? event.app_instance_id;
		const hashes = identity
			? await marketingIdentityHashCandidates(env, item.project.projectId, kind, identity)
			: [];
		const properties =
			item.format === "customer"
				? customerProperties(event.properties.customer_event)
				: event.properties;
		await acceptMarketingSignal(
			env,
			{
				...item.project,
				actorId: 0,
				role: "system",
				requestId: `collection-${item.sequence}`,
				issuedAt: Math.floor(Date.now() / 1000),
			},
			{
				schema_version: 1,
				event_id: event.event_id,
				event_name: event.event_name,
				application_id: event.application_id,
				subject_hash: hashes[0] ?? null,
				properties,
				occurred_at: event.occurred_at,
			},
			"core_collection",
		);
		return true;
	});
}

function customerProperties(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const result: Record<string, unknown> = {};
	if ("engagement_time" in value) result.engagement_time = value.engagement_time;
	if ("revenue_cents" in value) result.reported_revenue_cents = value.revenue_cents;
	if ("metadata" in value) result.metadata = value.metadata;
	return result;
}
