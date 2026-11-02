import { z } from "astro/zod";

import type { FieldDefinition } from "./types.js";

export function reference(
	collection: string,
	options?: {
		required?: boolean;
	},
): FieldDefinition<string | undefined> {
	const schema = z.string();

	return {
		type: "reference",
		columnType: "TEXT",
		schema: options?.required === false ? schema.optional() : schema,
		options: {
			...options,
			collection,
		},
		ui: {
			widget: "reference",
		},
	};
}
