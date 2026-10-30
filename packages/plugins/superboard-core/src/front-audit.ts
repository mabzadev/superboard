import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "superboard-audit.navigation",
	group_label: "superboard-audit.menu.group",
	group_order: 72,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-audit",
	plugin_label: "Audit",
	description: "Audit presentation is contributed when a Front Draft selects an Audit surface.",
	translations: {
		en: {
			"superboard-audit.menu.group": "Audit",
			"superboard-audit.menu.item_0": "Ledger",
		},
		fr: {
			"superboard-audit.menu.group": "Audit",
			"superboard-audit.menu.item_0": "Journal",
		},
	},
	surfaces: [
		{
			path_pattern: "/system/audit",
			navigation: navigation("superboard-audit.menu.item_0", 0),
			title: "Audit ledger",
		},
	],
});
