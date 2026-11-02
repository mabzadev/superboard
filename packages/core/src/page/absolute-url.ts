import type { PublicPageContext } from "../plugins/types.js";

const HTTP_URL_RE = /^https?:\/\//i;
const PROTOCOL_RELATIVE_RE = /^\/\//;
const PASSTHROUGH_SCHEME_RE = /^data:image\//i;
const OTHER_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
// eslint-disable-next-line no-control-regex -- intentional: rejecting control chars is the whole point of this regex
const WHITESPACE_OR_CONTROL_RE = /[\s\u0000-\u001f\u007f-\u009f]/;
const TRAILING_SLASH_RE = /\/$/;

function isUsableOrigin(origin: string): boolean {
	return origin !== "null" && origin !== "";
}

export function resolveSiteOrigin(
	configuredSiteUrl: string | undefined,
	page: PublicPageContext,
): string | null {
	const candidates = [configuredSiteUrl, page.siteUrl, page.url];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "string") continue;
		try {
			const parsed = new URL(candidate);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
			if (!isUsableOrigin(parsed.origin)) continue;
			return parsed.origin;
		} catch {}
	}
	return null;
}

export function absolutizeMediaUrl(
	url: string | undefined,
	configuredSiteUrl: string | undefined,
	page: PublicPageContext,
): string | null {
	if (!url) return null;

	if (WHITESPACE_OR_CONTROL_RE.test(url)) return null;

	if (HTTP_URL_RE.test(url)) return url;
	if (PASSTHROUGH_SCHEME_RE.test(url)) return url;

	if (PROTOCOL_RELATIVE_RE.test(url)) return null;

	if (OTHER_SCHEME_RE.test(url)) return null;

	const origin = resolveSiteOrigin(configuredSiteUrl, page);
	if (!origin) return url;
	const safePath = url.startsWith("/") ? url : `/${url}`;
	return `${origin.replace(TRAILING_SLASH_RE, "")}${safePath}`;
}
