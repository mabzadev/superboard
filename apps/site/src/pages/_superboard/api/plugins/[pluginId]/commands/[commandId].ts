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
	"PLUGIN_MANIFEST_NOT_ACTIVE",
	"PLUGIN_STORE_ENCRYPTION_KEY_INVALID",
]);

export const POST: APIRoute = async (context) => {
	const denied = requirePluginOperator(context, { mutation: true });
	if (denied) return denied;
	const pluginId = context.params.pluginId ?? "";
	const commandId = context.params.commandId ?? "";
	const manifest = superBoardRuntimePluginCatalog().plugins.find(
		({ manifest: candidate }) => candidate.plugin_id === pluginId,
	)?.manifest;
	if (!manifest) return jsonResponse({ error: { code: "PLUGIN_NOT_FOUND" } }, 404);
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
		const result = await executeConfiguredSuperBoardCommand(pluginId, {
			command_id: fullCommandId,
			operation_id: operationId,
			payload: typeof requestPayload === "object" && requestPayload !== null ? requestPayload : {},
		});
		await putPluginStoreRecord(env.DB, {
			plugin_id: pluginId,
			store_id: commandStoreId(manifest.stores, fullCommandId),
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
			project_ref: projectRef,
			entity_type: "command_execution",
			entity_id: operationId,
			expected_revision: null,
			operation_id: `${operationId}:store`,
			payload: { command_id: fullCommandId, input: requestPayload, output: result },
			updated_at: new Date().toISOString(),
			encryption_key: encryptionKey,
		});
		const response = jsonResponse(result, 200);
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

function commandStoreId(stores: Array<{ store_id: string }>, commandId: string): string {
	const operation = commandId.split(".command.").at(-1)?.replaceAll("-", "_") ?? "";
	const matching = stores
		.filter(({ store_id: storeId }) => operation.includes(storeId.split(".store.").at(-1) ?? ""))
		.toSorted((left, right) => right.store_id.length - left.store_id.length)[0];
	const storeId = matching?.store_id ?? stores[0]?.store_id;
	if (!storeId) throw new Error("PLUGIN_COMMAND_STORE_UNAVAILABLE");
	return storeId;
}
