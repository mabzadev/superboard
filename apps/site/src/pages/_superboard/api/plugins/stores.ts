import type { APIRoute } from "astro";

import { jsonResponse, requirePluginOperator } from "../../../../lib/operator-guard.js";
import {
	importPluginStoreEncryptionKey,
	summarizePluginStores,
} from "../../../../lib/plugin-store-repository.js";
import { getSiteEnv } from "../../../../lib/site-env.js";
import { superBoardRuntimePluginCatalog } from "../../../../lib/superboard-plugin-catalog.js";

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const denied = requirePluginOperator(context);
	if (denied) return denied;
	const projectRef = context.url.searchParams.get("project_ref") ?? "";
	const env = getSiteEnv();
	const encodedKey = env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY?.trim();
	if (!encodedKey) return jsonResponse({ error: { code: "PLUGIN_STORE_KEY_UNAVAILABLE" } }, 503);
	try {
		await importPluginStoreEncryptionKey(encodedKey);
		const summaries = await summarizePluginStores(env.DB, {
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			project_ref: projectRef,
		});
		const byStore = new Map(summaries.map((summary) => [summary.store_id, summary]));
		const items = superBoardRuntimePluginCatalog().plugins.flatMap(({ manifest }) =>
			manifest.stores.map((store) => ({
				plugin_id: manifest.plugin_id,
				store_id: store.store_id,
				authority: store.authority,
				schema_version: store.schema_version,
				classification: store.classification,
				encryption: store.encryption,
				record_count: byStore.get(store.store_id)?.record_count ?? 0,
				entity_type_count: byStore.get(store.store_id)?.entity_type_count ?? 0,
				latest_update: byStore.get(store.store_id)?.latest_update ?? null,
			})),
		);
		return jsonResponse({
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			project_ref: projectRef,
			items,
		});
	} catch (error) {
		const code = error instanceof Error ? error.message : "PLUGIN_STORE_QUERY_FAILED";
		const status = code === "PROJECT_REF_INVALID" || code === "PROJECT_REF_REQUIRED" ? 400 : 503;
		return jsonResponse({ error: { code } }, status);
	}
};
