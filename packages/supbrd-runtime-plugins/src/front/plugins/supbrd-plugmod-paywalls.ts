import { defineNativeFrontPlugin } from "../runtime-factory.js";

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-paywalls",
	plugin_label: "Paywalls",
	description: "Compose paywalls and inspect their performance from the active Paywalls plugin.",
	surfaces: [
		{ path_pattern: "/paywalls", title: "Paywalls" },
		{
			path_pattern: "/paywalls/statistics",
			title: "Paywall statistics",
		},
	],
});
