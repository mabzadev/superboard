import { canonicalizeReleasePayload } from "@superboard/supbrd-core";

const pluginPattern = /^supbrd-(?:plug|plugmod)-[a-z0-9*]+(?:-[a-z0-9*]+)*$/u;

interface StoreRecordInput {
	plugin_id: string;
	store_id: string;
	instance_id?: string;
	projectId?: string;
	pid?: string;
	entity_type: string;
	entity_id: string;
	expected_revision: number | null;
	operation_id: string;
	payload: unknown;
	updated_at: string;
	encryption_key: CryptoKey;
}

interface StoreRecordRow {
	plugin_id: string;
	store_id: string;
	instance_id: string;
	entity_type: string;
	entity_id: string;
	revision: number;
	payload_json: string;
	payload_checksum: string;
	last_operation_id: string;
	updated_at: string;
}

export async function putPluginStoreRecord(db: D1Database, input: StoreRecordInput) {
	assertPlugin(input.plugin_id);
	const instanceId = resolveInstanceAlias(input);
	const canonicalPayload = canonicalizeReleasePayload(input.payload);
	const priorOperation = await db
		.prepare(
			`SELECT plugin_id, store_id, instance_id, entity_type, entity_id
			 FROM superboard_plugin_store_outbox WHERE operation_id = ?`,
		)
		.bind(input.operation_id)
		.first<{
			plugin_id: string;
			store_id: string;
			instance_id: string;
			entity_type: string;
			entity_id: string;
		}>();
	if (priorOperation) {
		if (
			priorOperation.plugin_id !== input.plugin_id ||
			priorOperation.store_id !== input.store_id ||
			priorOperation.instance_id !== instanceId ||
			priorOperation.entity_type !== input.entity_type ||
			priorOperation.entity_id !== input.entity_id
		) {
			throw new Error("IDEMPOTENCY_TARGET_CONFLICT");
		}
		const existing = await loadPluginStoreRecord(
			db,
			input.plugin_id,
			input.store_id,
			instanceId,
			input.entity_type,
			input.entity_id,
			input.encryption_key,
		);
		if (!existing) throw new Error("IDEMPOTENCY_RECEIPT_WITHOUT_RECORD");
		if (canonicalizeReleasePayload(existing.payload) !== canonicalPayload) {
			throw new Error("IDEMPOTENCY_PAYLOAD_CONFLICT");
		}
		return { ...existing, idempotent: true };
	}
	const current = await loadPluginStoreRecord(
		db,
		input.plugin_id,
		input.store_id,
		instanceId,
		input.entity_type,
		input.entity_id,
		input.encryption_key,
	);
	if (
		(current === null && input.expected_revision !== null) ||
		(current !== null && input.expected_revision !== current.revision)
	) {
		throw new Error("STORE_REVISION_CONFLICT");
	}

	const nextRevision = (input.expected_revision ?? 0) + 1;
	const payloadJson = canonicalizeReleasePayload(
		await encryptPayload(input.encryption_key, canonicalPayload),
	);
	const payloadChecksum = await sha256(payloadJson);
	const row = await db
		.prepare(
			`INSERT INTO superboard_plugin_store_records (
			   plugin_id, store_id, instance_id, entity_type, entity_id, revision,
			   payload_json, payload_checksum, last_operation_id, updated_at
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(plugin_id, store_id, instance_id, entity_type, entity_id) DO UPDATE SET
			   revision = excluded.revision,
			   payload_json = excluded.payload_json,
			   payload_checksum = excluded.payload_checksum,
			   last_operation_id = excluded.last_operation_id,
			   updated_at = excluded.updated_at
			 WHERE superboard_plugin_store_records.revision = ?
			 RETURNING *`,
		)
		.bind(
			input.plugin_id,
			input.store_id,
			instanceId,
			input.entity_type,
			input.entity_id,
			nextRevision,
			payloadJson,
			payloadChecksum,
			input.operation_id,
			input.updated_at,
			input.expected_revision,
		)
		.first<StoreRecordRow>();
	if (!row) throw new Error("STORE_REVISION_CONFLICT");
	return { ...(await toRecord(row, input.encryption_key)), idempotent: false };
}

export async function loadPluginStoreRecord(
	db: D1Database,
	pluginId: string,
	storeId: string,
	instanceId: string,
	entityType: string,
	entityId: string,
	encryptionKey: CryptoKey,
) {
	const row = await db
		.prepare(
			`SELECT * FROM superboard_plugin_store_records
			 WHERE plugin_id = ? AND store_id = ? AND instance_id = ?
			   AND entity_type = ? AND entity_id = ?`,
		)
		.bind(pluginId, storeId, instanceId, entityType, entityId)
		.first<StoreRecordRow>();
	return row ? toRecord(row, encryptionKey) : null;
}

