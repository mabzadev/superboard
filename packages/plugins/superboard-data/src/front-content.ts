import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "superboard-content.navigation",
	group_label: "superboard-content.menu.group",
	group_order: 73,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-content",
	plugin_label: "Content",
	description: "Content presentation is contributed when a Front Draft selects a Content surface.",
	translations: {
		en: {
			"superboard-content.menu.group": "Content",
			"superboard-content.menu.item_0": "Documents",
		},
		fr: {
			"superboard-content.menu.group": "Contenu",
			"superboard-content.menu.item_0": "Documents",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/content",
			navigation: navigation("superboard-content.menu.item_0", 0),
			title: "Content repository",
		},
	],
});
