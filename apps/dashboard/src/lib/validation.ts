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
 * Checks outbound webhook destinations before submission. The Support service
 * repeats this validation authoritatively before persisting or dispatching.
 */
export const isSafePublicHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    )
      return false;
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/gu, "")
      .replace(/\.$/u, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".home.arpa") ||
      hostname === "::" ||
      hostname === "::1" ||
      /^(?:fc|fd|fe[89ab])/u.test(hostname)
    )
      return false;
    const octets = hostname.split(".").map(Number);
    if (
      octets.length === 4 &&
      octets.every(
        (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255
      )
    ) {
      const a = octets[0] ?? -1;
      const b = octets[1] ?? -1;
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19))
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
};

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
