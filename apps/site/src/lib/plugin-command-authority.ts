import { canonicalizeReleasePayload } from "@superboard/supbrd-core";

const pluginPattern = /^supbrd-(?:plug|plugmod)-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const idempotencyPattern = /^[A-Za-z0-9._:-]{8,200}$/u;
const projectRefPattern = /^\d+-(?:test|prod)$/u;

interface CommandOperationRow {
	operation_id: string;
	instance_id: string;
	project_ref: string;
	plugin_id: string;
	command_id: string | null;
	adapter_operation: string;
	method: string;
	request_path_checksum: string;
	request_checksum: string;
	state: "accepted" | "completed" | "failed";
	response_status: number | null;
	response_headers_json: string | null;
	response_payload_json: string | null;
	response_checksum: string | null;
	accepted_at: string;
	completed_at: string | null;
}

export interface RepositoryCommandInput {
	operation_id: string;
	instance_id: string;
	project_ref: string;
	plugin_id: string;
	command_id?: string;
	adapter_operation: string;
	method: "POST" | "PUT" | "PATCH" | "DELETE";
	request_path: string;
	request_body: Uint8Array;
	accepted_at: string;
	encryption_key: CryptoKey;
}

export async function beginRepositoryCommand(db: D1Database, input: RepositoryCommandInput) {
	assertCommandInput(input);
	await assertActiveCommandContract(db, input.plugin_id, input.command_id);
	const pathChecksum = await sha256(new TextEncoder().encode(input.request_path));
	const requestChecksum = await sha256(
		new TextEncoder().encode(
			canonicalizeReleasePayload({
				method: input.method,
				path_checksum: pathChecksum,
				body_checksum: await sha256(input.request_body),
			}),
		),
	);
	const encryptedRequest = await encryptBytes(input.encryption_key, input.request_body);
	const inserted = await db
		.prepare(
			`INSERT INTO superboard_plugin_command_operations (
			   operation_id, instance_id, project_ref, plugin_id, command_id,
			   adapter_operation, method, request_path_checksum, request_payload_json,
			   request_checksum, state, response_status, response_headers_json,
			   response_payload_json, response_checksum, accepted_at, completed_at
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', NULL, NULL, NULL, NULL, ?, NULL)
			 ON CONFLICT(operation_id) DO NOTHING
			 RETURNING *`,
		)
		.bind(
			input.operation_id,
			input.instance_id,
			input.project_ref,
			input.plugin_id,
			input.command_id ?? null,
			input.adapter_operation,
			input.method,
			pathChecksum,
			JSON.stringify(encryptedRequest),
			requestChecksum,
			input.accepted_at,
		)
		.first<CommandOperationRow>();
	if (inserted) return { status: "accepted" as const, operation: publicOperation(inserted) };

	const existing = await loadOperation(db, input.operation_id);
	if (
		existing.instance_id !== input.instance_id ||
		existing.project_ref !== input.project_ref ||
		existing.plugin_id !== input.plugin_id ||
		existing.command_id !== (input.command_id ?? null) ||
		existing.adapter_operation !== input.adapter_operation ||
		existing.method !== input.method ||
		existing.request_path_checksum !== pathChecksum ||
		existing.request_checksum !== requestChecksum
	) {
		throw new Error("COMMAND_IDEMPOTENCY_CONFLICT");
	}
	if (existing.state === "accepted") {
		return { status: "accepted" as const, operation: publicOperation(existing), resumed: true };
	}
	return {
		status: "replay" as const,
		operation: publicOperation(existing),
		response: await responseFromRow(existing, input.encryption_key),
	};
}

