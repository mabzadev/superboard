import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "supbrd-plugmod-paywalls.navigation",
	group_label: "supbrd-plugmod-paywalls.menu.group",
	group_order: 70,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-paywalls",
	plugin_label: "Paywalls",
	description: "Compose paywalls and inspect their performance from the active Paywalls plugin.",
	translations: {
		en: {
			"supbrd-plugmod-paywalls.menu.group": "Paywalls",
			"supbrd-plugmod-paywalls.menu.item_0": "Paywalls",
			"supbrd-plugmod-paywalls.menu.item_1": "Statistics",
		},
		fr: {
			"supbrd-plugmod-paywalls.menu.group": "Paywalls",
			"supbrd-plugmod-paywalls.menu.item_0": "Paywalls",
			"supbrd-plugmod-paywalls.menu.item_1": "Statistiques",
		},
	},
	surfaces: [
		{
			path_pattern: "/paywalls",
			navigation: navigation("supbrd-plugmod-paywalls.menu.item_0", 0),
			title: "Paywalls",
		},
		{
			path_pattern: "/paywalls/statistics",
			navigation: navigation("supbrd-plugmod-paywalls.menu.item_1", 1),
			title: "Paywall statistics",
		},
	],
});
