import { z } from "astro/zod";

import type { FieldDefinition, FieldUIHints } from "./types.js";

export interface IntegerOptions {
	required?: boolean;
	min?: number;
	max?: number;
	placeholder?: string;
	helpText?: string;
}

export function integer(options: IntegerOptions = {}): FieldDefinition<number> {
	let intSchema = z.number().int("Must be a whole number");

	if (options.min !== undefined) {
		intSchema = intSchema.min(options.min, `Must be at least ${options.min}`);
	}

	if (options.max !== undefined) {
		intSchema = intSchema.max(options.max, `Must be at most ${options.max}`);
	}

	const schema: z.ZodTypeAny = options.required ? intSchema : intSchema.optional();

	const ui: FieldUIHints = {
		widget: "number",
		placeholder: options.placeholder,
		helpText: options.helpText,
		min: options.min,
		max: options.max,
		step: 1,
	};

	return {
		type: "integer",
		columnType: "INTEGER",
		schema,
		options,
		ui,
	};
}
