import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const growth = navigationGroup({ group_id: "growth", group_label: "Growth", group_order: 4 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-paywalls",
	plugin_label: "Paywalls",
	description: "Compose paywalls and inspect their performance from the active Paywalls plugin.",
	surfaces: [
		{ path_pattern: "/paywalls", title: "Paywalls", navigation: growth("Paywalls", 23) },
		{
			path_pattern: "/paywalls/statistics",
			title: "Paywall statistics",
			navigation: growth("Paywall statistics", 24),
		},
	],
});
