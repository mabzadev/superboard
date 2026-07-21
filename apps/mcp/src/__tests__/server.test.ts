import { describe, it, expect } from "vitest";
import { extractToken, formatError } from "../server.js";
import type { ToolExtra } from "../server.js";

describe("extractToken", () => {
  it("returns token when present", () => {
    const extra = {
      authInfo: { token: "abc123", clientId: "c", scopes: [] },
    } as unknown as ToolExtra;

    expect(extractToken(extra)).toBe("abc123");
  });

  it("throws when authInfo is missing", () => {
    const extra = {} as unknown as ToolExtra;

    expect(() => extractToken(extra)).toThrow("Not authenticated");
  });

  it("throws when token is empty string", () => {
    const extra = {
      authInfo: { token: "", clientId: "c", scopes: [] },
    } as unknown as ToolExtra;

    expect(() => extractToken(extra)).toThrow("Not authenticated");
  });
});

describe("formatError", () => {
  it("extracts message from Error instances", () => {
    expect(formatError(new Error("something broke"))).toBe("something broke");
  });

  it("handles string errors", () => {
    expect(formatError("raw string error")).toBe("raw string error");
  });

  it("handles number errors", () => {
    expect(formatError(42)).toBe("42");
  });

  it("handles null", () => {
    expect(formatError(null)).toBe("null");
  });

  it("handles undefined", () => {
    expect(formatError(undefined)).toBe("undefined");
  });

  it("handles object errors", () => {
    expect(formatError({ code: "ENOENT" })).toBe('{"code":"ENOENT"}');
  });
});
