import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const products = navigationGroup({ group_id: "products", group_label: "Products", group_order: 3 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-billing",
	plugin_label: "Billing",
	description: "Review customers and entitlements through the Billing plugin contract.",
	surfaces: [
		{
			path_pattern: "/monetization/purchases",
			title: "Purchases",
			navigation: products("Purchases", 0),
		},
		{
			path_pattern: "/products/purchases",
			title: "Purchases",
		},
		{
			path_pattern: "/monetization/customers",
			title: "Customers",
			navigation: products("Customers", 1),
		},
		{
			path_pattern: "/monetization/entitlements",
			title: "Entitlements",
			navigation: products("Entitlements", 3),
		},
		{
			path_pattern: "/products/customers",
			title: "Customers",
		},
		{
			path_pattern: "/products/entitlements",
			title: "Entitlements",
		},
	],
});
