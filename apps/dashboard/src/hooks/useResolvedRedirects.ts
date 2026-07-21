import { DEFAULT } from "@/constants/OptionsConstants";
import type { RedirectURL, RedirectConfig } from "@/types";

export type ResolvedPlatformRedirect = {
  platform: "ios" | "android" | "desktop";
  source: "custom" | "default";
  type: "redirect_web" | "app_or_fallback" | "generated_page";
  url: string;
  showPreview: boolean | null;
  appStoreRedirect: boolean;
};

export type ResolvedRedirects = {
  ios: ResolvedPlatformRedirect;
  android: ResolvedPlatformRedirect;
  desktop: ResolvedPlatformRedirect;
  fallbackUrl: string;
};

export type LinkRedirectsInput = {
  androidRedirectURL: RedirectURL | null;
  androidRedirectType: string;
  iosRedirectURL: RedirectURL | null;
  iosRedirectType: string;
  desktopRedirectURL: RedirectURL | null;
  desktopRedirectType: string;
  showPreviewAndroid: boolean | null;
  showPreviewIOS: boolean | null;
};

export function resolveRedirects(
  link: LinkRedirectsInput,
  projectConfig: RedirectConfig | null
): ResolvedRedirects {
  const fallbackUrl = projectConfig?.default_fallback ?? "";

  const resolveIOS = (): ResolvedPlatformRedirect => {
    if (link.iosRedirectType !== DEFAULT && link.iosRedirectURL) {
      const isAppOrFallback =
        link.iosRedirectURL.open_app_if_installed === true;
      return {
        platform: "ios",
        source: "custom",
        type: isAppOrFallback ? "app_or_fallback" : "redirect_web",
        url: link.iosRedirectURL.url ?? "",
        showPreview:
          link.showPreviewIOS ?? projectConfig?.show_preview_ios ?? false,
        appStoreRedirect: false,
      };
    }
    const iosConfig = projectConfig?.ios?.phone;
    if (iosConfig?.enabled) {
      return {
        platform: "ios",
        source: "default",
        type: "app_or_fallback",
        url: iosConfig.appstore ? "" : iosConfig.fallback_url || fallbackUrl,
        showPreview:
          link.showPreviewIOS ?? projectConfig?.show_preview_ios ?? false,
        appStoreRedirect: !!iosConfig.appstore,
      };
    }
    return {
      platform: "ios",
      source: "default",
      type: "redirect_web",
      url: iosConfig?.fallback_url || fallbackUrl,
      showPreview: null,
      appStoreRedirect: false,
    };
  };

  const resolveAndroid = (): ResolvedPlatformRedirect => {
    if (link.androidRedirectType !== DEFAULT && link.androidRedirectURL) {
      const isAppOrFallback =
        link.androidRedirectURL.open_app_if_installed === true;
      return {
        platform: "android",
        source: "custom",
        type: isAppOrFallback ? "app_or_fallback" : "redirect_web",
        url: link.androidRedirectURL.url ?? "",
        showPreview:
          link.showPreviewAndroid ??
          projectConfig?.show_preview_android ??
          false,
        appStoreRedirect: false,
      };
    }
    const androidConfig = projectConfig?.android?.phone;
    if (androidConfig?.enabled) {
      return {
        platform: "android",
        source: "default",
        type: "app_or_fallback",
        url: androidConfig.appstore
          ? ""
          : androidConfig.fallback_url || fallbackUrl,
        showPreview:
          link.showPreviewAndroid ??
          projectConfig?.show_preview_android ??
          false,
        appStoreRedirect: !!androidConfig.appstore,
      };
    }
    return {
      platform: "android",
      source: "default",
      type: "redirect_web",
      url: androidConfig?.fallback_url || fallbackUrl,
      showPreview: null,
      appStoreRedirect: false,
    };
  };

  const resolveDesktop = (): ResolvedPlatformRedirect => {
    if (link.desktopRedirectType !== DEFAULT && link.desktopRedirectURL) {
      return {
        platform: "desktop",
        source: "custom",
        type: "redirect_web",
        url: link.desktopRedirectURL.url ?? "",
        showPreview: null,
        appStoreRedirect: false,
      };
    }
    const desktopConfig = projectConfig?.desktop?.all;
    if (desktopConfig?.appstore) {
      return {
        platform: "desktop",
        source: "default",
        type: "generated_page",
        url: "",
        showPreview: null,
        appStoreRedirect: true,
      };
    }
    return {
      platform: "desktop",
      source: "default",
      type: "redirect_web",
      url: desktopConfig?.fallback_url || fallbackUrl,
      showPreview: null,
      appStoreRedirect: false,
    };
  };

  return {
    ios: resolveIOS(),
    android: resolveAndroid(),
    desktop: resolveDesktop(),
    fallbackUrl,
  };
}
