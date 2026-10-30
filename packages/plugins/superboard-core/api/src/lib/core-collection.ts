import {
	parseAnalyticsEventV1,
	stableAnalyticsJson,
	type AnalyticsEventV1,
} from "@superboard/contracts/analytics";
import type { CollectedEvent, CollectionPage } from "@superboard/contracts/core-collection";

export class CollectionError extends Error {
	constructor(
		readonly code:
			| "collection_batch_invalid"
			| "collection_event_too_large"
			| "collection_event_id_conflict",
		readonly status: 409 | 413 | 422,
	) {
		super(code);
	}
}

export async function collectEvents(
	db: D1Database,
	projectId: number,
	events: AnalyticsEventV1[],
	format: "analytics" | "customer" = "analytics",
): Promise<Array<{ event_id: string; status: "accepted" | "duplicate" }>> {
	if (events.length < 1 || events.length > 100)
		throw new CollectionError("collection_batch_invalid", 422);
	const values = events.map((event) => ({
		event,
		key: `${format}:${event.event_id}`,
		payload: stableAnalyticsJson(event),
	}));
	if (values.some(({ payload }) => new TextEncoder().encode(payload).byteLength > 65536))
		throw new CollectionError("collection_event_too_large", 413);
	const existing = new Map<string, string>();
	for (let start = 0; start < values.length; start += 50) {
		const keys = values.slice(start, start + 50).map(({ key }) => key);
		const rows = await db
			.prepare(
				`SELECT collection_key,payload_json FROM core_collected_events WHERE project_id=? AND collection_key IN (${keys.map(() => "?").join(",")})`,
			)
			.bind(String(projectId), ...keys)
			.all<{ collection_key: string; payload_json: string }>();
		for (const row of rows.results) existing.set(row.collection_key, row.payload_json);
	}
	const statements: D1PreparedStatement[] = [];
	const results: Array<{ event_id: string; status: "accepted" | "duplicate" }> = [];
	for (const { event, key, payload } of values) {
		const previous = existing.get(key);
		if (previous !== undefined && previous !== payload)
			throw new CollectionError("collection_event_id_conflict", 409);
		results.push({
			event_id: event.event_id,
			status: previous === undefined ? "accepted" : "duplicate",
		});
		if (previous !== undefined) continue;
		existing.set(key, payload);
		statements.push(
			db
				.prepare(`INSERT INTO core_collected_events
		 (project_id,collection_key,event_name,payload_json,trusted,format) VALUES (?,?,?,?,0,?)
		 ON CONFLICT(project_id,collection_key) DO UPDATE SET payload_json =
		 CASE WHEN core_collected_events.payload_json=excluded.payload_json
		 THEN core_collected_events.payload_json ELSE NULL END`)
				.bind(String(projectId), key, event.event_name, payload, format),
		);
	}
	if (statements.length) await db.batch(statements);
	return results;
}

export async function readCollectedEvents(
	db: D1Database,
	options: { projectId: number; after: number; limit: number; eventNames?: string[] },
): Promise<CollectionPage> {
	const { projectId, after } = options;
	if (
		!Number.isSafeInteger(projectId) ||
		projectId < 1 ||
		!Number.isSafeInteger(after) ||
		after < 0
	)
		throw new Error("collection_cursor_invalid");
	const limit = Math.min(100, Math.max(1, Math.trunc(options.limit) || 100));
	const names = options.eventNames ?? [];
	if (names.length > 20 || names.some((name) => name.length > 128))
		throw new Error("collection_filter_invalid");
	const filter = names.length ? ` AND e.event_name IN (${names.map(() => "?").join(",")})` : "";
	const rows = await db
		.prepare(
			`SELECT e.sequence,e.payload_json,e.trusted,e.format,e.received_at,p.id,p.instance_id,p.is_test
		 FROM core_collected_events e JOIN projects p ON p.id=e.project_id
		 WHERE e.project_id=? AND e.sequence>?${filter} ORDER BY e.sequence LIMIT ?`,
		)
		.bind(String(projectId), after, ...names, limit + 1)
		.all<{
			sequence: number;
			payload_json: string;
			trusted: number;
			format: "analytics" | "customer";
			received_at: string;
			id: number;
			instance_id: number;
			is_test: number;
		}>();
	const items: CollectedEvent[] = rows.results.slice(0, limit).map((row) => ({
		sequence: row.sequence,
		event: parseAnalyticsEventV1(JSON.parse(row.payload_json), {
			allowReserved: row.trusted === 1,
		}),
		trusted: row.trusted === 1,
		format: row.format,
		receivedAt: row.received_at,
		project: {
			projectId: row.id,
			instanceId: row.instance_id,
			projectRef: `${row.instance_id}-${row.is_test === 1 ? "test" : "prod"}`,
			environment: row.is_test === 1 ? "test" : "production",
		},
	}));
	return {
		items,
		nextCursor: items.at(-1)?.sequence ?? after,
		hasMore: rows.results.length > limit,
	};
}

export async function eraseCollectedSubject(
	db: D1Database,
	projectId: number,
	userId: string,
): Promise<void> {
	await db.batch([
		db
			.prepare(
				"DELETE FROM core_collected_events WHERE project_id=? AND (json_extract(payload_json,'$.user_id')=? OR json_extract(payload_json,'$.properties.customer_event.referrer_customer_id')=?)",
			)
			.bind(String(projectId), userId, userId),
		db
			.prepare(
				"DELETE FROM analytics_fact_outbox WHERE project_id=? AND json_extract(payload_json,'$.user_id')=?",
			)
			.bind(String(projectId), userId),
	]);
}
