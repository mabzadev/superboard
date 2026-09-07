import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const navigation = navigationGroup({
	group_id: "supbrd-plugmod-observability.navigation",
	group_label: "supbrd-plugmod-observability.menu.group",
	group_order: 77,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-observability",
	plugin_label: "Observability",
	description:
		"Inspect infrastructure health and operational signals from the Observability plugin.",
	translations: {
		en: {
			"supbrd-plugmod-observability.menu.group": "Observability",
			"supbrd-plugmod-observability.menu.item_0": "Infrastructure",
		},
		fr: {
			"supbrd-plugmod-observability.menu.group": "Observabilité",
			"supbrd-plugmod-observability.menu.item_0": "Infrastructure",
		},
	},
	surfaces: [
		{
			path_pattern: "/infrastructure",
			navigation: navigation("supbrd-plugmod-observability.menu.item_0", 0),
			title: "Infrastructure",
		},
	],
});
