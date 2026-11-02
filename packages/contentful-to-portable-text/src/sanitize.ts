const SAFE_URL_SCHEME_RE = /^(https?:|mailto:|tel:|\/(?!\/)|#)/i;

export function sanitizeUri(uri: string): string {
	if (!uri) return "#";
	const trimmed = uri.trim();
	return SAFE_URL_SCHEME_RE.test(trimmed) ? trimmed : "#";
}
