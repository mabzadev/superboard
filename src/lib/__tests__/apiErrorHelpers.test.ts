import { describe, it, expect } from "vitest";
import { ApiError } from "../ApiError";
import {
  getApiErrorStatus,
  getApiErrorMessage,
  isFeatureOff,
} from "../apiErrorHelpers";

describe("getApiErrorStatus", () => {
  it("returns the status for an ApiError", () => {
    expect(getApiErrorStatus(new ApiError("nope", 422))).toBe(422);
  });

  it("returns undefined for non-ApiError values", () => {
    expect(getApiErrorStatus(new Error("plain"))).toBeUndefined();
    expect(getApiErrorStatus(null)).toBeUndefined();
  });
});

describe("getApiErrorMessage", () => {
  it("prefers a server-provided message field", () => {
    const err = new ApiError("fallback", 422, undefined, {
      message: "must be a subdomain, ASCII only",
    });
    expect(getApiErrorMessage(err, "fallback")).toBe(
      "must be a subdomain, ASCII only"
    );
  });

  it("falls back to error field, then to the provided fallback", () => {
    const err = new ApiError("x", 409, undefined, {
      error: "already configured",
    });
    expect(getApiErrorMessage(err, "fallback")).toBe("already configured");
    expect(getApiErrorMessage(new ApiError("x", 500), "fallback")).toBe(
      "fallback"
    );
    expect(getApiErrorMessage("not an error", "fallback")).toBe("fallback");
  });
});

describe("isFeatureOff", () => {
  it("returns true when error status matches", () => {
    const err = new ApiError("nope", 503);
    expect(isFeatureOff(err, 503)).toBe(true);
  });
  it("false when status differs", () => {
    expect(isFeatureOff(new ApiError("x", 500), 503)).toBe(false);
  });
  it("false for non-ApiError", () => {
    expect(isFeatureOff(new Error("y"), 503)).toBe(false);
    expect(isFeatureOff(undefined, 404)).toBe(false);
  });
});
