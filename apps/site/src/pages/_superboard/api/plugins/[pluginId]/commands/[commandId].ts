import { canonicalizeReleasePayload, sha256Canonical } from "@superboard/supbrd-core";
import { executeConfiguredSuperBoardCommand } from "@superboard/supbrd-runtime-plugins/command-runtime";
import type { APIRoute } from "astro";

import { jsonResponse, requirePluginOperator } from "../../../../../../lib/operator-guard.js";
import {
	assertIdempotencyKey,
	beginRepositoryCommand,
	completeRepositoryCommand,
} from "../../../../../../lib/plugin-command-authority.js";
import {
	importPluginStoreEncryptionKey,
	acceptWorkerCallback,
	issueWorkerExecutionLease,
	loadPluginStoreRecord,
	putPluginStoreRecord,
} from "../../../../../../lib/plugin-store-repository.js";
import { getSiteEnv } from "../../../../../../lib/site-env.js";
import {
	resolveSuperBoardPluginTarget,
	superBoardRuntimePluginCatalog,
} from "../../../../../../lib/superboard-plugin-catalog.js";

export const prerender = false;
const clientErrorCodes = new Set([
	"COMMAND_IDEMPOTENCY_CONFLICT",
	"IDEMPOTENCY_KEY_REQUIRED",
	"PLUGIN_COMMAND_INPUT_INVALID",
	"PLUGIN_COMMAND_NOT_DECLARED",
	"PROJECT_REF_INVALID",
]);
const unavailableCodes = new Set([
	"PLUGIN_COMMAND_HANDLER_NOT_IMPLEMENTED",
	"PLUGIN_COMMAND_SCHEMA_MISSING",
	"PLUGIN_COMMAND_SCHEMA_UNSUPPORTED",
	"PLUGIN_MANIFEST_NOT_ACTIVE",
	"PLUGIN_STORE_ENCRYPTION_KEY_INVALID",
]);

