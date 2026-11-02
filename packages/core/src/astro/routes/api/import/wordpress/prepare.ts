import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { wpPrepareBody } from "#api/schemas.js";
import { FIELD_TYPES, type FieldType } from "#schema/types.js";
import type { EmDashHandlers } from "#types";

import { capitalize, sanitizeSlug, singularize, type ImportFieldDef } from "./analyze.js";

function asFieldType(value: string): FieldType | undefined {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- validated by includes check
	return (FIELD_TYPES as readonly string[]).includes(value) ? (value as FieldType) : undefined;
}

export const prerender = false;

interface PrepareRequest {
	postTypes: Array<{
		name: string;
		collection: string;
		fields: ImportFieldDef[];
	}>;
}

export interface PrepareResult {
	success: boolean;
	collectionsCreated: string[];
	fieldsCreated: Array<{ collection: string; field: string }>;
	errors: Array<{ collection: string; error: string }>;
}

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	const denied = requirePerm(user, "import:execute");
	if (denied) return denied;

	try {
		const body = await parseBody(request, wpPrepareBody);
		if (isParseError(body)) return body;

		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Zod schema output narrowed to PrepareRequest
		const result = await prepareImport(emdash.db, body as PrepareRequest);

		if (result.collectionsCreated.length > 0) {
			emdash.invalidateUrlPatternCache();
		}

		return apiSuccess(result, result.success ? 200 : 400);
	} catch (error) {
		return handleError(error, "Failed to prepare import", "WXR_PREPARE_ERROR");
	}
};

async function prepareImport(
	db: NonNullable<EmDashHandlers["db"]>,
	request: PrepareRequest,
): Promise<PrepareResult> {
	const { SchemaRegistry } = await import("#schema/registry.js");
	const registry = new SchemaRegistry(db);

	const result: PrepareResult = {
		success: true,
		collectionsCreated: [],
		fieldsCreated: [],
		errors: [],
	};

	for (const postType of request.postTypes) {
		const collectionSlug = sanitizeSlug(postType.collection);

		try {
			let collection = await registry.getCollection(collectionSlug);

			if (!collection) {
				const label = capitalize(collectionSlug);
				const labelSingular = capitalize(singularize(collectionSlug));

				const isSearchable = ["posts", "pages", "post", "page"].includes(collectionSlug);
				const supports: ("revisions" | "drafts" | "search")[] = ["revisions", "drafts"];
				if (isSearchable) {
					supports.push("search");
				}

				const urlPattern =
					collectionSlug === "pages"
						? "/{slug}"
						: collectionSlug === "posts"
							? "/blog/{slug}"
							: undefined;

				collection = await registry.createCollection({
					slug: collectionSlug,
					label,
					labelSingular,
					description: `Imported from WordPress post type: ${postType.name}`,
					supports,
					urlPattern,
				});

				result.collectionsCreated.push(collectionSlug);
			}

			const existingFields = await registry.listFields(collection.id);
			const existingFieldSlugs = new Set(existingFields.map((f) => f.slug));

			for (const field of postType.fields) {
				if (existingFieldSlugs.has(field.slug)) {
					continue;
				}

				const fieldType = asFieldType(field.type);
				if (!fieldType) {
					result.errors.push({
						collection: collectionSlug,
						error: `Unknown field type "${field.type}" for field "${field.slug}"`,
					});
					continue;
				}

				await registry.createField(collectionSlug, {
					slug: field.slug,
					label: field.label,
					type: fieldType,
					required: field.required,
					unique: false,
					searchable: field.searchable ?? false,
					sortOrder: existingFields.length + result.fieldsCreated.length,
				});

				result.fieldsCreated.push({
					collection: collectionSlug,
					field: field.slug,
				});
			}

			const isSearchable = ["posts", "pages", "post", "page"].includes(collectionSlug);
			if (isSearchable) {
				const { FTSManager } = await import("#search/fts-manager.js");
				const ftsManager = new FTSManager(db);

				const searchableFields = await ftsManager.getSearchableFields(collectionSlug);
				if (searchableFields.length > 0) {
					try {
						await ftsManager.enableSearch(collectionSlug);
					} catch {}
				}
			}
		} catch (error) {
			console.error(`Prepare error for collection "${collectionSlug}":`, error);
			result.success = false;
			result.errors.push({
				collection: collectionSlug,
				error: "Failed to prepare collection",
			});
		}
	}

	return result;
}
