import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "supbrd-plug-audit.navigation",
	group_label: "supbrd-plug-audit.menu.group",
	group_order: 72,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plug-audit",
	plugin_label: "Audit",
	description: "Audit presentation is contributed when a Front Draft selects an Audit surface.",
	translations: {
		en: {
			"supbrd-plug-audit.menu.group": "Audit",
			"supbrd-plug-audit.menu.item_0": "Ledger",
		},
		fr: {
			"supbrd-plug-audit.menu.group": "Audit",
			"supbrd-plug-audit.menu.item_0": "Journal",
		},
	},
	surfaces: [
		{
			path_pattern: "/system/audit",
			navigation: navigation("supbrd-plug-audit.menu.item_0", 0),
			title: "Audit ledger",
		},
	],
});
