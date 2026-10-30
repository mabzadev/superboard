import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "superboard-paywalls.navigation",
	group_label: "superboard-paywalls.menu.group",
	group_order: 70,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-paywalls",
	plugin_label: "Paywalls",
	description: "Compose paywalls and inspect their performance from the active Paywalls plugin.",
	translations: {
		en: {
			"superboard-paywalls.menu.group": "Paywalls",
			"superboard-paywalls.menu.item_0": "Paywalls",
			"superboard-paywalls.menu.item_1": "Statistics",
		},
		fr: {
			"superboard-paywalls.menu.group": "Paywalls",
			"superboard-paywalls.menu.item_0": "Paywalls",
			"superboard-paywalls.menu.item_1": "Statistiques",
		},
	},
	surfaces: [
		{
			path_pattern: "/acquisition/paywalls",
			navigation: navigation("superboard-paywalls.menu.item_0", 0),
			title: "Paywalls",
		},
		{
			path_pattern: "/acquisition/paywalls/statistics",
			navigation: navigation("superboard-paywalls.menu.item_1", 1),
			title: "Paywall statistics",
		},
		{
			path_pattern: "/paywalls",
			title: "Paywalls",
		},
		{
			path_pattern: "/paywalls/statistics",
			title: "Paywall statistics",
		},
	],
});
