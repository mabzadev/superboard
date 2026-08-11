import { describe, expect, it } from "vitest";
import { allowedCorsOrigin } from "../index";

describe("target-owned CORS policy", () => {
  const configured = JSON.stringify([
    "https://grow.example.test",
    "https://reference.example.test",
  ]);

  it("allows only an exact configured HTTPS origin", () => {
    expect(allowedCorsOrigin("https://grow.example.test", configured)).toBe("https://grow.example.test");
    expect(allowedCorsOrigin("https://reference.example.test", configured)).toBe("https://reference.example.test");
    expect(allowedCorsOrigin("https://evil.example.test", configured)).toBeUndefined();
    expect(allowedCorsOrigin("https://grow.example.test.evil.test", configured)).toBeUndefined();
  });

  it("fails closed for malformed configuration and origin paths", () => {
    expect(allowedCorsOrigin("https://grow.example.test/path", configured)).toBeUndefined();
    expect(allowedCorsOrigin("null", configured)).toBeUndefined();
    expect(allowedCorsOrigin("https://grow.example.test", "not-json")).toBeUndefined();
  });
});
