const SAFE_URL_SCHEME_RE = /^(https?:|mailto:|tel:|\/(?!\/)|#)/i;

export function sanitizeHref(url: string | undefined | null): string {
	if (!url) return "";
	return SAFE_URL_SCHEME_RE.test(url) ? url : "";
}
