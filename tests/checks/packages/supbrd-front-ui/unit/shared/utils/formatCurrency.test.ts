import { afterEach, describe, it, expect } from "vitest";

import { formatCurrencyFromCents } from "../../../../../../../packages/supbrd-front-ui/src/shared/utils/formatCurrency.js";

describe("formatCurrencyFromCents", () => {
	it("converts cents to dollar format", () => {
		const result = formatCurrencyFromCents(1999, "en-US", "USD");
		expect(result).toBe("$19.99");
	});

	it("handles zero cents", () => {
		const result = formatCurrencyFromCents(0, "en-US", "USD");
		expect(result).toBe("$0.00");
	});

	it("handles falsy (0) input", () => {
		const result = formatCurrencyFromCents(0, "en-US", "USD");
		expect(result).toContain("0.00");
	});

	it("handles large amounts", () => {
		const result = formatCurrencyFromCents(999999, "en-US", "USD");
		expect(result).toContain("9,999.99");
	});

	it("strips country prefix from currency symbol", () => {
		const result = formatCurrencyFromCents(100, "en-US", "USD");
		expect(result).not.toMatch(/US\$/);
		expect(result).toContain("$");
	});

	describe("without an explicit locale", () => {
		afterEach(() => {
			document.documentElement.lang = "";
		});

		it("follows the dashboard language rather than the browser language", () => {
			document.documentElement.lang = "fr";
			expect(formatCurrencyFromCents(123456)).toMatch(/^1\s234,56\s\$$/u);
			document.documentElement.lang = "en";
			expect(formatCurrencyFromCents(123456)).toBe("$1,234.56");
		});
	});
});
