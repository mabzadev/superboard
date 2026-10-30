import { stableAnalyticsJson, type AnalyticsEventV1 } from "@superboard/contracts/analytics";

export function enqueueAnalyticsFactStatement(
	db: D1Database,
	params: {
		projectId: string | number;
		factKey: string;
		event: AnalyticsEventV1;
	},
): D1PreparedStatement {
	return db
		.prepare(
			`INSERT OR IGNORE INTO analytics_fact_outbox
        (id, project_id, fact_key, event_id, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
		)
		.bind(
			crypto.randomUUID(),
			String(params.projectId),
			params.factKey,
			params.event.event_id,
			stableAnalyticsJson(params.event),
		);
}

export async function canonicalAnalyticsEventId(
	namespace: string,
	factKey: string,
): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${namespace}:${factKey}`)),
	);
	const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${namespace}-${hex}`;
}
