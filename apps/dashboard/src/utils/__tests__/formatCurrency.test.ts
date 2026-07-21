import { describe, it, expect } from "vitest";
import { formatCurrencyFromCents } from "../formatCurrency";

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
    // US$ or USD should become just $
    const result = formatCurrencyFromCents(100, "en-US", "USD");
    expect(result).not.toMatch(/US\$/);
    expect(result).toContain("$");
  });
});
