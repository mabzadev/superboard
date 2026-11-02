import { z } from "astro/zod";

import type { FieldDefinition, FieldUIHints } from "./types.js";

export interface MultiSelectOptions<T extends readonly [string, ...string[]]> {
	options: T;
	required?: boolean;
	min?: number;
	max?: number;
	helpText?: string;
}

export function multiSelect<T extends readonly [string, ...string[]]>(
	msOptions: MultiSelectOptions<T>,
): FieldDefinition<T[number][]> {
	let arraySchema = z.array(z.enum(msOptions.options));

	if (msOptions.min !== undefined) {
		arraySchema = arraySchema.min(msOptions.min, `Must select at least ${msOptions.min}`);
	}

	if (msOptions.max !== undefined) {
		arraySchema = arraySchema.max(msOptions.max, `Must select at most ${msOptions.max}`);
	}

	const schema: z.ZodTypeAny = msOptions.required ? arraySchema : arraySchema.optional();

	const ui: FieldUIHints = {
		widget: "multiSelect",
		helpText: msOptions.helpText,
		options: msOptions.options,
		min: msOptions.min,
		max: msOptions.max,
	};

	return {
		type: "multiSelect",
		columnType: "JSON",
		schema,
		options: msOptions,
		ui,
	};
}
