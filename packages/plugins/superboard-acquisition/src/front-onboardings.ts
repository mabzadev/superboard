import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "superboard-onboardings.navigation",
	group_label: "superboard-onboardings.menu.group",
	group_order: 71,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-onboardings",
	plugin_label: "Onboardings",
	description: "Build onboarding experiences and inspect their performance from the active plugin.",
	translations: {
		en: {
			"superboard-onboardings.menu.group": "Onboardings",
			"superboard-onboardings.menu.item_0": "Onboardings",
			"superboard-onboardings.menu.item_1": "Statistics",
		},
		fr: {
			"superboard-onboardings.menu.group": "Onboardings",
			"superboard-onboardings.menu.item_0": "Onboardings",
			"superboard-onboardings.menu.item_1": "Statistiques",
		},
	},
	surfaces: [
		{
			path_pattern: "/onboardings",
			navigation: navigation("superboard-onboardings.menu.item_0", 0),
			title: "Onboardings",
		},
		{
			path_pattern: "/onboardings/statistics",
			navigation: navigation("superboard-onboardings.menu.item_1", 1),
			title: "Onboarding statistics",
		},
	],
});
