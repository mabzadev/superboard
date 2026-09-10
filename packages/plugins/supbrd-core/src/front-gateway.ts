import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "supbrd-plugmod-gateway.navigation",
	group_label: "supbrd-plugmod-gateway.menu.group",
	group_order: 76,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-gateway",
	plugin_label: "Gateway",
	description: "Gateway presentation is contributed when a Front Draft selects a Gateway surface.",
	translations: {
		en: {
			"supbrd-plugmod-gateway.menu.group": "Gateway",
			"supbrd-plugmod-gateway.menu.item_0": "Routes and access",
		},
		fr: {
			"supbrd-plugmod-gateway.menu.group": "Passerelle",
			"supbrd-plugmod-gateway.menu.item_0": "Routes et accès",
		},
	},
	surfaces: [
		{
			path_pattern: "/system/gateway",
			navigation: navigation("supbrd-plugmod-gateway.menu.item_0", 0),
			title: "Gateway routes",
		},
	],
});
