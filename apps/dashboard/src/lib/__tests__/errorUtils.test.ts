import { describe, it, expect, vi } from "vitest";
import { categorizeError, registerGlobalErrorHandlers } from "../errorUtils";
import { ApiError } from "../ApiError";

describe("categorizeError", () => {
  it("categorizes ApiError 401 as session expired", () => {
    const result = categorizeError(new ApiError("Unauthorized", 401));
    expect(result.title).toBe("Session expired");
    expect(result.description).toContain("sign in");
  });

  it("categorizes ApiError 403 as access denied", () => {
    const result = categorizeError(new ApiError("Forbidden", 403));
    expect(result.title).toBe("Access denied");
  });

  it("categorizes ApiError 404 as not found", () => {
    const result = categorizeError(new ApiError("Not found", 404));
    expect(result.title).toBe("Not found");
  });

  it("categorizes ApiError 429 as rate limited", () => {
    const result = categorizeError(new ApiError("Rate limited", 429));
    expect(result.title).toBe("Too many requests");
  });

  it("categorizes ApiError 5xx as server error", () => {
    expect(categorizeError(new ApiError("Error", 500)).title).toBe(
      "Server error"
    );
    expect(categorizeError(new ApiError("Error", 502)).title).toBe(
      "Server error"
    );
    expect(categorizeError(new ApiError("Error", 503)).title).toBe(
      "Server error"
    );
  });

  it("categorizes ApiError 4xx (other) as request failed", () => {
    const result = categorizeError(new ApiError("Bad request", 400));
    expect(result.title).toBe("Request failed");
    expect(result.description).toContain("Invalid request");
  });

  it("categorizes network errors", () => {
    const result = categorizeError(new Error("Failed to fetch data"));
    expect(result.title).toBe("Connection error");
    expect(result.description).toContain("internet connection");
  });

  it("categorizes fetch errors", () => {
    expect(categorizeError(new Error("network error")).title).toBe(
      "Connection error"
    );
    expect(categorizeError(new Error("unable to connect")).title).toBe(
      "Connection error"
    );
    expect(categorizeError(new Error("no internet")).title).toBe(
      "Connection error"
    );
  });

  it("categorizes server errors", () => {
    const result = categorizeError(new Error("500 Internal Server Error"));
    expect(result.title).toBe("Server error");
    expect(result.description).toContain("servers");
  });

  it("categorizes 502 and 503 errors", () => {
    expect(categorizeError(new Error("502 Bad Gateway")).title).toBe(
      "Server error"
    );
    expect(categorizeError(new Error("503 Service Unavailable")).title).toBe(
      "Server error"
    );
  });

  it("returns generic error for unknown messages", () => {
    const result = categorizeError(new Error("Something weird happened"));
    expect(result.title).toBe("Something went wrong!");
    expect(result.description).toBe("An unexpected error occurred.");
  });

  it("handles error with empty message", () => {
    const result = categorizeError(new Error(""));
    expect(result.title).toBe("Something went wrong!");
    expect(result.description).toBe("An unexpected error occurred.");
  });
});

describe("registerGlobalErrorHandlers", () => {
  it("adds unhandledrejection listener", () => {
    const spy = vi.spyOn(window, "addEventListener");
    const callback = vi.fn();
    registerGlobalErrorHandlers(callback);
    expect(spy).toHaveBeenCalledWith(
      "unhandledrejection",
      expect.any(Function)
    );
    spy.mockRestore();
  });

  it("calls callback with Error rejection", () => {
    const callback = vi.fn();
    const spy = vi.spyOn(window, "addEventListener");
    registerGlobalErrorHandlers(callback);

    const handler = spy.mock.calls.find(
      (call) => call[0] === "unhandledrejection"
    )?.[1] as (event: PromiseRejectionEvent) => void;

    const error = new Error("test rejection");
    handler({
      reason: error,
    } as PromiseRejectionEvent);

    expect(callback).toHaveBeenCalledWith("unhandled_rejection", {
      error_message: "test rejection",
      error_type: "Error",
    });

    spy.mockRestore();
  });

  it("calls callback with non-Error rejection", () => {
    const callback = vi.fn();
    const spy = vi.spyOn(window, "addEventListener");
    registerGlobalErrorHandlers(callback);

    const handler = spy.mock.calls.find(
      (call) => call[0] === "unhandledrejection"
    )?.[1] as (event: PromiseRejectionEvent) => void;

    handler({
      reason: "string error",
    } as PromiseRejectionEvent);

    expect(callback).toHaveBeenCalledWith("unhandled_rejection", {
      error_message: "string error",
      error_type: "Unknown",
    });

    spy.mockRestore();
  });
});
