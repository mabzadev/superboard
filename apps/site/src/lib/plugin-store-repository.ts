import {
	canonicalizeReleasePayload,
	verifySuperBoardPluginManifest,
} from "@superboard/supbrd-core";

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
	manifest_artifact_checksum: string;
	last_operation_id: string;
	updated_at: string;
}

export async function putPluginStoreRecord(db: D1Database, input: StoreRecordInput) {
	assertPlugin(input.plugin_id);
	const installed = await db
		.prepare(
			`SELECT artifact.manifest_json, artifact.artifact_checksum
			 FROM superboard_active_plugin_manifests AS active
			 JOIN superboard_plugin_manifest_artifacts AS artifact
			   ON artifact.artifact_checksum = active.artifact_checksum
			 WHERE active.plugin_id = ? AND artifact.plugin_id = active.plugin_id`,
		)
		.bind(input.plugin_id)
		.first<{ manifest_json: string; artifact_checksum: string }>();
	if (!installed) throw new Error("PLUGIN_MANIFEST_NOT_ACTIVE");
	const manifest: unknown = JSON.parse(installed.manifest_json);
	const manifestVerification = await verifySuperBoardPluginManifest(manifest);
	if (
		!manifestVerification.valid ||
		!isManifest(manifest) ||
		manifest.plugin_id !== input.plugin_id ||
		!manifest.stores.some(
			(store) => store.store_id === input.store_id && store.authority === input.plugin_id,
		)
	) {
		throw new Error("STORE_WRITE_AUTHORITY_REJECTED");
	}
	if (!input.store_id.startsWith(`${input.plugin_id}.store.`)) {
		throw new Error("STORE_NAMESPACE_REJECTED");
	}
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
			   payload_json, payload_checksum, manifest_artifact_checksum,
			   last_operation_id, updated_at
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(plugin_id, store_id, instance_id, entity_type, entity_id) DO UPDATE SET
			   revision = excluded.revision,
			   payload_json = excluded.payload_json,
			   payload_checksum = excluded.payload_checksum,
			   manifest_artifact_checksum = excluded.manifest_artifact_checksum,
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
			installed.artifact_checksum,
			input.operation_id,
			input.updated_at,
			input.expected_revision,
		)
		.first<StoreRecordRow>();
	if (!row) throw new Error("STORE_REVISION_CONFLICT");
	return { ...(await toRecord(row, input.encryption_key)), idempotent: false };
}

