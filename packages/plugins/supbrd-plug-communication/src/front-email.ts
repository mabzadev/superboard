import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "supbrd-plugmod-email.navigation",
	group_label: "supbrd-plugmod-email.menu.group",
	group_order: 74,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-email",
	plugin_label: "Email",
	description: "Email presentation is contributed when a Front Draft selects an Email surface.",
	translations: {
		en: {
			"supbrd-plugmod-email.menu.group": "Email",
			"supbrd-plugmod-email.menu.item_0": "Delivery settings",
		},
		fr: {
			"supbrd-plugmod-email.menu.group": "E-mail",
			"supbrd-plugmod-email.menu.item_0": "Paramètres de livraison",
		},
	},
	surfaces: [
		{
			path_pattern: "/system/email",
			navigation: navigation("supbrd-plugmod-email.menu.item_0", 0),
			title: "Email delivery",
		},
	],
});
