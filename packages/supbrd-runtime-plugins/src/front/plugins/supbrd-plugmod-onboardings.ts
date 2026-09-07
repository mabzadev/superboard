import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const navigation = navigationGroup({
	group_id: "supbrd-plugmod-onboardings.navigation",
	group_label: "supbrd-plugmod-onboardings.menu.group",
	group_order: 71,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-onboardings",
	plugin_label: "Onboardings",
	description: "Build onboarding experiences and inspect their performance from the active plugin.",
	translations: {
		en: {
			"supbrd-plugmod-onboardings.menu.group": "Onboardings",
			"supbrd-plugmod-onboardings.menu.item_0": "Onboardings",
			"supbrd-plugmod-onboardings.menu.item_1": "Statistics",
		},
		fr: {
			"supbrd-plugmod-onboardings.menu.group": "Onboardings",
			"supbrd-plugmod-onboardings.menu.item_0": "Onboardings",
			"supbrd-plugmod-onboardings.menu.item_1": "Statistiques",
		},
	},
	surfaces: [
		{
			path_pattern: "/onboardings",
			navigation: navigation("supbrd-plugmod-onboardings.menu.item_0", 0),
			title: "Onboardings",
		},
		{
			path_pattern: "/onboardings/statistics",
			navigation: navigation("supbrd-plugmod-onboardings.menu.item_1", 1),
			title: "Onboarding statistics",
		},
	],
});
