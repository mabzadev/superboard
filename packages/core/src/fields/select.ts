import { z } from "astro/zod";

import type { FieldDefinition, FieldUIHints } from "./types.js";

export interface SelectOptions<T extends readonly [string, ...string[]]> {
	options: T;
	required?: boolean;
	default?: T[number];
	placeholder?: string;
	helpText?: string;
}

export function select<T extends readonly [string, ...string[]]>(
	selectOptions: SelectOptions<T>,
): FieldDefinition<T[number]> {
	const enumSchema = z.enum(selectOptions.options);

	let schema: z.ZodTypeAny;
	if (selectOptions.default !== undefined) {
		schema = enumSchema.default(selectOptions.default);
	} else if (!selectOptions.required) {
		schema = enumSchema.optional();
	} else {
		schema = enumSchema;
	}

	const ui: FieldUIHints = {
		widget: "select",
		placeholder: selectOptions.placeholder,
		helpText: selectOptions.helpText,
		options: selectOptions.options,
	};

	return {
		type: "select",
		columnType: "TEXT",
		schema,
		options: selectOptions,
		ui,
	};
}
