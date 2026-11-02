import type { APIRoute } from "astro";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import type { SchemaRegistry } from "#schema/registry.js";

export const prerender = false;

async function safeListCollections(registry: SchemaRegistry) {
	try {
		return await registry.listCollections();
	} catch (error) {
		if (error instanceof Error && error.message.includes("no such table")) {
			return [];
		}
		throw error;
	}
}

async function generateTypes(registry: SchemaRegistry) {
	const { generateTypesFile, generateSchemaHash } = await import("#schema/zod-generator.js");

	const collections = await safeListCollections(registry);
	const collectionsWithFields = await Promise.all(
		collections.map(async (c) => {
			const fields = await registry.listFields(c.id);
			return { ...c, fields };
		}),
	);

	const types = generateTypesFile(collectionsWithFields);
	const hash: string = await generateSchemaHash(collectionsWithFields);

	return { types, hash, collections: collections.length };
}

export const GET: APIRoute = async ({ locals }) => {
	if (!import.meta.env.DEV) {
		return apiError("FORBIDDEN", "Typegen is only available in development", 403);
	}

	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	try {
		const { SchemaRegistry } = await import("#schema/registry.js");
		const registry = new SchemaRegistry(emdash.db);
		const { types } = await generateTypes(registry);

		return new Response(types, {
			status: 200,
			headers: {
				"Content-Type": "text/typescript",
				"Cache-Control": "private, no-store",
			},
		});
	} catch (error) {
		return handleError(error, "Typegen failed", "TYPEGEN_ERROR");
	}
};

export const POST: APIRoute = async ({ locals }) => {
	if (!import.meta.env.DEV) {
		return apiError("FORBIDDEN", "Typegen is only available in development", 403);
	}

	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	try {
		const { SchemaRegistry } = await import("#schema/registry.js");
		const registry = new SchemaRegistry(emdash.db);
		const result = await generateTypes(registry);

		return apiSuccess(result);
	} catch (error) {
		return handleError(error, "Typegen failed", "TYPEGEN_ERROR");
	}
};
