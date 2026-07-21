import { describe, it, expect } from "vitest";
import {
  resolveRedirects,
  type LinkRedirectsInput,
} from "../useResolvedRedirects";
import { DEFAULT } from "@/constants/OptionsConstants";
import type { RedirectConfig } from "@/types";

const baseLink: LinkRedirectsInput = {
  androidRedirectURL: null,
  androidRedirectType: DEFAULT,
  iosRedirectURL: null,
  iosRedirectType: DEFAULT,
  desktopRedirectURL: null,
  desktopRedirectType: DEFAULT,
  showPreviewAndroid: null,
  showPreviewIOS: null,
};

const makeConfig = (overrides?: Partial<RedirectConfig>): RedirectConfig =>
  ({
    default_fallback: "https://fallback.com",
    show_preview_ios: false,
    show_preview_android: false,
    ios: { phone: { enabled: false, fallback_url: "", appstore: false } },
    android: { phone: { enabled: false, fallback_url: "", appstore: false } },
    desktop: { all: { fallback_url: "", appstore: false } },
    ...overrides,
  }) as RedirectConfig;

describe("resolveRedirects", () => {
  describe("iOS resolution", () => {
    it("uses custom redirect when type is not default", () => {
      const link: LinkRedirectsInput = {
        ...baseLink,
        iosRedirectType: "custom",
        iosRedirectURL: {
          url: "https://ios-custom.com",
          open_app_if_installed: false,
        },
      };
      const result = resolveRedirects(link, makeConfig());
      expect(result.ios).toMatchObject({
        platform: "ios",
        source: "custom",
        type: "redirect_web",
        url: "https://ios-custom.com",
      });
    });

    it("resolves custom app_or_fallback when open_app_if_installed is true", () => {
      const link: LinkRedirectsInput = {
        ...baseLink,
        iosRedirectType: "custom",
        iosRedirectURL: {
          url: "https://ios-fallback.com",
          open_app_if_installed: true,
        },
      };
      const result = resolveRedirects(link, makeConfig());
      expect(result.ios.type).toBe("app_or_fallback");
      expect(result.ios.source).toBe("custom");
    });

    it("uses default config when type is DEFAULT and config is enabled", () => {
      const config = makeConfig({
        ios: {
          phone: {
            enabled: true,
            fallback_url: "https://ios-default.com",
            appstore: false,
          },
        },
      });
      const result = resolveRedirects(baseLink, config);
      expect(result.ios).toMatchObject({
        source: "default",
        type: "app_or_fallback",
        url: "https://ios-default.com",
      });
    });

    it("uses app store redirect when appstore is true in config", () => {
      const config = makeConfig({
        ios: { phone: { enabled: true, fallback_url: "", appstore: true } },
      });
      const result = resolveRedirects(baseLink, config);
      expect(result.ios.appStoreRedirect).toBe(true);
      expect(result.ios.url).toBe("");
    });

    it("falls back to default_fallback when config is disabled", () => {
      const config = makeConfig();
      const result = resolveRedirects(baseLink, config);
      expect(result.ios).toMatchObject({
        source: "default",
        type: "redirect_web",
        url: "https://fallback.com",
      });
    });

    it("uses link-level showPreviewIOS when set", () => {
      const link: LinkRedirectsInput = {
        ...baseLink,
        iosRedirectType: "custom",
        iosRedirectURL: {
          url: "https://test.com",
          open_app_if_installed: false,
        },
        showPreviewIOS: true,
      };
      const result = resolveRedirects(link, makeConfig());
      expect(result.ios.showPreview).toBe(true);
    });
  });

  describe("Android resolution", () => {
    it("uses custom redirect when type is not default", () => {
      const link: LinkRedirectsInput = {
        ...baseLink,
        androidRedirectType: "custom",
        androidRedirectURL: {
          url: "https://android-custom.com",
          open_app_if_installed: false,
        },
      };
      const result = resolveRedirects(link, makeConfig());
      expect(result.android).toMatchObject({
        platform: "android",
        source: "custom",
        type: "redirect_web",
        url: "https://android-custom.com",
      });
    });

    it("uses default config with app store", () => {
      const config = makeConfig({
        android: { phone: { enabled: true, fallback_url: "", appstore: true } },
      });
      const result = resolveRedirects(baseLink, config);
      expect(result.android.appStoreRedirect).toBe(true);
      expect(result.android.type).toBe("app_or_fallback");
    });

    it("falls back to default_fallback when config is disabled", () => {
      const config = makeConfig();
      const result = resolveRedirects(baseLink, config);
      expect(result.android).toMatchObject({
        source: "default",
        type: "redirect_web",
        url: "https://fallback.com",
      });
    });
  });

  describe("Desktop resolution", () => {
    it("uses custom redirect when type is not default", () => {
      const link: LinkRedirectsInput = {
        ...baseLink,
        desktopRedirectType: "custom",
        desktopRedirectURL: {
          url: "https://desktop-custom.com",
          open_app_if_installed: false,
        },
      };
      const result = resolveRedirects(link, makeConfig());
      expect(result.desktop).toMatchObject({
        platform: "desktop",
        source: "custom",
        type: "redirect_web",
        url: "https://desktop-custom.com",
      });
    });

    it("generates page when config has appstore", () => {
      const config = makeConfig({
        desktop: { all: { fallback_url: "", appstore: true } },
      });
      const result = resolveRedirects(baseLink, config);
      expect(result.desktop).toMatchObject({
        source: "default",
        type: "generated_page",
        appStoreRedirect: true,
      });
    });

    it("redirects to web when no appstore", () => {
      const config = makeConfig({
        desktop: {
          all: {
            fallback_url: "https://desktop-fallback.com",
            appstore: false,
          },
        },
      });
      const result = resolveRedirects(baseLink, config);
      expect(result.desktop).toMatchObject({
        source: "default",
        type: "redirect_web",
        url: "https://desktop-fallback.com",
      });
    });
  });

  describe("fallback URL", () => {
    it("returns project default_fallback", () => {
      const config = makeConfig({
        default_fallback: "https://my-fallback.com",
      });
      const result = resolveRedirects(baseLink, config);
      expect(result.fallbackUrl).toBe("https://my-fallback.com");
    });

    it("returns empty string when no config", () => {
      const result = resolveRedirects(baseLink, null);
      expect(result.fallbackUrl).toBe("");
    });
  });
});
