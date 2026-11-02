import { describe, it, expect } from "vitest";

import { createFieldBody } from "../../../../../../packages/core/src/api/schemas/schema.js";
import { REPEATER_SUB_FIELD_TYPES } from "../../../../../../packages/core/src/schema/types.js";

function repeaterFieldWith(subFieldType: string) {
	return {
		slug: "gallery",
		label: "Gallery",
		type: "repeater",
		validation: {
			subFields: [{ slug: "entry", type: subFieldType, label: "Entry" }],
		},
	};
}

describe("createFieldBody repeater sub-field types", () => {
	it.each([...REPEATER_SUB_FIELD_TYPES])("accepts %s sub-fields", (type) => {
		const result = createFieldBody.safeParse(repeaterFieldWith(type));
		expect(result.success).toBe(true);
	});

	it("rejects unsupported sub-field types", () => {
		for (const type of ["repeater", "portableText", "reference", "nonsense"]) {
			const result = createFieldBody.safeParse(repeaterFieldWith(type));
			expect(result.success).toBe(false);
		}
	});
});