export const POST: APIRoute = async (context) => {
	const denied = requirePluginOperator(context, { mutation: true });
	if (denied) return denied;
	const pluginId = context.params.pluginId ?? "";
	const commandId = context.params.commandId ?? "";
	const plugin = superBoardRuntimePluginCatalog().plugins.find(
		({ manifest: candidate }) => candidate.plugin_id === pluginId,
	);
	if (!plugin) return jsonResponse({ error: { code: "PLUGIN_NOT_FOUND" } }, 404);
	const { manifest, worker_descriptor: workerDescriptor } = plugin;
	const fullCommandId = commandId.includes(".command.")
		? commandId
		: `${pluginId}.command.${commandId}`;
	if (!manifest.commands.some(({ command_id: candidate }) => candidate === fullCommandId)) {
		return jsonResponse({ error: { code: "PLUGIN_COMMAND_NOT_FOUND" } }, 404);
	}
	const env = getSiteEnv();
	const encodedKey = env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY?.trim();
	if (!encodedKey) return jsonResponse({ error: { code: "PLUGIN_STORE_KEY_UNAVAILABLE" } }, 503);
	let pendingOperation: { operation_id: string; encryption_key: CryptoKey } | null = null;
	try {
		const encryptionKey = await importPluginStoreEncryptionKey(encodedKey);
		const requestBody = new Uint8Array(await context.request.clone().arrayBuffer());
		const operationId = assertIdempotencyKey(context.request.headers.get("Idempotency-Key"));
		const projectRef = context.url.searchParams.get("project_ref") ?? "";
		const acceptedAt = new Date().toISOString();
		const operation = await beginRepositoryCommand(env.DB, {
			operation_id: operationId,
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
			project_ref: projectRef,
			plugin_id: pluginId,
			command_id: fullCommandId,
			adapter_operation: `emdash-plugin:${pluginId}`,
			method: "POST",
			request_path: context.url.pathname,
			request_body: requestBody,
			accepted_at: acceptedAt,
			encryption_key: encryptionKey,
		});
		if (operation.status === "replay") return operation.response;
		pendingOperation = { operation_id: operationId, encryption_key: encryptionKey };
		const requestPayload: unknown = await context.request.json();
		const workerAttempt =
			workerDescriptor?.lease === "attempt_scoped"
				? await createWorkerAttempt(env.DB, pluginId, operationId, acceptedAt)
				: null;
		const result = await executeConfiguredSuperBoardCommand(pluginId, {
			command_id: fullCommandId,
			operation_id: operationId,
			...(workerAttempt ? { attempt_id: workerAttempt.attempt_id } : {}),
			payload: typeof requestPayload === "object" && requestPayload !== null ? requestPayload : {},
		});
		if (workerAttempt) {
			await consumeWorkerAttempt(env.DB, pluginId, operationId, workerAttempt, result);
		}
		const mutation = result.result.mutation;
		const current = await loadPluginStoreRecord(
			env.DB,
			pluginId,
			mutation.store_id,
			env.SUPERBOARD_INSTANCE_ID,
			mutation.entity_type,
			mutation.entity_id,
			encryptionKey,
			projectRef,
		);
		const stored = await putPluginStoreRecord(env.DB, {
			plugin_id: pluginId,
			store_id: mutation.store_id,
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
			project_ref: projectRef,
			entity_type: mutation.entity_type,
			entity_id: mutation.entity_id,
			expected_revision: current?.revision ?? null,
			operation_id: `${operationId}:store`,
			payload: {
				command_id: fullCommandId,
				effect: result.result.effect,
				value: mutation.value,
				worker: result.result.worker,
			},
			updated_at: new Date().toISOString(),
			encryption_key: encryptionKey,
		});
		const response = jsonResponse(
			{
				...result,
				result: {
					...result.result,
					mutation: { ...mutation, revision: stored.revision },
				},
			},
			200,
		);
		await completeRepositoryCommand(env.DB, {
			operation_id: operationId,
			response,
			completed_at: new Date().toISOString(),
			encryption_key: encryptionKey,
		});
		return response;
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		const code =
			clientErrorCodes.has(message) || unavailableCodes.has(message)
				? message
				: "PLUGIN_COMMAND_FAILED";
		const status =
			code === "PLUGIN_MANIFEST_NOT_ACTIVE" ? 409 : clientErrorCodes.has(code) ? 400 : 503;
		const response = jsonResponse({ error: { code } }, status);
		if (pendingOperation) {
			await completeRepositoryCommand(env.DB, {
				operation_id: pendingOperation.operation_id,
				response,
				completed_at: new Date().toISOString(),
				encryption_key: pendingOperation.encryption_key,
			});
		}
		return response;
	}
};

async function createWorkerAttempt(
	db: D1Database,
	pluginId: string,
	operationId: string,
	issuedAt: string,
) {
	const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const attemptId = `${operationId}:attempt:1`;
	const callbackToken = crypto.randomUUID();
	await issueWorkerExecutionLease(db, {
		attempt_id: attemptId,
		plugin_id: pluginId,
		operation_id: operationId,
		callback_token: callbackToken,
		callback_public_jwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
		issued_at: issuedAt,
		expires_at: new Date(Date.parse(issuedAt) + 30_000).toISOString(),
	});
	return { attempt_id: attemptId, callback_token: callbackToken, private_key: keyPair.privateKey };
}

async function consumeWorkerAttempt(
	db: D1Database,
	pluginId: string,
	operationId: string,
	attempt: Awaited<ReturnType<typeof createWorkerAttempt>>,
	result: unknown,
) {
	const completedAt = new Date().toISOString();
	const payloadChecksum = await sha256Canonical(result);
	const signedPayload = canonicalizeReleasePayload({
		attempt_id: attempt.attempt_id,
		plugin_id: pluginId,
		operation_id: operationId,
		payload_checksum: payloadChecksum,
		completed_at: completedAt,
	});
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		attempt.private_key,
		new TextEncoder().encode(signedPayload),
	);
	await acceptWorkerCallback(db, {
		attempt_id: attempt.attempt_id,
		plugin_id: pluginId,
		callback_token: attempt.callback_token,
		payload_checksum: payloadChecksum,
		signature: bytesToBase64(new Uint8Array(signature)),
		completed_at: completedAt,
	});
}

function bytesToBase64(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCodePoint(byte);
	return btoa(binary);
}
