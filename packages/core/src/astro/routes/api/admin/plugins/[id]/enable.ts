import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";
import { handlePluginEnable } from "#api/index.js";
import { checkMediaUsageActivationWriteFence } from "#api/media-usage-write-fence.js";
import { setCronTasksEnabled } from "#plugins/cron.js";

export const prerender = false;

export const POST: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const { id } = params;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "plugins:manage");
	if (denied) return denied;

	const activationFence = await checkMediaUsageActivationWriteFence(emdash.db);
	if (activationFence) return activationFence;

	if (!id) {
		return apiError("INVALID_REQUEST", "Plugin ID required", 400);
	}

	const result = await handlePluginEnable(
		emdash.db,
		emdash.configuredPlugins,
		emdash.sandboxedPluginEntries,
		id,
	);

	if (!result.success) return unwrapResult(result);

	const source = result.data.item.source;
	if (source === "registry") {
		await emdash.syncRegistryPlugins();
	} else if (source === "marketplace") {
		await emdash.syncMarketplacePlugins();
	}

	await emdash.setPluginStatus(id, "active");
	await setCronTasksEnabled(emdash.db, id, true);

	return unwrapResult(result);
};
