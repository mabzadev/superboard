import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const dashboard = navigationGroup({
	group_id: "dashboard",
	group_label: "Dashboard",
	group_order: 0,
});
const analytics = navigationGroup({
	group_id: "analytics",
	group_label: "Analytics",
	group_order: 8,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-analytics",
	plugin_label: "Analytics",
	description:
		"Explore the analytics data sources and operational insights selected by this Front Release.",
	surfaces: [
		{ path_pattern: "/", title: "SuperBoard" },
		{
			path_pattern: "/app",
			title: "SuperBoard",
			route_id: "superboard.app_shell",
			page_id: "page.superboard_app",
			transition: "authenticated_home",
		},
		{ path_pattern: "/dashboard", title: "Dashboard", navigation: dashboard("Dashboard", 0) },
		{ path_pattern: "/analytics", title: "Analytics", navigation: analytics("Overview", 0) },
		...[
			["dashboards", "Dashboards"],
			["users", "Users & Sessions"],
			["events", "Events"],
			["dimensions", "Technology & Location"],
			["views", "Views"],
			["installations", "Installations"],
			["purchases", "Verified Purchases"],
			["insights", "Funnels & Retention"],
			["cohorts", "Cohorts"],
			["crashes", "Crashes"],
			["feedback", "Feedback"],
			["remote-config", "Remote Config"],
			["alerts", "Alerts"],
			["reports", "Reports & Exports"],
			["settings", "Settings"],
		].map(([path, label], index) => ({
			path_pattern: `/analytics/${path}`,
			title: label,
			navigation: analytics(label, index + 1),
		})),
	],
});
