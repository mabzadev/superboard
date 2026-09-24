const exactPaths: Readonly<Record<string, string>> = {
	"/": "/analytics/home",
	"/app": "/analytics/app",
	"/dashboard": "/analytics",
	"/analytics/dashboards": "/analytics",
	"/login": "/auth/login",
	"/accept-invite": "/auth/accept-invite",
	"/new_password": "/auth/new-password",
	"/register": "/auth/register",
	"/register/with_email": "/auth/register/with-email",
	"/reset_password": "/auth/reset-password",
	"/account": "/auth/account",
	"/identity": "/auth",
	"/app/members": "/auth/users",
	"/app/libraries": "/core/libraries",
	"/app/android-setup": "/core/android-setup",
	"/app/ios-setup": "/core/ios-setup",
	"/app/web-setup": "/core/web-setup",
	"/project-settings": "/core/settings",
	"/infrastructure": "/core/infrastructure",
	"/system/audit": "/core/audit",
	"/system/gateway": "/core/gateway",
	"/system/content": "/data/content",
	"/system/files": "/data/files",
	"/system/email": "/communication/email",
	"/marketing/email": "/communication/marketing-email",
	"/notifications": "/communication/notifications",
	"/message-preview-craft": "/communication/message-preview",
	"/products": "/monetization/products",
	"/products/products": "/monetization/products/products",
	"/flows": "/acquisition/overview",
	"/dynamic-links/links": "/acquisition/dynamic-links",
};
const prefixes = [
	["/app", "/auth"],
	["/products", "/monetization"],
	["/marketing", "/communication"],
	["/flows", "/acquisition"],
	["/dynamic-links", "/acquisition/dynamic-links"],
	["/onboardings", "/acquisition/onboardings"],
	["/paywalls", "/acquisition/paywalls"],
	["/mcp", "/core/mcp"],
] as const;
const identityPath = /^\/identity\/(?:[a-z]{2}(?:-[A-Za-z]+)?|:lang)(\/.*)?$/u;

export function canonicalFrontPath(path: string): string {
	const exact = exactPaths[path];
	if (exact) return exact;
	const identity = identityPath.exec(path);
	if (identity) {
		const suffix = identity[1] ?? "";
		if (suffix === "/account") return "/auth/account-policies";
		if (suffix === "/dashboard") return "/auth/settings";
		if (suffix === "/users" || suffix.startsWith("/users/")) return `/auth/directory${suffix}`;
		return `/auth${suffix}`;
	}
	for (const [before, after] of prefixes) {
		if (path === before || path.startsWith(`${before}/`)) return after + path.slice(before.length);
	}
	return path;
}

export function canonicalFrontHref(href: string): string {
	if (!href.startsWith("/") || href.startsWith("//")) return href;
	const url = new URL(href, "https://superboard.invalid");
	const canonical = canonicalFrontPath(url.pathname.replace(/\/$/u, "") || "/");
	if (canonical === url.pathname) return href;
	const language = /^\/identity\/([a-z]{2}(?:-[A-Za-z]+)?)(?:\/|$)/u.exec(url.pathname)?.[1];
	url.pathname = canonical;
	if (language && !url.searchParams.has("lang")) url.searchParams.set("lang", language);
	return `${url.pathname}${url.search}${url.hash}`;
}
