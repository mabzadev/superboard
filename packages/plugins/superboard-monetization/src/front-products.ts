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
	plugin_id: "superboard-products",
	plugin_label: "Products",
	description: "Manage the product catalogue and offerings owned by the Products plugin Store.",
	translations: {
		en: {
			"superboard-products.menu.catalog": "Catalog",
			"superboard-products.menu.settings": "Settings",
		},
		fr: {
			"superboard-products.menu.catalog": "Catalogue",
			"superboard-products.menu.settings": "Paramètres",
		},
	},
	surfaces: [
		{
			path_pattern: "/monetization/products",
			title: "Products",
			navigation: monetization("superboard-products.menu.catalog", 1),
		},
		{
			path_pattern: "/monetization/products/products",
			title: "Products",
		},
		{
			path_pattern: "/monetization/offerings",
			title: "Offerings",
		},
		{
			path_pattern: "/products",
			title: "Products",
		},
		{
			path_pattern: "/products/products",
			title: "Products",
		},
		{
			path_pattern: "/products/offerings",
			title: "Offerings",
		},
		{
			path_pattern: "/monetization/settings",
			title: "Monetization settings",
			navigation: monetization("superboard-products.menu.settings", 2),
		},
	],
});