export async function completeRepositoryCommand(
	db: D1Database,
	input: {
		operation_id: string;
		response: Response;
		completed_at: string;
		encryption_key: CryptoKey;
	},
) {
	const responseBody = new Uint8Array(await input.response.clone().arrayBuffer());
	const responseChecksum = await sha256(responseBody);
	const encryptedResponse = await encryptBytes(input.encryption_key, responseBody);
	const headers = responseHeadersForReplay(input.response.headers);
	const state = input.response.ok ? "completed" : "failed";
	const completed = await db
		.prepare(
			`UPDATE superboard_plugin_command_operations
			 SET state = ?, response_status = ?, response_headers_json = ?,
			     response_payload_json = ?, response_checksum = ?, completed_at = ?
			 WHERE operation_id = ? AND state = 'accepted'
			 RETURNING *`,
		)
		.bind(
			state,
			input.response.status,
			canonicalizeReleasePayload(headers),
			JSON.stringify(encryptedResponse),
			responseChecksum,
			input.completed_at,
			input.operation_id,
		)
		.first<CommandOperationRow>();
	if (completed) return publicOperation(completed);
	const existing = await loadOperation(db, input.operation_id);
	if (existing.state === "accepted") throw new Error("COMMAND_COMPLETION_CONFLICT");
	if (
		existing.response_status !== input.response.status ||
		existing.response_checksum !== responseChecksum
	) {
		throw new Error("COMMAND_COMPLETION_CONFLICT");
	}
	return publicOperation(existing);
}

export function resolveRepositoryCommandScope(url: URL): {
	plugin_id: string;
	project_ref: string;
	adapter_operation: string;
} {
	const pathname = url.pathname;
	const projectRef =
		pathname.match(/\/(\d+-(?:test|prod))(?:\/|$)/u)?.[1] ??
		(url.searchParams.get("project_ref")?.match(projectRefPattern)?.[0] ?? "instance-wide");
	const pluginId = inferPluginId(pathname);
	return {
		plugin_id: pluginId,
		project_ref: projectRef,
		adapter_operation: `${pathname.startsWith("/api/v2/") ? "api-v2" : "api-v1"}:${pluginId}`,
	};
}

export function assertIdempotencyKey(value: string | null): string {
	const normalized = value?.trim() ?? "";
	if (!idempotencyPattern.test(normalized)) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
	return normalized;
}

async function assertActiveCommandContract(
	db: D1Database,
	pluginId: string,
	commandId: string | undefined,
) {
	if (!pluginPattern.test(pluginId)) throw new Error("PLUGIN_ID_INVALID");
	const active = await db
		.prepare(
			`SELECT artifact.manifest_json
			 FROM superboard_active_plugin_manifests active
			 JOIN superboard_plugin_manifest_artifacts artifact
			   ON artifact.artifact_checksum = active.artifact_checksum
			 WHERE active.plugin_id = ? AND artifact.plugin_id = active.plugin_id`,
		)
		.bind(pluginId)
		.first<{ manifest_json: string }>();
	if (!active) throw new Error("PLUGIN_MANIFEST_NOT_ACTIVE");
	if (!commandId) return;
	const manifest = JSON.parse(active.manifest_json) as { commands?: Array<{ command_id?: string }> };
	if (!manifest.commands?.some(({ command_id: value }) => value === commandId)) {
		throw new Error("PLUGIN_COMMAND_NOT_DECLARED");
	}
}

function inferPluginId(pathname: string): string {
	if (/\/analytics(?:\/|$)/u.test(pathname)) return "supbrd-plugmod-analytics";
	if (/\/flows(?:\/|$)/u.test(pathname)) return "supbrd-plugmod-flows";
	if (/\/onboardings(?:\/|$)/u.test(pathname)) return "supbrd-plugmod-onboardings";
	if (/\/paywalls?(?:\/|$)/u.test(pathname)) return "supbrd-plugmod-paywalls";
	if (/\/(?:products|packages|offerings|entitlements)(?:\/|$)/u.test(pathname)) {
		return "supbrd-plug-products";
	}
	if (/\/(?:billing|purchases|refunds|subscriptions)(?:\/|$)/u.test(pathname)) {
		return "supbrd-plugmod-billing";
	}
	if (/\/(?:support|inbox|conversations)(?:\/|$)/u.test(pathname)) {
		return "supbrd-plugmod-support";
	}
	if (/\/(?:smtp|transactional|delivery-outbox|dead-letters)(?:\/|$)/u.test(pathname)) {
		return "supbrd-plugmod-email";
	}
	if (/\/(?:marketing|campaigns|notifications)(?:\/|$)/u.test(pathname)) {
		return "supbrd-plugmod-marketing";
	}
	if (/\/(?:links|redirect-rules|redirect_config|domains?)(?:\/|$)/u.test(pathname)) {
		return "supbrd-plugmod-dynamic-links";
	}
	if (/\/(?:files|uploads|objects)(?:\/|$)/u.test(pathname)) return "supbrd-plugmod-files";
	if (/\/mcp(?:\/|$)/u.test(pathname)) return "supbrd-plugmod-mcp";
	if (/\/(?:events|visitors|dashboard)(?:\/|$)/u.test(pathname)) {
		return "supbrd-plugmod-analytics";
	}
	if (/\/(?:users|members|sessions)(?:\/|$)/u.test(pathname)) return "supbrd-plug-user";
	if (/\/(?:settings|configurations|setup)(?:\/|$)/u.test(pathname)) {
		return "supbrd-plug-settings";
	}
	if (/\/(?:status|health|incidents|custom-jobs)(?:\/|$)/u.test(pathname)) {
		return "supbrd-plugmod-observability";
	}
	return "supbrd-plugmod-gateway";
}

