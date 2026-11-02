import type { APIRoute } from "astro";
import { z } from "zod";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { OptionsRepository } from "#db/repositories/options.js";

export const prerender = false;

const HOOK_NAME_RE = /^[a-z]+:[a-zA-Z]+$/;

const setSelectionSchema = z.object({
	pluginId: z.string().min(1).nullable(),
});

export const PUT: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "settings:manage");
	if (denied) return denied;

	const hookName = params.hookName;
	if (!hookName) {
		return apiError("VALIDATION_ERROR", "Hook name is required", 400);
	}

	if (!HOOK_NAME_RE.test(hookName)) {
		return apiError("VALIDATION_ERROR", "Invalid hook name format", 400);
	}

	try {
		const pipeline = emdash.hooks;

		if (!pipeline.isExclusiveHook(hookName)) {
			return apiError("NOT_FOUND", `Hook '${hookName}' is not a registered exclusive hook`, 404);
		}

		const body = await parseBody(request, setSelectionSchema);
		if (isParseError(body)) return body;

		const optionsRepo = new OptionsRepository(emdash.db);
		const optionKey = `emdash:exclusive_hook:${hookName}`;

		if (body.pluginId === null) {
			await optionsRepo.delete(optionKey);
			pipeline.clearExclusiveSelection(hookName);
		} else {
			const providers = pipeline.getExclusiveHookProviders(hookName);
			const isValidProvider = providers.some(
				(p: { pluginId: string }) => p.pluginId === body.pluginId,
			);
			if (!isValidProvider) {
				return apiError(
					"VALIDATION_ERROR",
					`Plugin '${body.pluginId}' is not a provider for hook '${hookName}'`,
					400,
				);
			}

			await optionsRepo.set(optionKey, body.pluginId);
			pipeline.setExclusiveSelection(hookName, body.pluginId);
		}

		return apiSuccess({
			hookName,
			selectedPluginId: body.pluginId,
		});
	} catch (error) {
		return handleError(error, "Failed to set exclusive hook selection", "EXCLUSIVE_HOOK_SET_ERROR");
	}
};
