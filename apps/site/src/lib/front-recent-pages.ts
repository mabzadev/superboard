/** Recently opened menu pages, kept per instance and operator for the command palette. */
export interface FrontRecentPage {
	href: string;
	label: string;
	hint?: string;
}

const RECENT_PAGES_LIMIT = 8;

export function frontRecentPagesKey(instanceId: string, operatorId: string | undefined) {
	return `superboard:${instanceId}:${operatorId ?? "anonymous"}:recent-pages`;
}

function isRecentPage(entry: unknown): entry is FrontRecentPage {
	if (typeof entry !== "object" || entry === null) return false;
	const { href, label, hint } = entry as Partial<Record<keyof FrontRecentPage, unknown>>;
	return (
		typeof href === "string" &&
		href.startsWith("/") &&
		!href.startsWith("//") &&
		typeof label === "string" &&
		(hint === undefined || typeof hint === "string")
	);
}

export function readFrontRecentPages(key: string): FrontRecentPage[] {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		if (!Array.isArray(value)) return [];
		return value
			.filter((entry: unknown): entry is FrontRecentPage => isRecentPage(entry))
			.slice(0, RECENT_PAGES_LIMIT);
	} catch {
		return [];
	}
}

/** Moves the page to the front of the list; storage failures (private mode, quota) are ignored. */
export function recordFrontRecentPage(key: string, page: FrontRecentPage) {
	try {
		const pages = [page, ...readFrontRecentPages(key).filter(({ href }) => href !== page.href)];
		localStorage.setItem(key, JSON.stringify(pages.slice(0, RECENT_PAGES_LIMIT)));
	} catch {
		return;
	}
}
