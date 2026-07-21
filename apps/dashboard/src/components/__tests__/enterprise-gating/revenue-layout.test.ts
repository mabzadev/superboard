import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests that the revenue route redirects to /dashboard when IS_ENTERPRISE is false.
 * This catches the real bug: direct URL access to /revenue in a community build.
 */

const mockRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    // Next.js redirect() throws to halt execution — simulate that
    throw new Error("NEXT_REDIRECT");
  },
}));

describe("Revenue layout", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRedirect.mockClear();
  });

  it("redirects to /dashboard when IS_ENTERPRISE is false", async () => {
    vi.doMock("@/lib/edition", () => ({ IS_ENTERPRISE: false }));
    const { default: RevenueLayout } =
      await import("@/app/(protected)/revenue/layout");

    expect(() => RevenueLayout({ children: null })).toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders children when IS_ENTERPRISE is true", async () => {
    vi.doMock("@/lib/edition", () => ({ IS_ENTERPRISE: true }));
    const { default: RevenueLayout } =
      await import("@/app/(protected)/revenue/layout");

    const result = RevenueLayout({ children: "test-content" });
    expect(result).toBe("test-content");
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
