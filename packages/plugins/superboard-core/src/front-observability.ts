import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

// Fallback navigation (used only when the EmDash menu is missing) mirrors the seeded section.
const navigation = navigationGroup({
	group_id: "environment",
	group_label: "navigation.section.environment",
	group_order: 8,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-observability",
	plugin_label: "Observability",
	description:
		"Inspect infrastructure health and operational signals from the Observability plugin.",
	translations: {
		en: {
			"superboard-observability.menu.item_0": "Service health",
		},
		fr: {
			"superboard-observability.menu.item_0": "État des services",
		},
	},
	surfaces: [
		{
			path_pattern: "/infrastructure",
			navigation: navigation("superboard-observability.menu.item_0", 3),
			title: "Infrastructure",
		},
	],
});
