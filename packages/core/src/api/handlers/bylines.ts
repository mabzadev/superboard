import type { Kysely } from "kysely";

import {
	BylineRepository,
	type CreateBylineInput,
	type UpdateBylineInput,
} from "../../database/repositories/byline.js";
import { EmDashValidationError, type BylineSummary } from "../../database/repositories/types.js";
import type { Database } from "../../database/types.js";
import { getI18nConfig, resolveConfiguredLocale } from "../../i18n/config.js";
import type { ApiResult } from "../types.js";

const norm = (v: string | null | undefined): string | null => v ?? null;

function bylineFixedFieldsMatch(
	existing: BylineSummary,
	input: CreateBylineInput,
	effectiveLocale: string,
): boolean {
	return (
		existing.displayName === input.displayName &&
		norm(existing.bio) === norm(input.bio) &&
		norm(existing.avatarMediaId) === norm(input.avatarMediaId) &&
		norm(existing.websiteUrl) === norm(input.websiteUrl) &&
		norm(existing.userId) === norm(input.userId) &&
		existing.isGuest === (input.isGuest ?? false) &&
		existing.locale === effectiveLocale
	);
}

function existingCustomFieldsAreSubsetOf(
	existing: Record<string, unknown>,
	input: Record<string, unknown> | undefined,
): boolean {
	if (!input) return Object.keys(existing).length === 0;
	for (const [slug, value] of Object.entries(existing)) {
		if (!Object.hasOwn(input, slug)) return false;
		if (input[slug] !== value) return false;
	}
	return true;
}

function rejectUnknownLocale(locale: string | undefined): ApiResult<never> | null {
	if (!locale) return null;
	const config = getI18nConfig();
	if (!config) return null;
	if (config.locales.includes(locale)) return null;
	return {
		success: false,
		error: {
			code: "VALIDATION_ERROR",
			message: `Locale "${locale}" is not configured for this site`,
		},
	};
}

export interface BylineTranslationsResponse {
	items: BylineSummary[];
}

export async function handleBylineTranslations(
	db: Kysely<Database>,
	id: string,
): Promise<ApiResult<BylineTranslationsResponse>> {
	try {
		const repo = new BylineRepository(db);
		const anchor = await repo.findById(id);
		if (!anchor) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "Byline not found" },
			};
		}
		const items = await repo.listTranslations(id);
		return { success: true, data: { items } };
	} catch {
		return {
			success: false,
			error: {
				code: "BYLINE_TRANSLATIONS_ERROR",
				message: "Failed to list byline translations",
			},
		};
	}
}

export async function handleBylineCreate(
	db: Kysely<Database>,
	input: CreateBylineInput,
): Promise<ApiResult<BylineSummary>> {
	try {
		if (input.translationOf && !input.locale) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "`locale` is required when `translationOf` is provided",
				},
			};
		}

		const locale = input.locale ? resolveConfiguredLocale(input.locale) : undefined;
		const localeErr = rejectUnknownLocale(locale);
		if (localeErr) return localeErr;

		const repo = new BylineRepository(db);

		let sourceGroup: string | undefined;
		if (input.translationOf) {
			const source = await repo.findById(input.translationOf);
			if (!source) {
				return {
					success: false,
					error: {
						code: "NOT_FOUND",
						message: "Source byline for translation not found",
					},
				};
			}
			sourceGroup = source.translationGroup ?? source.id;
		}

		const effectiveLocale = locale ?? getI18nConfig()?.defaultLocale ?? "en";

		if (sourceGroup) {
			const siblings = await repo.findByTranslationGroup(sourceGroup);
			if (siblings.some((b) => b.locale === effectiveLocale)) {
				return {
					success: false,
					error: {
						code: "CONFLICT",
						message: `Translation already exists in locale "${effectiveLocale}" for this byline`,
					},
				};
			}
		}

		const existing = await repo.findBySlug(input.slug, { locale: effectiveLocale });
		if (existing) {
			const expectedTranslationGroup = sourceGroup ?? existing.id;
			const inputHasFields = !!input.customFields && Object.keys(input.customFields).length > 0;
			if (
				inputHasFields &&
				bylineFixedFieldsMatch(existing, input, effectiveLocale) &&
				existing.translationGroup === expectedTranslationGroup &&
				existingCustomFieldsAreSubsetOf(existing.customFields ?? {}, input.customFields)
			) {
				const recovered = await repo.update(existing.id, {
					customFields: input.customFields,
				});
				if (recovered) return { success: true, data: recovered };
			}

			return {
				success: false,
				error: {
					code: "CONFLICT",
					message: `Byline "${input.slug}" already exists${
						input.locale ? ` in locale "${input.locale}"` : ""
					}`,
				},
			};
		}

		const byline = await repo.create({ ...input, locale: effectiveLocale });
		return { success: true, data: byline };
	} catch (error) {
		if (error instanceof EmDashValidationError) {
			return {
				success: false,
				error: { code: "VALIDATION_ERROR", message: error.message },
			};
		}
		console.error("[BYLINE_CREATE_ERROR]", error);
		return {
			success: false,
			error: { code: "BYLINE_CREATE_ERROR", message: "Failed to create byline" },
		};
	}
}

export async function handleBylineUpdate(
	db: Kysely<Database>,
	id: string,
	input: UpdateBylineInput,
): Promise<ApiResult<BylineSummary>> {
	try {
		const repo = new BylineRepository(db);
		const byline = await repo.update(id, input);
		if (!byline) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "Byline not found" },
			};
		}
		return { success: true, data: byline };
	} catch (error) {
		if (error instanceof EmDashValidationError) {
			return {
				success: false,
				error: { code: "VALIDATION_ERROR", message: error.message },
			};
		}
		console.error("[BYLINE_UPDATE_ERROR]", error);
		return {
			success: false,
			error: { code: "BYLINE_UPDATE_ERROR", message: "Failed to update byline" },
		};
	}
}