export async function verifyPluginStoreShadowRead(db: D1Database, input: {
	plugin_id: string;
	entity_type: string;
	source: unknown[];
	target: unknown[];
	observed_at: string;
}) {
	const sourceChecksum = await sha256(canonicalizeReleasePayload(input.source));
	const targetChecksum = await sha256(canonicalizeReleasePayload(input.target));
	const matches = input.source.length === input.target.length && sourceChecksum === targetChecksum;
	await db
		.prepare(
			`INSERT INTO superboard_plugin_shadow_read_metrics
			 (plugin_id, entity_type, result, source_count, target_count, observed_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.bind(input.plugin_id, input.entity_type, matches ? "match" : "mismatch", input.source.length, input.target.length, input.observed_at)
		.run();
	if (!matches) throw new Error("SHADOW_READ_MISMATCH");
	return { rows: input.target, source_checksum: sourceChecksum, target_checksum: targetChecksum };
}

export async function exportPluginStoreReverseDelta(db: D1Database, input: {
	plugin_id: string;
	instance_id: string;
	updated_after: string;
	encryption_key: CryptoKey;
}) {
	const rows = await db
		.prepare(
			`SELECT plugin_id, store_id, instance_id, entity_type, entity_id, revision,
			        payload_json, payload_checksum, updated_at
			 FROM superboard_plugin_store_records
			 WHERE plugin_id = ? AND instance_id = ? AND updated_at > ?
			 ORDER BY entity_type, entity_id`,
		)
		.bind(input.plugin_id, input.instance_id, input.updated_after)
		.all<Omit<StoreRecordRow, "last_operation_id">>();
	const records = await Promise.all(
		rows.results.map(async ({ payload_json: payloadJson, ...row }) => ({
			...row,
			payload: JSON.parse(
				await decryptPayload(input.encryption_key, JSON.parse(payloadJson) as EncryptedPayload),
			) as unknown,
		})),
	);
	return { records, checksum: await sha256(canonicalizeReleasePayload(records)), deletes: [] as never[] };
}

export async function issueWorkerExecutionLease(db: D1Database, input: {
	attempt_id: string;
	plugin_id: string;
	operation_id: string;
	callback_token: string;
	issued_at: string;
	expires_at: string;
}) {
	assertPlugin(input.plugin_id);
	await db.batch([
		db
			.prepare(
				`UPDATE superboard_worker_execution_leases
				 SET superseded_at = ?
				 WHERE plugin_id = ? AND operation_id = ?
				   AND consumed_at IS NULL AND superseded_at IS NULL`,
			)
			.bind(input.issued_at, input.plugin_id, input.operation_id),
		db
			.prepare(
				`INSERT INTO superboard_worker_execution_leases
				 (attempt_id, plugin_id, operation_id, callback_token_hash, issued_at, expires_at,
				  superseded_at, consumed_at)
				 VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
			)
			.bind(
				input.attempt_id,
				input.plugin_id,
				input.operation_id,
				await sha256(input.callback_token),
				input.issued_at,
				input.expires_at,
			),
	]);
}

export async function acceptWorkerCallback(db: D1Database, input: {
	attempt_id: string;
	plugin_id: string;
	callback_token: string;
	completed_at: string;
}) {
	const result = await db
		.prepare(
			`UPDATE superboard_worker_execution_leases
			 SET consumed_at = ?
			 WHERE attempt_id = ? AND plugin_id = ? AND callback_token_hash = ?
			   AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at >= ?
			 RETURNING operation_id`,
		)
		.bind(input.completed_at, input.attempt_id, input.plugin_id, await sha256(input.callback_token), input.completed_at)
		.first<{ operation_id: string }>();
	if (!result) throw new Error("WORKER_CALLBACK_REJECTED");
	return result;
}

function resolveInstanceAlias(input: Pick<StoreRecordInput, "instance_id" | "projectId" | "pid">): string {
	const values = [input.instance_id, input.projectId, input.pid].filter((value): value is string => typeof value === "string" && value !== "");
	if (values.length === 0 || new Set(values).size !== 1) throw new Error("INSTANCE_ALIAS_CONFLICT");
	return values[0]!;
}

async function toRecord(row: StoreRecordRow, encryptionKey: CryptoKey) {
	const payloadJson = await decryptPayload(
		encryptionKey,
		JSON.parse(row.payload_json) as EncryptedPayload,
	);
	return {
		plugin_id: row.plugin_id,
		store_id: row.store_id,
		instance_id: row.instance_id,
		entity_type: row.entity_type,
		entity_id: row.entity_id,
		revision: row.revision,
		payload: JSON.parse(payloadJson) as unknown,
		payload_checksum: row.payload_checksum,
		updated_at: row.updated_at,
	};
}

interface EncryptedPayload {
	algorithm: "AES-GCM";
	iv: string;
	ciphertext: string;
}

async function encryptPayload(key: CryptoKey, plaintext: string): Promise<EncryptedPayload> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(plaintext),
	);
	return {
		algorithm: "AES-GCM",
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
	};
}

async function decryptPayload(key: CryptoKey, payload: EncryptedPayload): Promise<string> {
	if (payload.algorithm !== "AES-GCM") throw new Error("STORE_PAYLOAD_ENCRYPTION_INVALID");
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: base64ToBytes(payload.iv) },
		key,
		base64ToBytes(payload.ciphertext),
	);
	return new TextDecoder().decode(plaintext);
}

function bytesToBase64(bytes: Uint8Array): string {
	return btoa(String.fromCodePoint(...bytes));
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);
}

function assertPlugin(pluginId: string): void {
	if (!pluginPattern.test(pluginId)) throw new Error("PLUGIN_ID_INVALID");
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
