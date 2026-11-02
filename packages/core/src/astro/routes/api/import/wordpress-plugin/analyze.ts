import type { APIRoute } from "astro";
import { SchemaRegistry } from "emdash";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { wpPluginAnalyzeBody } from "#api/schemas.js";
import { getSource } from "#import/index.js";
import { resolveAndValidateExternalUrl, SsrfError } from "#import/ssrf.js";
import type { ImportAnalysis } from "#import/types.js";
import type { EmDashHandlers } from "#types";

export const prerender = false;

export interface WpPluginAnalyzeResponse {
	success: boolean;
	analysis?: ImportAnalysis;
	error?: { message: string };
}

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	const denied = requirePerm(user, "import:execute");
	if (denied) return denied;

	try {
		const body = await parseBody(request, wpPluginAnalyzeBody);
		if (isParseError(body)) return body;

		try {
			await resolveAndValidateExternalUrl(body.url);
		} catch (e) {
			const msg = e instanceof SsrfError ? e.message : "Invalid URL";
			return apiError("SSRF_BLOCKED", msg, 400);
		}

		const source = getSource("wordpress-plugin");
		if (!source) {
			return apiError("NOT_CONFIGURED", "WordPress plugin source not available", 500);
		}

		const existingCollections = await fetchExistingCollections(emdash?.db);

		const analysis = await source.analyze(
			{ type: "url", url: body.url, token: body.token },
			{
				db: emdash?.db,
				getExistingCollections: async () => existingCollections,
			},
		);

		return apiSuccess({
			success: true,
			analysis,
		});
	} catch (error) {
		return handleError(error, "Failed to analyze WordPress site", "WP_PLUGIN_ANALYZE_ERROR");
	}
};

interface ExistingCollection {
	slug: string;
	fields: Map<string, { type: string }>;
}

async function fetchExistingCollections(
	db: EmDashHandlers["db"] | undefined,
): Promise<Map<string, ExistingCollection>> {
	const result = new Map<string, ExistingCollection>();

	if (!db) return result;

	try {
		const registry = new SchemaRegistry(db);
		const collections = await registry.listCollections();

		for (const collection of collections) {
			const fields = await registry.listFields(collection.id);
			const fieldMap = new Map<string, { type: string }>();

			for (const field of fields) {
				fieldMap.set(field.slug, { type: field.type });
			}

			result.set(collection.slug, {
				slug: collection.slug,
				fields: fieldMap,
			});
		}
	} catch (error) {
		console.warn("Could not fetch schema registry:", error);
	}

	return result;
}