function isManifest(value: unknown): value is {
	plugin_id: string;
	stores: Array<{ store_id: string; authority: string }>;
} {
	return (
		typeof value === "object" &&
		value !== null &&
		"plugin_id" in value &&
		typeof value.plugin_id === "string" &&
		"stores" in value &&
		Array.isArray(value.stores)
	);
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

export async function verifyPluginStoreShadowRead(
	db: D1Database,
	input: {
		plugin_id: string;
		entity_type: string;
		source: unknown[];
		target: unknown[];
		observed_at: string;
	},
) {
	const sourceChecksum = await sha256(canonicalizeReleasePayload(input.source));
	const targetChecksum = await sha256(canonicalizeReleasePayload(input.target));
	const matches = input.source.length === input.target.length && sourceChecksum === targetChecksum;
	await db
		.prepare(
			`INSERT INTO superboard_plugin_shadow_read_metrics
			 (plugin_id, entity_type, result, source_count, target_count, observed_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			input.plugin_id,
			input.entity_type,
			matches ? "match" : "mismatch",
			input.source.length,
			input.target.length,
			input.observed_at,
		)
		.run();
	if (!matches) throw new Error("SHADOW_READ_MISMATCH");
	return { rows: input.target, source_checksum: sourceChecksum, target_checksum: targetChecksum };
}

export async function exportPluginStoreReverseDelta(
	db: D1Database,
	input: {
		plugin_id: string;
		instance_id: string;
		updated_after: string;
		encryption_key: CryptoKey;
	},
) {
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
			payload: parseJsonValue(
				await decryptPayload(input.encryption_key, parseEncryptedPayload(payloadJson)),
			),
		})),
	);
	return {
		records,
		checksum: await sha256(canonicalizeReleasePayload(records)),
		deletes: [] as never[],
	};
}

export async function issueWorkerExecutionLease(
	db: D1Database,
	input: {
		attempt_id: string;
		plugin_id: string;
		operation_id: string;
		callback_token: string;
		callback_public_jwk: JsonWebKey;
		issued_at: string;
		expires_at: string;
	},
) {
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
				 (attempt_id, plugin_id, operation_id, callback_token_hash, callback_public_jwk,
				  issued_at, expires_at, superseded_at, consumed_at,
				  callback_payload_checksum, callback_signature)
				 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
			)
			.bind(
				input.attempt_id,
				input.plugin_id,
				input.operation_id,
				await sha256(input.callback_token),
				JSON.stringify(input.callback_public_jwk),
				input.issued_at,
				input.expires_at,
			),
	]);
}

export async function acceptWorkerCallback(
	db: D1Database,
	input: {
		attempt_id: string;
		plugin_id: string;
		callback_token: string;
		payload_checksum: string;
		signature: string;
		completed_at: string;
	},
) {
	const lease = await db
		.prepare(
			`SELECT operation_id, callback_public_jwk
			 FROM superboard_worker_execution_leases
			 WHERE attempt_id = ? AND plugin_id = ? AND callback_token_hash = ?
			   AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at >= ?`,
		)
		.bind(input.attempt_id, input.plugin_id, await sha256(input.callback_token), input.completed_at)
		.first<{ operation_id: string; callback_public_jwk: string }>();
	if (!lease) throw new Error("WORKER_CALLBACK_REJECTED");
	const publicKey = await crypto.subtle.importKey(
		"jwk",
		parsePublicJwk(lease.callback_public_jwk),
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);
	const signedPayload = canonicalizeReleasePayload({
		attempt_id: input.attempt_id,
		plugin_id: input.plugin_id,
		operation_id: lease.operation_id,
		payload_checksum: input.payload_checksum,
		completed_at: input.completed_at,
	});
	const signatureValid = await crypto.subtle.verify(
		{ name: "ECDSA", hash: "SHA-256" },
		publicKey,
		base64ToBytes(input.signature),
		new TextEncoder().encode(signedPayload),
	);
	if (!signatureValid) throw new Error("WORKER_CALLBACK_SIGNATURE_INVALID");
	const result = await db
		.prepare(
			`UPDATE superboard_worker_execution_leases
			 SET consumed_at = ?, callback_payload_checksum = ?, callback_signature = ?
			 WHERE attempt_id = ? AND plugin_id = ? AND callback_token_hash = ?
			   AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at >= ?
			 RETURNING operation_id`,
		)
		.bind(
			input.completed_at,
			input.payload_checksum,
			input.signature,
			input.attempt_id,
			input.plugin_id,
			await sha256(input.callback_token),
			input.completed_at,
		)
		.first<{ operation_id: string }>();
	if (!result) throw new Error("WORKER_CALLBACK_REJECTED");
	return result;
}

function resolveInstanceAlias(
	input: Pick<StoreRecordInput, "instance_id" | "projectId" | "pid">,
): string {
	const values = [input.instance_id, input.projectId, input.pid].filter(
		(value): value is string => typeof value === "string" && value !== "",
	);
	const [instanceId] = values;
	if (!instanceId || new Set(values).size !== 1) throw new Error("INSTANCE_ALIAS_CONFLICT");
	return instanceId;
}

async function toRecord(row: StoreRecordRow, encryptionKey: CryptoKey) {
	const payloadJson = await decryptPayload(encryptionKey, parseEncryptedPayload(row.payload_json));
	return {
		plugin_id: row.plugin_id,
		store_id: row.store_id,
		instance_id: row.instance_id,
		entity_type: row.entity_type,
		entity_id: row.entity_id,
		revision: row.revision,
		payload: parseJsonValue(payloadJson),
		payload_checksum: row.payload_checksum,
		manifest_artifact_checksum: row.manifest_artifact_checksum,
		updated_at: row.updated_at,
	};
}

interface EncryptedPayload {
	algorithm: "AES-GCM";
	iv: string;
	ciphertext: string;
}

function parseEncryptedPayload(value: string): EncryptedPayload {
	const parsed: unknown = JSON.parse(value);
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		!("algorithm" in parsed) ||
		parsed.algorithm !== "AES-GCM" ||
		!("iv" in parsed) ||
		typeof parsed.iv !== "string" ||
		!("ciphertext" in parsed) ||
		typeof parsed.ciphertext !== "string"
	) {
		throw new Error("STORE_ENCRYPTED_PAYLOAD_INVALID");
	}
	return { algorithm: "AES-GCM", iv: parsed.iv, ciphertext: parsed.ciphertext };
}

function parsePublicJwk(value: string): JsonWebKey {
	const parsed: unknown = JSON.parse(value);
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		!("kty" in parsed) ||
		parsed.kty !== "EC" ||
		!("crv" in parsed) ||
		parsed.crv !== "P-256" ||
		!("x" in parsed) ||
		typeof parsed.x !== "string" ||
		!("y" in parsed) ||
		typeof parsed.y !== "string"
	) {
		throw new Error("WORKER_CALLBACK_PUBLIC_KEY_INVALID");
	}
	return { kty: "EC", crv: "P-256", x: parsed.x, y: parsed.y };
}

function parseJsonValue(value: string): unknown {
	const parsed: unknown = JSON.parse(value);
	return parsed;
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
