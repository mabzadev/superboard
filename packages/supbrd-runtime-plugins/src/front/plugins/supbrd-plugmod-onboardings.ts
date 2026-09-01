import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const growth = navigationGroup({ group_id: "growth", group_label: "Growth", group_order: 4 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-onboardings",
	plugin_label: "Onboardings",
	description: "Build onboarding experiences and inspect their performance from the active plugin.",
	surfaces: [
		{ path_pattern: "/onboardings", title: "Onboardings", navigation: growth("Onboardings", 25) },
		{
			path_pattern: "/onboardings/statistics",
			title: "Onboarding statistics",
			navigation: growth("Onboarding statistics", 26),
		},
	],
});
