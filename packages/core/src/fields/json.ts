import { z } from "astro/zod";

import type { FieldDefinition, FieldUIHints } from "./types.js";

export interface JsonOptions<T = unknown> {
	required?: boolean;
	schema?: z.ZodType<T>;
	helpText?: string;
}

export function json<T = unknown>(options: JsonOptions<T> = {}): FieldDefinition<T> {
	let schema: z.ZodTypeAny = options.schema ?? z.unknown();

	if (!options.required && !options.schema) {
		schema = z.unknown().optional();
	}

	const ui: FieldUIHints = {
		widget: "json",
		helpText: options.helpText || "JSON data",
	};

	return {
		type: "json",
		columnType: "JSON",
		schema,
		options,
		ui,
	};
}
