import { describe, it, expect } from "vitest";
import { getRedirectType } from "../redirectsHelpers";

describe("getRedirectType", () => {
  it('returns "default" for null/undefined', () => {
    expect(getRedirectType(null)).toBe("default");
    expect(getRedirectType(undefined)).toBe("default");
  });

  it('returns "default" when no URL is set', () => {
    expect(getRedirectType({})).toBe("default");
    expect(getRedirectType({ open_app_if_installed: true })).toBe("default");
  });

  it('returns "app_or_fallback" when open_app_if_installed is true with URL', () => {
    expect(
      getRedirectType({
        url: "https://example.com",
        open_app_if_installed: true,
      })
    ).toBe("app_or_fallback");
  });

  it('returns "redirect_web" when open_app_if_installed is false with URL', () => {
    expect(
      getRedirectType({
        url: "https://example.com",
        open_app_if_installed: false,
      })
    ).toBe("redirect_web");
  });

  it('returns "default" when URL is set but open_app_if_installed is undefined', () => {
    expect(getRedirectType({ url: "https://example.com" })).toBe("default");
  });
});
