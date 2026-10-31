import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "superboard-email.navigation",
	group_label: "superboard-email.menu.group",
	group_order: 74,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-email",
	plugin_label: "Email",
	description: "Email presentation is contributed when a Front Draft selects an Email surface.",
	translations: {
		en: {
			"superboard-email.menu.group": "Email",
			"superboard-email.menu.item_0": "Transactional email",
		},
		fr: {
			"superboard-email.menu.group": "E-mail",
			"superboard-email.menu.item_0": "E-mails transactionnels",
		},
	},
	surfaces: [
		{
			path_pattern: "/communication/email",
			navigation: navigation("superboard-email.menu.item_0", 0),
			title: "Transactional email",
		},
		{
			path_pattern: "/system/email",
			title: "Transactional email",
		},
	],
});
