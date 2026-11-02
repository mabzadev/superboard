import { z } from "zod";

import { localeCode } from "./common.js";

const slugPattern = /^[a-z][a-z0-9_]*$/;
const collectionSlug = z
	.string()
	.min(1)
	.max(63)
	.regex(slugPattern, "Invalid collection slug format");

export const createRelationBody = z
	.object({
		name: z
			.string()
			.min(1)
			.max(63)
			.regex(slugPattern, "Name must be lowercase alphanumeric with underscores"),
		parentCollection: collectionSlug.optional(),
		childCollection: collectionSlug.optional(),
		parentLabel: z.string().min(1).max(200),
		childLabel: z.string().min(1).max(200),
		locale: localeCode.optional(),
		translationOf: z.string().min(1).optional(),
	})
	.refine(
		(body) =>
			body.translationOf !== undefined ||
			(body.parentCollection !== undefined && body.childCollection !== undefined),
		{ message: "parentCollection and childCollection are required unless translationOf is set" },
	)
	.meta({ id: "CreateRelationBody" });

export const updateRelationBody = z
	.object({
		parentLabel: z.string().min(1).max(200).optional(),
		childLabel: z.string().min(1).max(200).optional(),
	})
	.refine((body) => body.parentLabel !== undefined || body.childLabel !== undefined, {
		message: "At least one of parentLabel or childLabel is required",
	})
	.meta({ id: "UpdateRelationBody" });

export const setReferenceChildrenBody = z
	.object({ childIds: z.array(z.string().min(1)).max(1000) })
	.meta({ id: "SetReferenceChildrenBody" });

export const relationDefSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		parentCollection: z.string(),
		childCollection: z.string(),
		parentLabel: z.string(),
		childLabel: z.string(),
		locale: z.string(),
		translationGroup: z.string(),
	})
	.meta({ id: "RelationDef" });

export const relationListResponseSchema = z
	.object({ relations: z.array(relationDefSchema) })
	.meta({ id: "RelationListResponse" });

export const relationResponseSchema = z
	.object({ relation: relationDefSchema })
	.meta({ id: "RelationResponse" });

export const relationTranslationsSchema = z
	.object({
		translationGroup: z.string(),
		translations: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				locale: z.string(),
				parentLabel: z.string(),
				childLabel: z.string(),
			}),
		),
	})
	.meta({ id: "RelationTranslations" });

export const entryRefSchema = z
	.object({
		id: z.string(),
		slug: z.string().nullable(),
		collection: z.string(),
		locale: z.string().nullable(),
		sortOrder: z.number().int().optional(),
	})
	.meta({ id: "ReferenceEntryRef" });

export const referenceChildrenResponseSchema = z
	.object({ children: z.array(entryRefSchema), nextCursor: z.string().optional() })
	.meta({ id: "ReferenceChildrenResponse" });

export const referenceParentsResponseSchema = z
	.object({ parents: z.array(entryRefSchema), nextCursor: z.string().optional() })
	.meta({ id: "ReferenceParentsResponse" });
