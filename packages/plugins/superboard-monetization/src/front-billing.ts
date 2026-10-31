import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

// Fallback navigation (used only when the EmDash menu is missing) mirrors the seeded section.
const monetization = navigationGroup({
	group_id: "products",
	group_label: "navigation.section.monetization",
	group_order: 3,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-billing",
	plugin_label: "Billing",
	description: "Review customers and entitlements through the Billing plugin contract.",
	translations: {
		en: { "superboard-billing.menu.customers": "Customers" },
		fr: { "superboard-billing.menu.customers": "Clients" },
	},
	surfaces: [
		{
			path_pattern: "/monetization/purchases",
			title: "Purchases",
		},
		{
			path_pattern: "/products/purchases",
			title: "Purchases",
		},
		{
			path_pattern: "/monetization/customers",
			title: "Customers",
			navigation: monetization("superboard-billing.menu.customers", 0),
		},
		{
			path_pattern: "/monetization/entitlements",
			title: "Entitlements",
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
