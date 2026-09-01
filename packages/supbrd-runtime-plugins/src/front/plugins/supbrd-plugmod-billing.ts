import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const growth = navigationGroup({ group_id: "growth", group_label: "Growth", group_order: 4 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-billing",
	plugin_label: "Billing",
	description: "Review customers, entitlements, and purchases through the Billing plugin contract.",
	surfaces: [
		{
			path_pattern: "/products/customers",
			title: "Billing customers",
			navigation: growth("Billing customers", 20),
		},
		{
			path_pattern: "/products/entitlements",
			title: "Entitlements",
			navigation: growth("Entitlements", 21),
		},
		{
			path_pattern: "/products/purchases",
			title: "Purchases",
			navigation: growth("Purchases", 22),
		},
	],
});
