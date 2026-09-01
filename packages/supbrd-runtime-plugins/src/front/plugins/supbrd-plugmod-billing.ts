import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const products = navigationGroup({ group_id: "products", group_label: "Products", group_order: 3 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-billing",
	plugin_label: "Billing",
	description: "Review customers, entitlements, and purchases through the Billing plugin contract.",
	surfaces: [
		{
			path_pattern: "/products/purchases",
			title: "Purchases",
			navigation: products("Purchases", 0),
		},
		{
			path_pattern: "/products/customers",
			title: "Customers",
			navigation: products("Customers", 1),
		},
		{
			path_pattern: "/products/entitlements",
			title: "Entitlements",
			navigation: products("Entitlements", 3),
		},
	],
});
