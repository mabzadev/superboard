import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

// Fallback navigation (used only when the EmDash menu is missing) mirrors the seeded section.
const acquisition = navigationGroup({
	group_id: "acquisition",
	group_label: "Acquisition",
	group_order: 5,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-onboardings",
	plugin_label: "Onboardings",
	description: "Build onboarding experiences and inspect their performance from the active plugin.",
	translations: {
		en: {
			"superboard-onboardings.menu.item_0": "Onboardings",
		},
		fr: {
			"superboard-onboardings.menu.item_0": "Parcours d’accueil",
		},
	},
	surfaces: [
		{
			path_pattern: "/onboardings",
			navigation: acquisition("superboard-onboardings.menu.item_0", 1),
			title: "Onboardings",
		},
		{
			path_pattern: "/onboardings/statistics",
			title: "Onboarding statistics",
		},
	],
});
