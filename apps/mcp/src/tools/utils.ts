export type Obj = Record<string, unknown>;

/**
 * Extract the path slug from a full URL or return the input as-is if it's already a slug.
 * "https://myapp.grovs.io/summer-sale" → "summer-sale"
 * "summer-sale" → "summer-sale"
 * "/summer-sale" → "summer-sale"
 */
export function extractPath(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    // pathname is "/summer-sale" → strip leading slash
    return url.pathname.replace(/^\/+/, "");
  } catch {
    // Not a URL — treat as a slug, strip leading slashes
    return trimmed.replace(/^\/+/, "");
  }
}

/** Convert a name into a URL-safe slug. Returns "link" for empty/unparseable input. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128);
  return slug || "link";
}
