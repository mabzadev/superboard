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

const authenticationTabs: Readonly<Record<string, readonly [string, string, string?]>> = {
	"/auth": ["users", "accounts"],
	"/auth/customers": ["users", "profiles"],
	"/auth/referrals": ["users", "referrals"],
	"/auth/directory/users": ["users", "accounts", "directory"],
	"/auth/apps": ["settings", "apps"],
	"/auth/roles": ["settings", "roles"],
	"/auth/scopes": ["settings", "permissions"],
	"/auth/orgs": ["settings", "organizations"],
	"/auth/user-attributes": ["settings", "fields"],
	"/auth/logs": ["settings", "logs"],
	"/auth/saml": ["settings", "login", "sso"],
	"/auth/account-policies": ["settings", "security", "policies"],
	"/auth/access-key": ["settings", "security", "keys"],
};

// Pages that became in-page tabs of a single workspace: the route stays registered, but every
// link and bookmark opens the workspace on the matching tab.
const workspaceTabs: Readonly<Record<string, string>> = {
	"/analytics/app": "/analytics/home",
	"/analytics/installations": "/analytics/users?tab=installations",
	"/analytics/views": "/analytics/users?tab=views",
	"/analytics/dimensions": "/analytics/users?tab=dimensions",
	"/analytics/cohorts": "/analytics/users?tab=cohorts",
	"/analytics/alerts": "/analytics/reports?tab=alerts",
	"/analytics/crashes": "/analytics/reports?tab=crashes",
	"/analytics/feedback": "/analytics/reports?tab=feedback",
	"/monetization/offerings": "/monetization/products?tab=offerings",
	"/monetization/entitlements": "/monetization/products?tab=entitlements",
	"/acquisition/dynamic-links/campaigns": "/acquisition/dynamic-links?tab=campaigns",
	"/acquisition/dynamic-links/domain": "/acquisition/dynamic-links?tab=settings&section=domain",
	"/acquisition/dynamic-links/redirect-rules":
		"/acquisition/dynamic-links?tab=settings&section=routing",
	"/acquisition/dynamic-links/social-media-preview":
		"/acquisition/dynamic-links?tab=settings&section=preview",
	"/acquisition/dynamic-links/tracking": "/acquisition/dynamic-links?tab=settings&section=tracking",
	"/core/web-setup": "/core/libraries?tab=web",
	"/core/ios-setup": "/core/libraries?tab=ios",
	"/core/android-setup": "/core/libraries?tab=android",
};

const authenticationEditors: Readonly<Record<string, readonly [string, string, string, string?]>> =
	{
		"/auth/apps": ["settings", "apps", "apps"],
		"/auth/apps/banners": ["settings", "apps", "banners"],
		"/auth/roles": ["settings", "roles", "roles"],
		"/auth/scopes": ["settings", "permissions", "scopes"],
		"/auth/orgs": ["settings", "organizations", "orgs"],
		"/auth/user-attributes": ["settings", "fields", "fields"],
		"/auth/saml": ["settings", "login", "saml", "sso"],
		"/auth/directory/users": ["users", "accounts", "users", "directory"],
		"/auth/logs/email": ["settings", "logs", "email"],
		"/auth/logs/sms": ["settings", "logs", "sms"],
		"/auth/logs/sign-in": ["settings", "logs", "sign-in"],
	};

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
	const authentication = authenticationTabs[canonical];
	const editor = authenticationEditors[canonical.slice(0, canonical.lastIndexOf("/"))];
	const account = canonical === "/auth/account" || canonical === "/auth/profile";
	const duplicateRegistration = canonical === "/auth/register/with-email";
	const workspace = workspaceTabs[canonical];
	if (
		canonical === url.pathname &&
		!authentication &&
		!editor &&
		!account &&
		!duplicateRegistration &&
		!workspace
	)
		return href;
	const language = /^\/identity\/([a-z]{2}(?:-[A-Za-z]+)?)(?:\/|$)/u.exec(url.pathname)?.[1];
	url.pathname = canonical;
	if (authentication) {
		url.pathname = `/auth/${authentication[0]}`;
		url.searchParams.set("tab", authentication[1]);
		if (authentication[2]) url.searchParams.set("section", authentication[2]);
	}
	if (editor) {
		url.pathname = `/auth/${editor[0]}`;
		url.searchParams.set("tab", editor[1]);
		url.searchParams.set("editor", editor[2]);
		try {
			url.searchParams.set(
				"id",
				decodeURIComponent(canonical.slice(canonical.lastIndexOf("/") + 1)),
			);
		} catch {
			return href;
		}
		if (editor[3]) url.searchParams.set("section", editor[3]);
	}
	if (account) {
		url.pathname = "/auth/settings";
		url.searchParams.set("tab", "security");
		url.searchParams.set("editor", canonical === "/auth/account" ? "account" : "profile");
		url.searchParams.delete("id");
	}
	if (duplicateRegistration) url.pathname = "/auth/register";
	if (workspace) {
		const target = new URL(workspace, url);
		url.pathname = target.pathname;
		for (const [name, value] of target.searchParams) url.searchParams.set(name, value);
	}
	if (language && !url.searchParams.has("lang")) url.searchParams.set("lang", language);
	return `${url.pathname}${url.search}${url.hash}`;
}
