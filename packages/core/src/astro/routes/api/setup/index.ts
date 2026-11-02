import type { APIRoute } from "astro";

export const prerender = false;

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { getPublicOrigin } from "#api/public-url.js";
import { setupBody } from "#api/schemas.js";
import { getAuthMode } from "#auth/mode.js";
import { OptionsRepository } from "#db/repositories/options.js";
import { applySeed } from "#seed/apply.js";
import { loadSeed } from "#seed/load.js";
import { validateSeed } from "#seed/validate.js";

export const POST: APIRoute = async ({ request, url, locals }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	try {
		try {
			const options = new OptionsRepository(emdash.db);
			const setupComplete = await options.get("emdash:setup_complete");

			if (setupComplete === true || setupComplete === "true") {
				return apiError("ALREADY_CONFIGURED", "Setup has already been completed", 409);
			}
		} catch {}

		const body = await parseBody(request, setupBody);
		if (isParseError(body)) return body;

		const seed = await loadSeed();

		seed.settings = {
			...seed.settings,
			title: body.title,
			tagline: body.tagline,
		};

		const validation = validateSeed(seed);
		if (!validation.valid) {
			return apiError("INVALID_SEED", `Invalid seed file: ${validation.errors.join(", ")}`, 400);
		}

		let result;
		try {
			result = await applySeed(emdash.db, seed, {
				includeContent: body.includeContent,
				onConflict: "skip",
				storage: emdash.storage ?? undefined,
			});
		} catch (error) {
			return handleError(error, "Failed to apply seed", "SEED_ERROR");
		}

		const authMode = getAuthMode(emdash.config);
		const useExternalAuth = authMode.type === "external";

		try {
			const options = new OptionsRepository(emdash.db);

			const siteUrl = getPublicOrigin(url, emdash.config);
			await options.setIfAbsent("emdash:site_url", siteUrl);

			if (useExternalAuth) {
				await options.set("emdash:setup_complete", true);
				await options.set("emdash:site_title", body.title);
				if (body.tagline) {
					await options.set("emdash:site_tagline", body.tagline);
				}
			} else {
				await options.set("emdash:setup_state", {
					step: "site_complete",
					title: body.title,
					tagline: body.tagline,
				});
			}
		} catch (error) {
			console.error("Failed to save setup state:", error);
		}

		return apiSuccess({
			success: true,
			setupComplete: useExternalAuth,
			result,
		});
	} catch (error) {
		return handleError(error, "Setup failed", "SETUP_ERROR");
	}
};
