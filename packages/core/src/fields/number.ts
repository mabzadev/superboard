import { z } from "astro/zod";

import type { FieldDefinition, FieldUIHints } from "./types.js";

export interface NumberOptions {
	required?: boolean;
	min?: number;
	max?: number;
	integer?: boolean;
	placeholder?: string;
	helpText?: string;
}

export function number(options: NumberOptions = {}): FieldDefinition<number> {
	let numberSchema = z.number();

	if (options.integer) {
		numberSchema = numberSchema.int("Must be an integer");
	}

	if (options.min !== undefined) {
		numberSchema = numberSchema.min(options.min, `Must be at least ${options.min}`);
	}

	if (options.max !== undefined) {
		numberSchema = numberSchema.max(options.max, `Must be at most ${options.max}`);
	}

	const schema: z.ZodTypeAny = options.required ? numberSchema : numberSchema.optional();

	const ui: FieldUIHints = {
		widget: "number",
		placeholder: options.placeholder,
		helpText: options.helpText,
		min: options.min,
		max: options.max,
	};

	return {
		type: "number",
		columnType: "REAL",
		schema,
		options,
		ui,
	};
}
