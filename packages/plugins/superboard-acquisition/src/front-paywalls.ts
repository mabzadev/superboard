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
	plugin_id: "superboard-paywalls",
	plugin_label: "Paywalls",
	description: "Compose paywalls and inspect their performance from the active Paywalls plugin.",
	translations: {
		en: {
			"superboard-paywalls.menu.item_0": "Paywalls",
		},
		fr: {
			"superboard-paywalls.menu.item_0": "Écrans d’abonnement",
		},
	},
	surfaces: [
		{
			path_pattern: "/acquisition/paywalls",
			navigation: acquisition("superboard-paywalls.menu.item_0", 0),
			title: "Paywalls",
		},
		{
			path_pattern: "/acquisition/paywalls/statistics",
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
