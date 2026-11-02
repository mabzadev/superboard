import { z } from "astro/zod";

import type { FieldDefinition, FieldUIHints } from "./types.js";

export interface SlugOptions {
	required?: boolean;
	from?: string;
	pattern?: RegExp;
	helpText?: string;
}

const DEFAULT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slug(options: SlugOptions = {}): FieldDefinition<string> {
	const pattern = options.pattern || DEFAULT_SLUG_PATTERN;
	const stringSchema = z.string().regex(pattern, "Invalid slug format");

	const schema: z.ZodTypeAny = options.required ? stringSchema : stringSchema.optional();

	const ui: FieldUIHints = {
		widget: "slug",
		helpText: options.helpText || "URL-safe identifier (lowercase, hyphens only)",
		from: options.from,
	};

	return {
		type: "slug",
		columnType: "TEXT",
		schema,
		options,
		ui,
	};
}
