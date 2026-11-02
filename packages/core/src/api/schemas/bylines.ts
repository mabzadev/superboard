import { z } from "zod";

import { cursorPaginationQuery, httpUrl, localeCode } from "./common.js";

const bylineSlugPattern = /^[a-z][a-z0-9-]*$/;

export const bylineSummarySchema = z
	.object({
		id: z.string(),
		slug: z.string(),
		displayName: z.string(),
		bio: z.string().nullable(),
		avatarMediaId: z.string().nullable(),
		avatarStorageKey: z.string().nullish(),
		avatarAlt: z.string().nullish(),
		avatarBlurhash: z.string().nullish(),
		avatarDominantColor: z.string().nullish(),
		websiteUrl: z.string().nullable(),
		userId: z.string().nullable(),
		isGuest: z.boolean(),
		createdAt: z.string(),
		updatedAt: z.string(),
		locale: z.string(),
		translationGroup: z.string().nullable(),
		customFields: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])).optional(),
	})
	.meta({ id: "BylineSummary" });

export const bylineCreditSchema = z
	.object({
		byline: bylineSummarySchema,
		sortOrder: z.number().int(),
		roleLabel: z.string().nullable(),
		source: z.enum(["explicit", "inferred"]).optional().meta({
			description: "Whether this credit was explicitly assigned or inferred from authorId",
		}),
	})
	.meta({ id: "BylineCredit" });

export const contentBylineInputSchema = z
	.object({
		bylineId: z.string().min(1),
		roleLabel: z.string().nullish(),
	})
	.meta({ id: "ContentBylineInput" });

export const bylinesListQuery = cursorPaginationQuery
	.extend({
		search: z.string().optional(),
		isGuest: z.coerce.boolean().optional(),
		userId: z.string().optional(),
		locale: localeCode.optional(),
	})
	.meta({ id: "BylinesListQuery" });

export const bylineCreateBody = z
	.object({
		slug: z
			.string()
			.min(1)
			.regex(bylineSlugPattern, "Slug must contain only lowercase letters, digits, and hyphens"),
		displayName: z.string().min(1),
		bio: z.string().nullish(),
		avatarMediaId: z.string().nullish(),
		websiteUrl: httpUrl.nullish(),
		userId: z.string().nullish(),
		isGuest: z.boolean().optional(),
		locale: localeCode.optional(),
		translationOf: z.string().min(1).optional(),
		customFields: z.record(z.string(), z.unknown()).optional(),
	})
	.meta({ id: "BylineCreateBody" });

export const bylineTranslationCreateBody = z
	.object({
		locale: localeCode,
		slug: z
			.string()
			.min(1)
			.regex(bylineSlugPattern, "Slug must contain only lowercase letters, digits, and hyphens")
			.optional(),
		displayName: z.string().min(1).optional(),
		bio: z.string().nullish(),
		avatarMediaId: z.string().nullish(),
		websiteUrl: httpUrl.nullish(),
	})
	.meta({ id: "BylineTranslationCreateBody" });

export const bylineTranslationsResponseSchema = z
	.object({
		items: z.array(bylineSummarySchema),
	})
	.meta({ id: "BylineTranslationsResponse" });

export const bylineUpdateBody = z
	.object({
		slug: z
			.string()
			.min(1)
			.regex(bylineSlugPattern, "Slug must contain only lowercase letters, digits, and hyphens")
			.optional(),
		displayName: z.string().min(1).optional(),
		bio: z.string().nullish(),
		avatarMediaId: z.string().nullish(),
		websiteUrl: httpUrl.nullish(),
		userId: z.string().nullish(),
		isGuest: z.boolean().optional(),
		customFields: z.record(z.string(), z.unknown()).optional(),
	})
	.meta({ id: "BylineUpdateBody" });

export const bylineListResponseSchema = z
	.object({
		items: z.array(bylineSummarySchema),
		nextCursor: z.string().optional(),
	})
	.meta({ id: "BylineListResponse" });
