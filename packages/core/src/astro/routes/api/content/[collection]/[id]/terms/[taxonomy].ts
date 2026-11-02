import type { APIRoute } from "astro";

import { requirePerm, requireOwnerPerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError, requireDb } from "#api/error.js";
import { parseBody, isParseError } from "#api/parse.js";
import { contentTermsBody } from "#api/schemas.js";
import { ContentRepository } from "#db/repositories/content.js";
import {
	TaxonomyRepository,
	type TaxonomyAssignmentResolution,
} from "#db/repositories/taxonomy.js";
import { invalidateTermCache } from "#taxonomies/index.js";

import { getI18nConfig } from "../../../../../../../i18n/config.js";

export const prerender = false;

function assignmentResponse(assignments: TaxonomyAssignmentResolution[], entryLocale: string) {
	const config = getI18nConfig();
	const defaultLocale = config?.defaultLocale ?? "en";
	return {
		terms: assignments.flatMap(({ term }) =>
			term
				? [
						{
							id: term.id,
							name: term.name,
							slug: term.slug,
							label: term.label,
							parentId: term.parentId,
							locale: term.locale,
							translationGroup: term.translationGroup,
						},
					]
				: [],
		),
		unresolved: assignments
			.filter(({ term }) => term === null)
			.map(({ translationGroup, availableLocales, translations }) => ({
				translationGroup,
				availableLocales,
				translations,
			})),
		entryLocale,
		defaultLocale,
		implicitDefaultLocale: config === null,
	};
}

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const { collection, id, taxonomy } = params;

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;
	const denied = requirePerm(user, "content:read");
	if (denied) return denied;

	if (!collection || !id || !taxonomy) {
		return apiError("VALIDATION_ERROR", "Collection, id, and taxonomy required", 400);
	}

	try {
		const entry = await new ContentRepository(emdash.db).findByIdOrSlug(collection, id);
		if (!entry) return apiError("NOT_FOUND", "Content not found", 404);
		const locale = entry.locale || getI18nConfig()?.defaultLocale || "en";
		const defaultLocale = getI18nConfig()?.defaultLocale ?? "en";

		const repo = new TaxonomyRepository(emdash.db);
		const assignments = await repo.getTermAssignmentsForEntry(
			collection,
			entry.id,
			taxonomy,
			locale,
			defaultLocale,
		);

		return apiSuccess(assignmentResponse(assignments, locale));
	} catch (error) {
		return handleError(error, "Failed to get entry terms", "TERMS_GET_ERROR");
	}
};

export const POST: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	const { collection, id, taxonomy } = params;

	if (!collection || !id || !taxonomy) {
		return apiError("VALIDATION_ERROR", "Collection, id, and taxonomy required", 400);
	}

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;
	const denied = requirePerm(user, "content:edit_own");
	if (denied) return denied;

	if (!emdash.handleContentGet) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const existing = await emdash.handleContentGet(collection, id);
	if (!existing.success) {
		return apiError(
			existing.error?.code ?? "NOT_FOUND",
			existing.error?.message ?? "Content not found",
			existing.error?.code === "NOT_FOUND" ? 404 : 500,
		);
	}

	const existingData =
		existing.data && typeof existing.data === "object"
			? // eslint-disable-next-line typescript/no-unsafe-type-assertion -- handler returns unknown data; narrowed by typeof check above
				(existing.data as Record<string, unknown>)
			: undefined;
	const existingItem =
		existingData?.item && typeof existingData.item === "object"
			? // eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof check above
				(existingData.item as Record<string, unknown>)
			: existingData;
	const authorId = typeof existingItem?.authorId === "string" ? existingItem.authorId : "";
	const editDenied = requireOwnerPerm(user, authorId, "content:edit_own", "content:edit_any");
	if (editDenied) return editDenied;

	const canonicalId = typeof existingItem?.id === "string" ? existingItem.id : id;
	const entryLocale =
		typeof existingItem?.locale === "string"
			? existingItem.locale
			: (getI18nConfig()?.defaultLocale ?? "en");

	try {
		const body = await parseBody(request, contentTermsBody);
		if (isParseError(body)) return body;
		const { termIds } = body;

		const repo = new TaxonomyRepository(emdash.db);

		for (const termId of termIds) {
			const term = await repo.findById(termId);
			if (!term) {
				return apiError("NOT_FOUND", `Term ID '${termId}' not found`, 404);
			}
			if (term.name !== taxonomy) {
				return apiError(
					"VALIDATION_ERROR",
					`Term ID '${termId}' does not belong to taxonomy '${taxonomy}'`,
					400,
				);
			}
		}

		await repo.setTermsForEntry(collection, canonicalId, taxonomy, termIds);

		invalidateTermCache();

		const assignments = await repo.getTermAssignmentsForEntry(
			collection,
			canonicalId,
			taxonomy,
			entryLocale,
			getI18nConfig()?.defaultLocale ?? "en",
		);

		return apiSuccess(assignmentResponse(assignments, entryLocale));
	} catch (error) {
		return handleError(error, "Failed to set entry terms", "TERMS_SET_ERROR");
	}
};
