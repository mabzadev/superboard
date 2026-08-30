import { describe, expect, it } from "vitest";
import { allowedCorsOrigin, allowedEmbeddableSdkOrigin } from "../index";

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

  it("accepts browser widget origins but rejects non-origin or credentialed values", () => {
    expect(allowedEmbeddableSdkOrigin("https://support.example.test")).toBe(
      "https://support.example.test",
    );
    expect(allowedEmbeddableSdkOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(
      allowedEmbeddableSdkOrigin("https://user:password@support.example.test"),
    ).toBeUndefined();
    expect(
      allowedEmbeddableSdkOrigin("https://support.example.test/widget"),
    ).toBeUndefined();
    expect(allowedEmbeddableSdkOrigin("file:///tmp/widget.html")).toBeUndefined();
    expect(allowedEmbeddableSdkOrigin("null")).toBeUndefined();
  });
});
