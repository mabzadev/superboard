import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const overview = navigationGroup({ group_id: "overview", group_label: "Overview", group_order: 0 });
const analytics = navigationGroup({
	group_id: "analytics",
	group_label: "Analytics",
	group_order: 3,
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
		{ path_pattern: "/dashboard", title: "Dashboard", navigation: overview("Dashboard", 0) },
		{ path_pattern: "/analytics", title: "Analytics", navigation: analytics("Overview", 0) },
		...[
			["alerts", "Alerts"],
			["cohorts", "Cohorts"],
			["crashes", "Crashes"],
			["dashboards", "Dashboards"],
			["dimensions", "Dimensions"],
			["events", "Events"],
			["feedback", "Feedback"],
			["insights", "Insights"],
			["installations", "Installations"],
			["purchases", "Purchases"],
			["remote-config", "Remote config"],
			["reports", "Reports"],
			["settings", "Settings"],
			["users", "Users"],
			["views", "Views"],
		].map(([path, label], index) => ({
			path_pattern: `/analytics/${path}`,
			title: label,
			navigation: analytics(label, index + 1),
		})),
	],
});
