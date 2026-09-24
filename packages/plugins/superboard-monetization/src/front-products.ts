import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const products = navigationGroup({ group_id: "products", group_label: "Products", group_order: 3 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plug-products",
	plugin_label: "Products",
	description: "Manage the product catalogue and offerings owned by the Products plugin Store.",
	surfaces: [
		{
			path_pattern: "/monetization/products",
			title: "Products",
			navigation: products("Products", 2),
		},
		{
			path_pattern: "/monetization/products/products",
			title: "Products",
		},
		{
			path_pattern: "/monetization/offerings",
			title: "Offerings",
			navigation: products("Offerings", 3),
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
		},
	],
});
