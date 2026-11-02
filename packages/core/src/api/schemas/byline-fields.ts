import { z } from "zod";

import { BYLINE_FIELD_TYPES, RESERVED_BYLINE_FIELD_SLUGS } from "../../schema/types.js";

const bylineFieldSlugPattern = /^[a-z][a-z0-9_]*$/;

const MAX_SLUG_LENGTH = 63;
const MAX_LABEL_LENGTH = 200;
const MAX_SELECT_OPTIONS = 200;

const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED_BYLINE_FIELD_SLUGS);

const bylineFieldTypeValues = z.enum(["string", "text", "url", "boolean", "select"]);
type _BylineFieldTypeDriftCheck =
	(typeof BYLINE_FIELD_TYPES)[number] extends z.infer<typeof bylineFieldTypeValues>
		? z.infer<typeof bylineFieldTypeValues> extends (typeof BYLINE_FIELD_TYPES)[number]
			? true
			: never
		: never;
const _bylineFieldTypeDriftCheck: _BylineFieldTypeDriftCheck = true;
void _bylineFieldTypeDriftCheck;

const bylineFieldValidationSchema = z
	.object({
		options: z
			.array(z.string().min(1))
			.min(1, "select options must contain at least one entry")
			.max(MAX_SELECT_OPTIONS, `select options cannot exceed ${MAX_SELECT_OPTIONS} entries`)
			.optional(),
	})
	.strict()
	.nullable();

const bylineFieldSlug = z
	.string()
	.min(1, "Byline field slug is required")
	.max(MAX_SLUG_LENGTH, `Byline field slug must be ${MAX_SLUG_LENGTH} characters or less`)
	.regex(
		bylineFieldSlugPattern,
		"Byline field slug must contain only lowercase letters, digits, and underscores, and start with a letter",
	)
	.refine((slug) => !RESERVED_SET.has(slug), {
		message: "Byline field slug is reserved",
	});

const bylineFieldLabel = z
	.string()
	.min(1, "Byline field label is required")
	.max(MAX_LABEL_LENGTH, `Byline field label must be ${MAX_LABEL_LENGTH} characters or less`);

export const bylineFieldCreateBody = z
	.object({
		slug: bylineFieldSlug,
		label: bylineFieldLabel,
		type: bylineFieldTypeValues,
		required: z.boolean().optional(),
		translatable: z.boolean().optional(),
		validation: bylineFieldValidationSchema.optional(),
		sortOrder: z.number().int().min(0).optional(),
	})
	.strict()
	.meta({ id: "BylineFieldCreateBody" });

export const bylineFieldUpdateBody = z
	.object({
		label: bylineFieldLabel.optional(),
		required: z.boolean().optional(),
		translatable: z.boolean().optional(),
		validation: bylineFieldValidationSchema.optional(),
		sortOrder: z.number().int().min(0).optional(),
	})
	.strict()
	.meta({ id: "BylineFieldUpdateBody" });

export const bylineFieldReorderBody = z
	.object({
		slugs: z.array(bylineFieldSlug),
	})
	.strict()
	.meta({ id: "BylineFieldReorderBody" });

export const bylineFieldDefinitionSchema = z
	.object({
		id: z.string(),
		slug: z.string(),
		label: z.string(),
		type: bylineFieldTypeValues,
		required: z.boolean(),
		translatable: z.boolean(),
		validation: z
			.object({
				options: z.array(z.string()).optional(),
			})
			.nullable(),
		sortOrder: z.number().int(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: "BylineFieldDefinition" });

export const bylineFieldListResponseSchema = z
	.object({
		items: z.array(bylineFieldDefinitionSchema),
	})
	.meta({ id: "BylineFieldListResponse" });

export const bylineFieldUsageResponseSchema = z
	.object({
		translatableValueCount: z.number().int().nonnegative(),
		groupValueCount: z.number().int().nonnegative(),
		totalAffectedRows: z.number().int().nonnegative(),
	})
	.meta({ id: "BylineFieldUsageResponse" });
