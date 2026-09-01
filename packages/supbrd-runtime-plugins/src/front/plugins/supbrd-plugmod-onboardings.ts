import { defineNativeFrontPlugin } from "../runtime-factory.js";

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-onboardings",
	plugin_label: "Onboardings",
	description: "Build onboarding experiences and inspect their performance from the active plugin.",
	surfaces: [
		{ path_pattern: "/onboardings", title: "Onboardings" },
		{
			path_pattern: "/onboardings/statistics",
			title: "Onboarding statistics",
		},
	],
});
