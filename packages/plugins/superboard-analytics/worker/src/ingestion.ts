import {
	ANALYTICS_SCHEMA_VERSION,
	stableAnalyticsJson,
	type AnalyticsEventV1,
	type AnalyticsIngestResultV1,
	type AnalyticsQueueMessageV1,
} from "@superboard/contracts/analytics";
import type { ProjectContext } from "@superboard/contracts/project-context";

import { analyticsPayloadHash, pseudonymizeEvent } from "./crypto";
import { httpError } from "./http";
import { projectStoredEvent } from "./projections";
import type { Env, EventReceipt, OutboxRow } from "./types";

const OUTBOX_RETRY_SECONDS = 60;

// D1 rejects statements with more than 100 bound parameters.
const D1_MAX_BOUND_PARAMETERS = 100;
// Cloudflare Queues accept at most 100 messages per sendBatch call.
const QUEUE_SEND_BATCH_LIMIT = 100;

type PendingIngest = {
	event: AnalyticsEventV1;
	payloadHash: string;
	outbox: OutboxRow;
};

export async function ingestAnalyticsEvents(
	env: Env,
	project: ProjectContext,
	events: AnalyticsEventV1[],
	options: { coreCollection?: boolean } = {},
): Promise<AnalyticsIngestResultV1[]> {
	const projectId = String(project.projectId);
	if (project.role !== "system" && !(await dataCollectionEnabled(env.DB, projectId))) {
		return events.map((event) => ({
			event_id: event.event_id,
			status: "rejected",
			code: "analytics_collection_disabled",
		}));
	}
	const coreCollection = options.coreCollection === true;
	const [inactiveApplications, receipts, payloadHashes] = await Promise.all([
		project.role === "system"
			? Promise.resolve(new Set<string>())
			: disabledApplications(env.DB, projectId, events),
		receiptsByEventId(
			env.DB,
			projectId,
			events.map((event) => event.event_id),
		),
		Promise.all(events.map((event) => analyticsPayloadHash(event))),
	]);

	const results: Array<AnalyticsIngestResultV1 | null> = [];
	const pending: PendingIngest[] = [];
	const pendingIndexes: number[] = [];
	// Mirrors the receipt check for repeated event_ids inside one batch.
	const claimed = new Map<string, string>();
	for (const [index, event] of events.entries()) {
		const payloadHash = payloadHashes[index];
		if (payloadHash === undefined) throw new Error("analytics_payload_hash_missing");
		if (inactiveApplications.has(event.application_id)) {
			results.push({
				event_id: event.event_id,
				status: "rejected",
				code: "analytics_application_disabled",
			});
			continue;
		}
		const existing = receipts.get(event.event_id);
		if (existing) {
			results.push(replayResult(existing, payloadHash));
			continue;
		}
		const claimedHash = claimed.get(event.event_id);
		if (claimedHash !== undefined) {
			results.push(
				replayResult({ event_id: event.event_id, payload_sha256: claimedHash }, payloadHash),
			);
			continue;
		}
		claimed.set(event.event_id, payloadHash);
		const stored = {
			...(await pseudonymizeEvent(env, projectId, event)),
			...(coreCollection ? { core_collection: true } : {}),
		};
		pending.push({
			event,
			payloadHash,
			outbox: {
				id: crypto.randomUUID(),
				project_id: projectId,
				project_ref: project.projectRef,
				instance_id: project.instanceId,
				environment: project.environment,
				event_id: event.event_id,
				payload_json: stableAnalyticsJson(stored),
				status: "pending",
				attempt_count: 0,
			},
		});
		pendingIndexes.push(results.length);
		results.push(null);
	}

	const inserted = await insertPending(env.DB, pending);
	const accepted: OutboxRow[] = [];
	for (const [position, entry] of pending.entries()) {
		const result = inserted[position];
		const resultIndex = pendingIndexes[position];
		if (result === undefined || resultIndex === undefined) {
			throw new Error("analytics_insert_result_missing");
		}
		results[resultIndex] = result;
		if (result.status === "accepted") accepted.push(entry.outbox);
	}
	await dispatchOutboxRows(env, accepted);
	// Every placeholder was filled above; the guard only narrows the type.
	return results.map((result) => {
		if (result === null) throw new Error("analytics_insert_result_missing");
		return result;
	});
}

