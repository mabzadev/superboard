const ALLOWED_API_PREFIXES = [
	"/_emdash/api/content/",
	"/_emdash/api/schema",
	"/_emdash/api/manifest",
	"/_emdash/api/dashboard",
	"/_emdash/api/search",
	"/_emdash/api/media",
	"/_emdash/api/taxonomies",
	"/_emdash/api/menus",
	"/_emdash/api/snapshot",
];

export function isBlockedInPreview(pathname: string): boolean {
	if (!pathname.startsWith("/_emdash/")) {
		return false;
	}

	for (const prefix of ALLOWED_API_PREFIXES) {
		if (pathname === prefix || pathname.startsWith(prefix)) {
			return false;
		}
	}

	return true;
}
