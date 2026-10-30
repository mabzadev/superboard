import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "superboard-observability.navigation",
	group_label: "superboard-observability.menu.group",
	group_order: 77,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-observability",
	plugin_label: "Observability",
	description:
		"Inspect infrastructure health and operational signals from the Observability plugin.",
	translations: {
		en: {
			"superboard-observability.menu.group": "Observability",
			"superboard-observability.menu.item_0": "Infrastructure",
		},
		fr: {
			"superboard-observability.menu.group": "Observabilité",
			"superboard-observability.menu.item_0": "Infrastructure",
		},
	},
	surfaces: [
		{
			path_pattern: "/infrastructure",
			navigation: navigation("superboard-observability.menu.item_0", 0),
			title: "Infrastructure",
		},
	],
});
