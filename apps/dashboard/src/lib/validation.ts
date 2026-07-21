import isURL from "validator/lib/isURL";

/**
 * Type guard: checks if a value is a non-empty string after trimming.
 */
export const hasText = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";

/**
 * Checks if a URL is a valid HTTPS URL.
 */
export const isValidHttpsUrl = (
  url: string | undefined | null
): url is string => !!url && isURL(url) && url.startsWith("https://");

/**
 * Validates that a redirect URL is valid for a given redirect type.
 * Returns true if the redirect type is DEFAULT (no custom URL needed)
 * or if a valid HTTPS URL is provided.
 */
/**
 * Checks if a string matches a URL scheme pattern (e.g. myapp://)
 */
export const isUrlSchemeValid = (text: string): boolean => {
  const regx = /([A-Z,a-z])+(:)+(\/\/)/g;
  return regx.test(text);
};

export const isRedirectUrlValid = (
  redirectType: string,
  url: string | undefined | null,
  defaultType: string
): boolean => redirectType === defaultType || isValidHttpsUrl(url);
