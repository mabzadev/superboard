import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "superboard-gateway.navigation",
	group_label: "superboard-gateway.menu.group",
	group_order: 76,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-gateway",
	plugin_label: "Gateway",
	description: "Gateway presentation is contributed when a Front Draft selects a Gateway surface.",
	translations: {
		en: {
			"superboard-gateway.menu.group": "Gateway",
			"superboard-gateway.menu.item_0": "Routes and access",
		},
		fr: {
			"superboard-gateway.menu.group": "Passerelle",
			"superboard-gateway.menu.item_0": "Routes et accès",
		},
	},
	surfaces: [
		{
			path_pattern: "/system/gateway",
			navigation: navigation("superboard-gateway.menu.item_0", 0),
			title: "Gateway routes",
		},
	],
});
