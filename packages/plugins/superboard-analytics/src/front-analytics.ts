import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

// Fallback navigation (used only when the EmDash menu is missing) mirrors the seeded sections.
const overview = navigationGroup({
	group_id: "overview",
	group_label: "navigation.section.overview",
	group_order: 0,
});
const analytics = navigationGroup({
	group_id: "analytics",
	group_label: "Analytics",
	group_order: 7,
});
const menu = {
	overview: ["Statistics overview", "Vue d’ensemble des statistiques"],
	users: ["Audience and usage", "Audience et utilisation"],
	events: ["Events", "Événements"],
	insights: ["Conversion and retention", "Conversions et fidélisation"],
	purchases: ["Verified revenue", "Revenus vérifiés"],
	reports: ["Reports and exports", "Rapports et exports"],
	"remote-config": ["Remote configuration", "Configuration distante"],
	settings: ["Settings", "Paramètres"],
} as const;
const menuKey = (name: string) => `superboard-analytics.menu.${name}`;
const isMenuName = (name: string): name is keyof typeof menu => name in menu;
const menuItem = (name: keyof typeof menu) =>
	analytics(menuKey(name), Object.keys(menu).indexOf(name));

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-analytics",
	plugin_label: "Analytics",
	description:
		"Explore the analytics data sources and operational insights selected by this Front Release.",
	translations: {
		en: {
			"superboard-analytics.menu.home": "Overview",
			...Object.fromEntries(Object.entries(menu).map(([name, [en]]) => [menuKey(name), en])),
		},
		fr: {
			"superboard-analytics.menu.home": "Vue d’ensemble",
			...Object.fromEntries(Object.entries(menu).map(([name, [, fr]]) => [menuKey(name), fr])),
		},
	},
	surfaces: [
		{
			path_pattern: "/",
			title: "SuperBoard",
			navigation: overview("superboard-analytics.menu.home", 0),
		},
		{
			path_pattern: "/app",
			title: "SuperBoard",
			route_id: "superboard.app_shell",
			page_id: "page.superboard_app",
			transition: "authenticated_home",
		},
		{ path_pattern: "/dashboard", title: "Dashboard" },
		{ path_pattern: "/analytics", title: "Analytics", navigation: menuItem("overview") },
		...(
			[
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
			] as const
		).map(([path, title]) => ({
			path_pattern: `/analytics/${path}`,
			title,
			...(isMenuName(path) ? { navigation: menuItem(path) } : {}),
		})),
	],
});
