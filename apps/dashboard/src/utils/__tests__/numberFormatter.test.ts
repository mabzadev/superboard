import { describe, it, expect } from "vitest";
import { numberFormatter } from "../numberFormatter";

describe("numberFormatter", () => {
  it("formats numbers with dot thousands separator", () => {
    const result = numberFormatter.format(1234567);
    expect(result).toBe("1.234.567");
  });

  it("formats small numbers without separator", () => {
    const result = numberFormatter.format(42);
    expect(result).toBe("42");
  });

  it("formats zero", () => {
    const result = numberFormatter.format(0);
    expect(result).toBe("0");
  });
});
