const DEFAULT_REDIRECT = "/_emdash/admin";
const LEADING_SLASHES = /^\/+/;

export function sanitizeRedirectUrl(raw: string): string {
	if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) {
		return raw;
	}
	return DEFAULT_REDIRECT;
}

export function contentUrl(collection: string, slug: string, urlPattern?: string): string {
	const safe = slug.replace(LEADING_SLASHES, "");
	return urlPattern ? urlPattern.replace("{slug}", safe) : `/${collection}/${safe}`;
}

export const SAFE_URL_RE = /^https?:\/\//i;

export function isSafeUrl(url: string): boolean {
	return SAFE_URL_RE.test(url);
}

export function safeIconUrl(url: string, width: number): string | null {
	if (!SAFE_URL_RE.test(url)) return null;
	try {
		const u = new URL(url);
		u.searchParams.set("w", String(width));
		return u.href;
	} catch {
		return null;
	}
}
