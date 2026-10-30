import { consumeCoreCollection } from "@superboard/contracts/core-collection";

const customerEvents = [
	"view",
	"open",
	"install",
	"reinstall",
	"reactivation",
	"app_open",
	"user_referred",
	"time_spent",
	"purchase",
	"refund",
].map((type) => `customer.${type}`);

export async function collectCustomerProjection(env: Env) {
	return consumeCoreCollection(
		env,
		"supbrd-core",
		async (item) => {
			if (item.format !== "customer") return true;
			const value = item.event.properties?.customer_event;
			if (!value || typeof value !== "object" || Array.isArray(value)) return false;
			const event: Record<string, unknown> = Object.fromEntries(Object.entries(value));
			for (const id of [event.customer_id, event.referrer_customer_id]) {
				if (
					typeof id === "string" &&
					!(await env.DB.prepare("SELECT id FROM customers WHERE project_id=? AND id=?")
						.bind(String(item.project.projectId), id)
						.first())
				)
					return false;
			}
			await env.DB.prepare(
				`INSERT OR IGNORE INTO customer_events (id,project_id,customer_id,referrer_customer_id,event_type,platform,occurred_at,revenue_cents,engagement_time,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?)`,
			)
				.bind(
					String(event.id),
					String(item.project.projectId),
					event.customer_id ?? null,
					event.referrer_customer_id ?? null,
					String(event.type),
					event.platform ?? null,
					String(event.occurred_at),
					event.revenue_cents ?? 0,
					event.engagement_time ?? 0,
					JSON.stringify(event.metadata ?? {}),
				)
				.run();
			return true;
		},
		customerEvents,
	);
}
