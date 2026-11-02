const AUTH_ALLOWLIST = new Set(["/_emdash/api/auth/me"]);

const BLOCKED_PREFIXES = [
	"/_emdash/api/auth/",
	"/_emdash/api/setup/",
	"/_emdash/api/oauth/",
	"/_emdash/api/tokens/",
	"/_emdash/api/users/invite",
	"/_emdash/api/plugins/install",
	"/_emdash/api/plugins/marketplace",
	"/_emdash/api/media/upload",
	"/_emdash/api/snapshot",
];

export function isBlockedInPlayground(pathname: string): boolean {
	if (AUTH_ALLOWLIST.has(pathname)) {
		return false;
	}

	for (const prefix of BLOCKED_PREFIXES) {
		if (pathname === prefix || pathname.startsWith(prefix)) {
			return true;
		}
	}
	return false;
}