async function disabledApplications(
	db: D1Database,
	projectId: string,
	events: AnalyticsEventV1[],
): Promise<Set<string>> {
	const applicationIds = [...new Set(events.map((event) => event.application_id))];
	const disabled = new Set<string>();
	for (const chunk of chunks(applicationIds, D1_MAX_BOUND_PARAMETERS - 1)) {
		const placeholders = chunk.map(() => "?").join(", ");
		const rows = await db
			.prepare(
				`SELECT application_id FROM analytics_applications
         WHERE project_id = ? AND active = 0
           AND application_id IN (${placeholders})`,
			)
			.bind(projectId, ...chunk)
			.all<{ application_id: string }>();
		for (const row of rows.results) disabled.add(row.application_id);
	}
	return disabled;
}

async function dataCollectionEnabled(db: D1Database, projectId: string): Promise<boolean> {
	const row = await db
		.prepare("SELECT data_collection_enabled FROM analytics_project_settings WHERE project_id = ?")
		.bind(projectId)
		.first<{ data_collection_enabled: number }>();
	return row == null || Number(row.data_collection_enabled) === 1;
}

function insertStatements(db: D1Database, entry: PendingIngest): D1PreparedStatement[] {
	const { event, payloadHash, outbox } = entry;
	return [
		db
			.prepare(
				`INSERT INTO analytics_event_receipts
        (project_id, event_id, payload_sha256, event_name, event_source, application_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				outbox.project_id,
				event.event_id,
				payloadHash,
				event.event_name,
				event.source,
				event.application_id,
				event.occurred_at,
			),
		db
			.prepare(
				`INSERT INTO analytics_ingest_outbox
        (id, project_id, project_ref, instance_id, environment, event_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				outbox.id,
				outbox.project_id,
				outbox.project_ref,
				outbox.instance_id,
				outbox.environment,
				event.event_id,
				outbox.payload_json,
			),
	];
}

async function insertPending(
	db: D1Database,
	pending: PendingIngest[],
): Promise<AnalyticsIngestResultV1[]> {
	if (pending.length === 0) return [];
	const accepted = (entry: PendingIngest): AnalyticsIngestResultV1 => ({
		event_id: entry.event.event_id,
		status: "accepted",
	});
	try {
		await db.batch(pending.flatMap((entry) => insertStatements(db, entry)));
		return pending.map(accepted);
	} catch (error) {
		// The batch is atomic, so a concurrent writer claiming one event_id rolls
		// back the whole batch. Retry per event to keep per-event replay results.
		const [only] = pending;
		if (pending.length === 1 && only) {
			return [await resolveInsertConflict(db, only, error)];
		}
	}
	const results: AnalyticsIngestResultV1[] = [];
	for (const entry of pending) {
		try {
			await db.batch(insertStatements(db, entry));
			results.push(accepted(entry));
		} catch (error) {
			results.push(await resolveInsertConflict(db, entry, error));
		}
	}
	return results;
}

async function resolveInsertConflict(
	db: D1Database,
	entry: PendingIngest,
	error: unknown,
): Promise<AnalyticsIngestResultV1> {
	const concurrent = await receipt(db, entry.outbox.project_id, entry.event.event_id);
	if (concurrent) return replayResult(concurrent, entry.payloadHash);
	throw error;
}

function replayResult(
	existing: Pick<EventReceipt, "event_id" | "payload_sha256">,
	payloadHash: string,
): AnalyticsIngestResultV1 {
	if (existing.payload_sha256 === payloadHash) {
		return { event_id: existing.event_id, status: "duplicate" };
	}
	return {
		event_id: existing.event_id,
		status: "rejected",
		code: "analytics_event_id_conflict",
	};
}

async function receipt(
	db: D1Database,
	projectId: string,
	eventId: string,
): Promise<EventReceipt | null> {
	return db
		.prepare(
			`SELECT project_id, event_id, payload_sha256, status, archive_key
       FROM analytics_event_receipts WHERE project_id = ? AND event_id = ?`,
		)
		.bind(projectId, eventId)
		.first<EventReceipt>();
}

async function receiptsByEventId(
	db: D1Database,
	projectId: string,
	eventIds: string[],
): Promise<Map<string, EventReceipt>> {
	const receipts = new Map<string, EventReceipt>();
	const uniqueIds = [...new Set(eventIds)];
	for (const chunk of chunks(uniqueIds, D1_MAX_BOUND_PARAMETERS - 1)) {
		const placeholders = chunk.map(() => "?").join(", ");
		const rows = await db
			.prepare(
				`SELECT project_id, event_id, payload_sha256, status, archive_key
         FROM analytics_event_receipts
         WHERE project_id = ? AND event_id IN (${placeholders})`,
			)
			.bind(projectId, ...chunk)
			.all<EventReceipt>();
		for (const row of rows.results) receipts.set(row.event_id, row);
	}
	return receipts;
}

function chunks<T>(values: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

export async function drainAnalyticsOutbox(env: Env, maximum = 100): Promise<number> {
	const rows = await env.DB.prepare(
		`SELECT id, project_id, project_ref, instance_id, environment,
      event_id, payload_json, status, attempt_count
     FROM analytics_ingest_outbox
     WHERE (
       (status = 'pending' AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       OR (status IN ('dispatched', 'processing') AND updated_at <= datetime('now', '-5 minutes'))
     )
     ORDER BY created_at ASC LIMIT ?`,
	)
		.bind(Math.max(1, Math.min(maximum, 250)))
		.all<OutboxRow>();
	await dispatchOutboxRows(env, rows.results);
	return rows.results.length;
}

async function dispatchOutboxRows(env: Env, rows: OutboxRow[]): Promise<void> {
	for (const chunk of chunks(rows, QUEUE_SEND_BATCH_LIMIT)) {
		await dispatchOutboxChunk(env, chunk);
	}
}

async function dispatchOutboxChunk(env: Env, rows: OutboxRow[]): Promise<void> {
	if (rows.length === 0) return;
	const ids = rows.map((row) => row.id);
	const placeholders = ids.map(() => "?").join(", ");
	try {
		await env.ANALYTICS_INGEST_QUEUE.sendBatch(
			rows.map((row) => ({
				body: {
					schema_version: ANALYTICS_SCHEMA_VERSION,
					type: "analytics.event.project",
					project_id: row.project_id,
					event_id: row.event_id,
				} satisfies AnalyticsQueueMessageV1,
				contentType: "json" as const,
			})),
		);
		await env.DB.prepare(
			`UPDATE analytics_ingest_outbox
       SET status = 'dispatched', dispatched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = NULL
       WHERE id IN (${placeholders}) AND status != 'completed'`,
		)
			.bind(...ids)
			.run();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Two extra bound parameters leave room for 98 ids per retry statement.
		for (const retryIds of chunks(ids, D1_MAX_BOUND_PARAMETERS - 2)) {
			await env.DB.prepare(
				`UPDATE analytics_ingest_outbox
         SET status = 'pending', attempt_count = attempt_count + 1,
             available_at = datetime('now', ?), last_error = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id IN (${retryIds.map(() => "?").join(", ")}) AND status != 'completed'`,
			)
				.bind(`+${OUTBOX_RETRY_SECONDS} seconds`, message.slice(0, 2_000), ...retryIds)
				.run();
		}
		for (const row of rows) {
			console.error(
				JSON.stringify({
					event: "analytics_outbox_dispatch_failed",
					project_id: row.project_id,
					event_id: row.event_id,
					error: message,
				}),
			);
		}
	}
}

export async function handleAnalyticsQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
	if (batch.queue === env.DLQ_NAME) {
		await quarantineDeadLetters(batch, env);
		return;
	}
	for (const message of batch.messages) {
		if (!isAnalyticsQueueMessage(message.body)) {
			console.error(
				JSON.stringify({
					event: "analytics_queue_message_rejected",
					message_id: message.id,
				}),
			);
			message.ack();
			continue;
		}
		try {
			await processAnalyticsQueueMessage(env, message.body);
			message.ack();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			await env.DB.prepare(
				`UPDATE analytics_ingest_outbox
         SET status = 'processing', attempt_count = attempt_count + 1,
             last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE project_id = ? AND event_id = ? AND status != 'completed'`,
			)
				.bind(errorMessage.slice(0, 2_000), message.body.project_id, message.body.event_id)
				.run();
			console.error(
				JSON.stringify({
					event: "analytics_queue_projection_failed",
					message_id: message.id,
					project_id: message.body.project_id,
					event_id: message.body.event_id,
					attempt: message.attempts,
					error: errorMessage,
				}),
			);
			message.retry({
				delaySeconds: Math.min(900, 15 * 2 ** Math.min(message.attempts, 6)),
			});
		}
	}
}

async function processAnalyticsQueueMessage(
	env: Env,
	message: AnalyticsQueueMessageV1,
): Promise<void> {
	const row = await env.DB.prepare(
		`SELECT id, project_id, project_ref, instance_id, environment,
      event_id, payload_json, status, attempt_count
     FROM analytics_ingest_outbox WHERE project_id = ? AND event_id = ?`,
	)
		.bind(message.project_id, message.event_id)
		.first<OutboxRow>();
	if (!row || row.status === "completed") return;
	let stored: unknown;
	try {
		stored = JSON.parse(row.payload_json);
	} catch {
		throw httpError("analytics_outbox_payload_invalid", "Stored analytics payload is invalid", 500);
	}
	await projectStoredEvent(env, row, stored);
}

async function quarantineDeadLetters(batch: MessageBatch<unknown>, env: Env): Promise<void> {
	for (const message of batch.messages) {
		try {
			const body = isAnalyticsQueueMessage(message.body) ? message.body : null;
			await env.DB.batch([
				env.DB.prepare(
					`INSERT OR IGNORE INTO analytics_dead_letters
            (id, project_id, event_id, source_queue, message_id, payload_json, attempts)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
				).bind(
					crypto.randomUUID(),
					body?.project_id ?? null,
					body?.event_id ?? null,
					batch.queue,
					message.id,
					stableAnalyticsJson(message.body),
					message.attempts,
				),
				env.DB.prepare(
					`UPDATE analytics_ingest_outbox
           SET status = 'dead_letter', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE project_id = ? AND event_id = ? AND status != 'completed'`,
				).bind(body?.project_id ?? "", body?.event_id ?? ""),
				env.DB.prepare(
					`UPDATE analytics_event_receipts
           SET status = 'dead_letter', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE project_id = ? AND event_id = ? AND status != 'projected'`,
				).bind(body?.project_id ?? "", body?.event_id ?? ""),
			]);
			message.ack();
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "analytics_dead_letter_persistence_failed",
					message_id: message.id,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
			message.retry({ delaySeconds: 60 });
		}
	}
}

export function isAnalyticsQueueMessage(value: unknown): value is AnalyticsQueueMessageV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const message = value as Record<string, unknown>;
	return (
		message.schema_version === ANALYTICS_SCHEMA_VERSION &&
		message.type === "analytics.event.project" &&
		typeof message.project_id === "string" &&
		message.project_id.length > 0 &&
		typeof message.event_id === "string" &&
		message.event_id.length > 0
	);
}
