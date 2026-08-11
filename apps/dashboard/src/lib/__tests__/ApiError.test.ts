import { describe, it, expect } from "vitest";
import {
  ApiError,
  getErrorMessage,
  parseApiErrorPayload,
} from "../ApiError";

describe("ApiError", () => {
  it("creates an error with message and status", () => {
    const error = new ApiError("Not found", 404);
    expect(error.message).toBe("Not found");
    expect(error.status).toBe(404);
    expect(error.name).toBe("ApiError");
  });

  it("is an instance of Error", () => {
    const error = new ApiError("Bad request", 400);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
  });

  it("stores optional code and data", () => {
    const error = new ApiError("Conflict", 409, "DUPLICATE", {
      field: "email",
    });
    expect(error.code).toBe("DUPLICATE");
    expect(error.data).toEqual({ field: "email" });
  });

  it("has undefined code and data when not provided", () => {
    const error = new ApiError("Error", 500);
    expect(error.code).toBeUndefined();
    expect(error.data).toBeUndefined();
  });
});

describe("getErrorMessage", () => {
  it("returns mapped message for known status codes", () => {
    expect(getErrorMessage(400)).toContain("Invalid request");
    expect(getErrorMessage(403)).toContain("permission");
    expect(getErrorMessage(404)).toContain("not found");
    expect(getErrorMessage(409)).toContain("conflicts");
    expect(getErrorMessage(422)).toContain("invalid");
    expect(getErrorMessage(429)).toContain("Too many requests");
  });

  it("returns server error for 5xx status codes", () => {
    expect(getErrorMessage(500)).toContain("Server error");
    expect(getErrorMessage(502)).toContain("Server error");
    expect(getErrorMessage(503)).toContain("Server error");
  });

  it("returns default message for unknown status codes", () => {
    expect(getErrorMessage(418)).toContain("unexpected error");
  });
});

describe("parseApiErrorPayload", () => {
  it("reads the stable nested public error contract", () => {
    expect(
      parseApiErrorPayload({
        error: {
          code: "legacy_project_id_invalid",
          message: "A valid legacy project ID is required",
          retryable: false,
          request_id: "request-1",
        },
      })
    ).toEqual({
      code: "legacy_project_id_invalid",
      message: "A valid legacy project ID is required",
    });
  });

  it("keeps compatibility with flat API errors", () => {
    expect(
      parseApiErrorPayload({
        code: "invalid_request",
        message: "Invalid request",
      })
    ).toEqual({ code: "invalid_request", message: "Invalid request" });
    expect(parseApiErrorPayload({ error: "Unauthorized" })).toEqual({
      code: undefined,
      message: "Unauthorized",
    });
  });

  it("fails safely for non-object responses", () => {
    expect(parseApiErrorPayload(null)).toEqual({});
    expect(parseApiErrorPayload("invalid")).toEqual({});
  });
});
