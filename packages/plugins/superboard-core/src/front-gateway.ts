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
	plugin_id: "superboard-gateway",
	plugin_label: "Gateway",
	description: "Gateway presentation is contributed when a Front Draft selects a Gateway surface.",
	translations: {
		en: {
			"superboard-gateway.menu.item_0": "API routing",
		},
		fr: {
			"superboard-gateway.menu.item_0": "Routage de l’API",
		},
	},
	surfaces: [
		{
			path_pattern: "/system/gateway",
			navigation: navigation("superboard-gateway.menu.item_0", 5),
			title: "Gateway routes",
		},
	],
});
