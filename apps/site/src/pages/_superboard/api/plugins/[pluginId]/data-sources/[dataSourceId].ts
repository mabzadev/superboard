import { pluginComponentForContribution } from "@superboard/contracts/plugin-packages";
import type { APIRoute } from "astro";

import { jsonResponse, requirePluginOperator } from "../../../../../../lib/operator-guard.js";
import { dispatchPluginApiAdapter } from "../../../../../../lib/plugin-api-adapter.js";
import { requireActiveSuperBoardPlugin } from "../../../../../../lib/plugin-availability.js";
import { unwrapMigratedPayload } from "../../../../../../lib/plugin-data-source.js";
import {
	importPluginStoreEncryptionKey,
	listPluginStoreRecords,
} from "../../../../../../lib/plugin-store-repository.js";
import { getSiteEnv } from "../../../../../../lib/site-env.js";
import {
	resolveSuperBoardPluginTarget,
	superBoardRuntimePluginCatalog,
} from "../../../../../../lib/superboard-plugin-catalog.js";

export const prerender = false;
const clientInputErrorPattern = /(?:INVALID|REQUIRED|REJECTED)$/u;

export const GET: APIRoute = async (context) => {
	if (context.url.searchParams.has("request"))
		return dispatchPluginApiAdapter(context, "data_source");
	const denied = requirePluginOperator(context);
	if (denied) return denied;
	const requestedDataSourceId = context.params.dataSourceId ?? "";
	const pluginId = pluginComponentForContribution(
		context.params.pluginId ?? "",
		requestedDataSourceId,
	);
	const plugin = superBoardRuntimePluginCatalog().plugins.find(
		({ manifest }) => manifest.plugin_id === pluginId,
	);
	if (!plugin) return jsonResponse({ error: { code: "PLUGIN_NOT_FOUND" } }, 404);
	const fullDataSourceId = requestedDataSourceId.includes(".data_source.")
		? requestedDataSourceId
		: `${pluginId}.data_source.${requestedDataSourceId}`;
	const dataSource = plugin.manifest.data_sources.find(
		({ data_source_id: dataSourceId }) => dataSourceId === fullDataSourceId,
	);
	if (!dataSource) return jsonResponse({ error: { code: "DATA_SOURCE_NOT_FOUND" } }, 404);
	const env = getSiteEnv();
	const inactive = await requireActiveSuperBoardPlugin(env.DB, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
		plugin_id: pluginId,
	});
	if (inactive) return inactive;
	const encodedKey = env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY?.trim();
	if (!encodedKey) return jsonResponse({ error: { code: "PLUGIN_STORE_KEY_UNAVAILABLE" } }, 503);
	try {
		const encryptionKey = await importPluginStoreEncryptionKey(encodedKey);
		const page = await listPluginStoreRecords(env.DB, {
			plugin_id: pluginId,
			store_id: dataSource.store_id,
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
			project_ref: context.url.searchParams.get("project_ref") ?? "",
			entity_type: context.url.searchParams.get("entity_type") ?? undefined,
			cursor: context.url.searchParams.get("cursor") ?? undefined,
			limit: Number(context.url.searchParams.get("limit") ?? 50),
			encryption_key: encryptionKey,
		});
		return jsonResponse({
			plugin_id: pluginId,
			data_source_id: dataSource.data_source_id,
			store_id: dataSource.store_id,
			consistency: dataSource.consistency,
			items: page.items.map((item) => ({
				...item,
				payload: unwrapMigratedPayload(item.payload),
			})),
			next_cursor: page.next_cursor,
		});
	} catch (error) {
		const code = error instanceof Error ? error.message : "DATA_SOURCE_QUERY_FAILED";
		const status =
			code === "PLUGIN_MANIFEST_NOT_ACTIVE" ? 404 : clientInputErrorPattern.test(code) ? 400 : 503;
		return jsonResponse({ error: { code } }, status);
	}
};

export const POST: APIRoute = (context) => dispatchPluginApiAdapter(context, "data_source");