function assertCommandInput(input: RepositoryCommandInput) {
	assertIdempotencyKey(input.operation_id);
	if (!input.instance_id.trim()) throw new Error("INSTANCE_ID_REQUIRED");
	if (!(input.project_ref === "instance-wide" || projectRefPattern.test(input.project_ref))) {
		throw new Error("PROJECT_REF_INVALID");
	}
	if (!input.adapter_operation.trim()) throw new Error("ADAPTER_OPERATION_REQUIRED");
	if (!input.request_path.startsWith("/api/")) throw new Error("COMMAND_PATH_INVALID");
}

async function loadOperation(db: D1Database, operationId: string) {
	const row = await db
		.prepare("SELECT * FROM superboard_plugin_command_operations WHERE operation_id = ?")
		.bind(operationId)
		.first<CommandOperationRow>();
	if (!row) throw new Error("COMMAND_OPERATION_NOT_FOUND");
	return row;
}

function publicOperation(row: CommandOperationRow) {
	return {
		operation_id: row.operation_id,
		instance_id: row.instance_id,
		project_ref: row.project_ref,
		plugin_id: row.plugin_id,
		command_id: row.command_id,
		adapter_operation: row.adapter_operation,
		state: row.state,
		request_checksum: row.request_checksum,
		response_status: row.response_status,
		response_checksum: row.response_checksum,
		accepted_at: row.accepted_at,
		completed_at: row.completed_at,
	};
}

async function responseFromRow(row: CommandOperationRow, encryptionKey: CryptoKey) {
	if (
		row.response_status === null ||
		row.response_headers_json === null ||
		row.response_payload_json === null
	) {
		throw new Error("COMMAND_RESPONSE_INCOMPLETE");
	}
	const body = await decryptBytes(encryptionKey, parseEncryptedBytes(row.response_payload_json));
	const parsedHeaders = JSON.parse(row.response_headers_json) as Record<string, string>;
	return new Response(body, { status: row.response_status, headers: parsedHeaders });
}

function responseHeadersForReplay(headers: Headers): Record<string, string> {
	const selected: Record<string, string> = { "Cache-Control": "private, no-store" };
	for (const name of ["Content-Type", "Content-Disposition", "ETag", "Location"]) {
		const value = headers.get(name);
		if (value) selected[name] = value;
	}
	return selected;
}

interface EncryptedBytes {
	algorithm: "AES-GCM";
	iv: string;
	ciphertext: string;
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<EncryptedBytes> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		Uint8Array.from(bytes).buffer,
	);
	return {
		algorithm: "AES-GCM",
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
	};
}

async function decryptBytes(key: CryptoKey, payload: EncryptedBytes): Promise<Uint8Array<ArrayBuffer>> {
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: base64ToBytes(payload.iv) },
		key,
		base64ToBytes(payload.ciphertext),
	);
	return new Uint8Array(plaintext);
}

function parseEncryptedBytes(value: string): EncryptedBytes {
	const parsed = JSON.parse(value) as Partial<EncryptedBytes>;
	if (
		parsed.algorithm !== "AES-GCM" ||
		typeof parsed.iv !== "string" ||
		typeof parsed.ciphertext !== "string"
	) {
		throw new Error("COMMAND_PAYLOAD_INVALID");
	}
	return { algorithm: parsed.algorithm, iv: parsed.iv, ciphertext: parsed.ciphertext };
}

function bytesToBase64(bytes: Uint8Array): string {
	return btoa(String.fromCodePoint(...bytes));
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);
}

async function sha256(value: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer);
	return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
