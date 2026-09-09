const owners: Record<string, string> = {
	"identity-admin": "supbrd-plug-user",
	"application-users": "supbrd-plug-user",
	"application-identity": "supbrd-plug-user",
	users: "supbrd-plug-user",
	analytics: "supbrd-plugmod-analytics",
	flows: "supbrd-plugmod-flows",
	onboardings: "supbrd-plugmod-onboardings",
	paywalls: "supbrd-plugmod-paywalls",
	products: "supbrd-plug-products",
	billing: "supbrd-plugmod-billing",
	purchases: "supbrd-plugmod-billing",
	iap: "supbrd-plugmod-billing",
	support: "supbrd-plugmod-support",
	inbox: "supbrd-plugmod-support",
	messaging: "supbrd-plugmod-support",
	marketing: "supbrd-plugmod-marketing",
	push: "supbrd-plugmod-marketing",
	email: "supbrd-plugmod-email",
	"dynamic-links": "supbrd-plugmod-dynamic-links",
	links: "supbrd-plugmod-dynamic-links",
	files: "supbrd-plugmod-files",
	mcp: "supbrd-plugmod-mcp",
	observability: "supbrd-plugmod-observability",
	diagnostics: "supbrd-plugmod-observability",
	platform: "supbrd-plugmod-observability",
	gateway: "supbrd-plugmod-gateway",
	audit: "supbrd-plug-audit",
	content: "supbrd-plug-content",
	settings: "supbrd-plug-settings",
};
const applicationPluginPrefix = /^\/api\/v1\/plugins\/([a-z][a-z0-9-]*)(?:\/|$)/u;
const appPrefix = /^\/api\/v[12]\/app(?=\/|$)/u;
const modulePrefix = /^\/api\/v[12]\/([^/]+)(?:\/|$)/u;
const appSettings = /\/(?:access-key|runtime-policy)(?:\/|$)/u;
const legacyOwners: readonly (readonly [RegExp, string])[] = [
	[/\/analytics(?:\/|$)/u, owners.analytics!],
	[/\/flows(?:\/|$)/u, owners.flows!],
	[/\/onboardings(?:\/|$)/u, owners.onboardings!],
	[/\/paywalls?(?:\/|$)/u, owners.paywalls!],
	[/\/(?:products|packages|offerings|entitlements)(?:\/|$)/u, owners.products!],
	[/\/(?:billing|purchases|refunds|subscriptions)(?:\/|$)/u, owners.billing!],
	[/\/(?:support|inbox|conversations)(?:\/|$)/u, owners.support!],
	[/\/(?:smtp|transactional|delivery-outbox|dead-letters)(?:\/|$)/u, owners.email!],
	[/\/(?:marketing|campaigns|notifications)(?:\/|$)/u, owners.marketing!],
	[/\/(?:links|redirect-rules|redirect_config|domains?)(?:\/|$)/u, owners.links!],
	[/\/(?:files|uploads|objects)(?:\/|$)/u, owners.files!],
	[/\/mcp(?:\/|$)/u, owners.mcp!],
	[/\/(?:events|visitors|dashboard)(?:\/|$)/u, owners.analytics!],
	[/\/(?:users|members|sessions)(?:\/|$)/u, owners.users!],
	[/\/(?:settings|configurations|setup)(?:\/|$)/u, owners.settings!],
	[/\/(?:status|health|incidents|custom-jobs)(?:\/|$)/u, owners.observability!],
	[/\/(?:gateway|oauth-providers)(?:\/|$)/u, owners.gateway!],
];

export function resolvePluginApiOwner(path: string): string {
	const applicationPlugin = applicationPluginPrefix.exec(path)?.[1];
	if (applicationPlugin) return `supbrd-plugmod-${applicationPlugin}`;
	if (
		path === "/health" ||
		path === "/up" ||
		path.startsWith("/internal/") ||
		path === "/api/v1/auth" ||
		path.startsWith("/api/v1/auth/")
	)
		return "supbrd-core";
	if (path === "/auth" || path.startsWith("/auth/")) return "supbrd-plug-user";
	if (path.startsWith("/api/v2/")) return "supbrd-plugmod-billing";
	if (path.startsWith("/_emdash/api/content/")) return "supbrd-plug-content";
	if (path.startsWith("/_emdash/api/superboard/audit/")) return "supbrd-plug-audit";
	const prefix = modulePrefix.exec(path)?.[1];
	if (prefix === "app") {
		const resource = path.replace(appPrefix, "");
		if (appSettings.test(resource)) return "supbrd-plug-settings";
		const owner = resolvePluginApiOwner(resource);
		return owner === "supbrd-core" ? "supbrd-plug-user" : owner;
	}
	return (
		(prefix ? owners[prefix] : null) ??
		legacyOwners.find(([pattern]) => pattern.test(path))?.[1] ??
		"supbrd-core"
	);
}
