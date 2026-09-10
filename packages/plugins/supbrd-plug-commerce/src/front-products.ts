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
			path_pattern: "/products/offerings",
			title: "Offerings",
			navigation: products("Offerings", 2),
		},
	],
});
