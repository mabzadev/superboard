import { afterEach, describe, it, expect, vi } from "vitest";

import { numberFormatter } from "../../../../../../../packages/supbrd-front-ui/src/shared/utils/numberFormatter.js";

describe("numberFormatter", () => {
	afterEach(() => {
		document.documentElement.lang = "";
		vi.restoreAllMocks();
	});

	it("groups thousands the English way on an English dashboard", () => {
		document.documentElement.lang = "en";
		expect(numberFormatter.format(1234567)).toBe("1,234,567");
		expect(numberFormatter.format(1234.5)).toBe("1,234.5");
	});

	it("groups thousands the French way on a French dashboard", () => {
		document.documentElement.lang = "fr";
		expect(numberFormatter.format(1234567)).toMatch(/^1\s234\s567$/u);
		expect(numberFormatter.format(1234.5)).toMatch(/^1\s234,5$/u);
	});

	it("follows a language change without reloading", () => {
		document.documentElement.lang = "fr";
		expect(numberFormatter.format(1234)).toMatch(/^1\s234$/u);
		document.documentElement.lang = "en";
		expect(numberFormatter.format(1234)).toBe("1,234");
	});

	it("falls back to the browser language when the dashboard has none", () => {
		vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
		expect(numberFormatter.format(1234567)).toMatch(/^1\s234\s567$/u);
	});

	it("formats small numbers and zero without separator", () => {
		document.documentElement.lang = "fr";
		expect(numberFormatter.format(42)).toBe("42");
		expect(numberFormatter.format(0)).toBe("0");
	});
});
