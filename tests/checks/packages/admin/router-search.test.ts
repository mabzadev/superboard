import { describe, expect, it } from "vitest";

import { parseBylinesLocaleSearch } from "../../../../packages/admin/src/router";

describe("parseBylinesLocaleSearch", () => {
	it("returns the locale string when present and non-empty", () => {
		expect(parseBylinesLocaleSearch({ locale: "de-de" })).toEqual({ locale: "de-de" });
	});

	it("normalizes empty-string locale to undefined", () => {
		expect(parseBylinesLocaleSearch({ locale: "" })).toEqual({ locale: undefined });
	});

	it("returns undefined when locale is missing entirely", () => {
		expect(parseBylinesLocaleSearch({})).toEqual({ locale: undefined });
	});

	it("returns undefined when locale is not a string", () => {
		expect(parseBylinesLocaleSearch({ locale: 42 })).toEqual({ locale: undefined });
		expect(parseBylinesLocaleSearch({ locale: null })).toEqual({ locale: undefined });
	});
});
