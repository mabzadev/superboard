import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess } from "#api/error.js";
import { handleMarketplaceUpdateCheck, handleRegistryUpdateCheck } from "#api/index.js";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "plugins:read");
	if (denied) return denied;

	const [marketplace, registry] = await Promise.all([
		handleMarketplaceUpdateCheck(emdash.db, emdash.config.marketplace).catch((err) => {
			console.warn("[plugins/updates] marketplace check threw:", err);
			return null;
		}),
		handleRegistryUpdateCheck(emdash.db, emdash.config.experimental?.registry).catch((err) => {
			console.warn("[plugins/updates] registry check threw:", err);
			return null;
		}),
	]);
	if (marketplace && !marketplace.success) {
		console.warn(
			`[plugins/updates] marketplace check failed: ${marketplace.error.code} ${marketplace.error.message}`,
		);
	}
	if (registry && !registry.success) {
		console.warn(
			`[plugins/updates] registry check failed: ${registry.error.code} ${registry.error.message}`,
		);
	}

	const items: unknown[] = [];
	if (marketplace?.success) items.push(...marketplace.data.items);
	if (registry?.success) items.push(...registry.data.items);

	return apiSuccess({ items });
};
