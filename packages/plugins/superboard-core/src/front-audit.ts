import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "environment",
	group_label: "navigation.section.environment",
	group_order: 8,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-audit",
	plugin_label: "Audit",
	description: "Audit presentation is contributed when a Front Draft selects an Audit surface.",
	translations: {
		en: {
			"superboard-audit.menu.item_0": "Audit log",
		},
		fr: {
			"superboard-audit.menu.item_0": "Journal d’audit",
		},
	},
	surfaces: [
		{
			path_pattern: "/system/audit",
			navigation: navigation("superboard-audit.menu.item_0", 4),
			title: "Audit ledger",
		},
	],
});
