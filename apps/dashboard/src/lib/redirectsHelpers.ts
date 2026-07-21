import {
  APP_OR_FALLBACK,
  DEFAULT,
  REDIRECT_WEB,
} from "../constants/OptionsConstants";

interface RedirectURL {
  url?: string;
  open_app_if_installed?: boolean;
}

export const getRedirectType = (
  redirectURL: RedirectURL | null | undefined
): string => {
  if (!redirectURL) return DEFAULT;

  const hasFallback = !!redirectURL.url;

  if (redirectURL.open_app_if_installed === true && hasFallback) {
    return APP_OR_FALLBACK;
  }

  if (redirectURL.open_app_if_installed === false && hasFallback) {
    return REDIRECT_WEB;
  }

  return DEFAULT;
};
