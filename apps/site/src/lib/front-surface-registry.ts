const exactSurfaceComponents = new Map<string, string>([
	["/", "dashboard.overview"],
	["/dashboard", "dashboard.overview"],
	["/accept-invite", "operator.accept_invite"],
	["/account", "operator.account"],
	["/login", "operator.login"],
	["/new_password", "operator.password"],
	["/register", "operator.register"],
	["/register/with_email", "operator.register"],
	["/reset_password", "operator.password"],
	["/app/access-key", "user.access_key"],
	["/app/android-setup", "settings.android_sdk"],
	["/app/customers", "user.customers"],
	["/app/ios-setup", "settings.ios_sdk"],
	["/app/libraries", "settings.libraries"],
	["/app/referrals", "user.referrals"],
	["/app/users", "user.members"],
	["/app/web-setup", "settings.web_sdk"],
	["/identity", "identity.redirect"],
	["/infrastructure", "observability.infrastructure"],
	["/mcp/authorize", "mcp.authorize"],
	["/message-preview-craft", "marketing.message_preview"],
	["/project-settings", "settings.project"],
	["/analytics", "analytics.overview"],
	...[
		"alerts",
		"cohorts",
		"crashes",
		"dashboards",
		"dimensions",
		"events",
		"feedback",
		"insights",
		"installations",
		"purchases",
		"remote-config",
		"reports",
		"settings",
		"users",
		"views",
	].map((name) => [`/analytics/${name}`, `analytics.${name}`] as const),
	["/marketing/campaigns", "marketing.campaigns"],
	["/marketing/channels", "marketing.channels"],
	["/marketing/email", "marketing.email"],
	["/marketing/in-app-messages", "marketing.in_app_messages"],
	["/marketing/journeys", "marketing.journeys"],
	["/marketing/settings", "marketing.settings"],
	["/marketing/statistics", "marketing.statistics"],
	["/products/customers", "billing.customers"],
	["/products/entitlements", "billing.entitlements"],
	["/products/offerings", "products.offerings"],
	["/products/purchases", "billing.purchases"],
	["/paywalls", "paywalls.editor"],
	["/paywalls/statistics", "paywalls.statistics"],
	["/onboardings", "onboardings.editor"],
	["/onboardings/statistics", "onboardings.statistics"],
	...[
		"automations",
		"captain",
		"channels",
		"configuration",
		"contacts",
		"help-center",
		"inbox",
		"integrations",
		"proactive-support",
		"quality",
		"reports",
		"settings",
		"workforce",
	].map((name) => [`/support/${name}`, `support.${name}`] as const),
	["/flows", "flows.overview"],
	["/flows/components", "flows.components"],
	["/flows/launchpad", "flows.launchpad"],
	["/flows/settings/environments", "flows.environments"],
	["/flows/settings/localization", "flows.localization"],
	["/flows/settings/sdk", "flows.sdk"],
	["/flows/users", "flows.users"],
	["/flows/workflows", "flows.workflows"],
	["/dynamic-links/campaigns", "dynamic_links.campaigns"],
	["/dynamic-links/domain", "dynamic_links.domain"],
	["/dynamic-links/links", "dynamic_links.links"],
	["/dynamic-links/redirect-rules", "dynamic_links.redirect_rules"],
	["/dynamic-links/social-media-preview", "dynamic_links.social_preview"],
	["/dynamic-links/tracking", "dynamic_links.tracking"],
]);

const dynamicSurfaceComponents: Array<{ pattern: RegExp; component: string }> = [
	{ pattern: /^\/identity\/(?:en|fr)(?:\/.*)?$/u, component: "identity.surface" },
	{ pattern: /^\/flows\/users\/[^/]+$/u, component: "flows.user_details" },
	{ pattern: /^\/flows\/workflows\/[^/]+$/u, component: "flows.workflow_editor" },
	{
		pattern: /^\/dynamic-links\/campaigns\/[^/]+$/u,
		component: "dynamic_links.campaign_links",
	},
];

export function frontSurfaceComponent(path: string): string | null {
	const exact = exactSurfaceComponents.get(path);
	if (exact) return exact;
	return dynamicSurfaceComponents.find(({ pattern }) => pattern.test(path))?.component ?? null;
}

export function hasExecutableFrontSurface(pathPattern: string): boolean {
	if (exactSurfaceComponents.has(pathPattern)) return true;
	if (pathPattern === "/identity/:lang" || pathPattern.startsWith("/identity/:lang/")) {
		return true;
	}
	return new Set(["/flows/users/:id", "/flows/workflows/:id", "/dynamic-links/campaigns/:id"]).has(
		pathPattern,
	);
}

export const EXECUTABLE_FRONT_SURFACE_COUNT =
	exactSurfaceComponents.size + dynamicSurfaceComponents.length;
