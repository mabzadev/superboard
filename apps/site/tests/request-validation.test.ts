import { describe, expect, test } from "vitest";

import { isUlid } from "../src/lib/request-validation.js";

describe("isUlid", () => {
	test("accepts canonical release identifiers", () => {
		expect(isUlid("01K5N5GXEZT07G2FW1Q8BGJZQ2")).toBe(true);
	});

	test("rejects UUIDs before release workflow persistence", () => {
		expect(isUlid("6d89008e-8c32-462f-81ee-1beabef9bbd0")).toBe(false);
	});

	test("rejects lowercase and ambiguous Crockford characters", () => {
		expect(isUlid("01k5n5gxezt07g2fw1q8bgjzq2")).toBe(false);
		expect(isUlid("01K5N5GXEZT07G2FW1Q8BGJZQI")).toBe(false);
	});
});
