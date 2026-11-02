import { z } from "astro/zod";

import type { FieldDefinition, FieldUIHints } from "./types.js";

export interface RichTextOptions {
	required?: boolean;
	helpText?: string;
}

export function richText(options: RichTextOptions = {}): FieldDefinition<string> {
	const stringSchema = z.string();

	const schema: z.ZodTypeAny = options.required ? stringSchema : stringSchema.optional();

	const ui: FieldUIHints = {
		widget: "richText",
		helpText: options.helpText || "Markdown formatted text",
	};

	return {
		type: "richText",
		columnType: "TEXT",
		schema,
		options,
		ui,
	};
}
