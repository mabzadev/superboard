import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const growth = navigationGroup({ group_id: "growth", group_label: "Growth", group_order: 4 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plug-products",
	plugin_label: "Products",
	description: "Manage the product catalogue and offerings owned by the Products plugin Store.",
	surfaces: [
		{
			path_pattern: "/products/offerings",
			title: "Offerings",
			navigation: growth("Offerings", 19),
		},
	],
});
