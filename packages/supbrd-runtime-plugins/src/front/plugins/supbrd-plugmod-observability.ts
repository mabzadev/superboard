import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const platform = navigationGroup({ group_id: "platform", group_label: "Platform", group_order: 8 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-observability",
	plugin_label: "Observability",
	description:
		"Inspect infrastructure health and operational signals from the Observability plugin.",
	surfaces: [
		{
			path_pattern: "/infrastructure",
			title: "Infrastructure",
			navigation: platform("Infrastructure", 0),
		},
	],
});
