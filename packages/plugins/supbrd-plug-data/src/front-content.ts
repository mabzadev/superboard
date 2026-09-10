import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "supbrd-plug-content.navigation",
	group_label: "supbrd-plug-content.menu.group",
	group_order: 73,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plug-content",
	plugin_label: "Content",
	description: "Content presentation is contributed when a Front Draft selects a Content surface.",
	translations: {
		en: {
			"supbrd-plug-content.menu.group": "Content",
			"supbrd-plug-content.menu.item_0": "Documents",
		},
		fr: {
			"supbrd-plug-content.menu.group": "Contenu",
			"supbrd-plug-content.menu.item_0": "Documents",
		},
	},
	surfaces: [
		{
			path_pattern: "/system/content",
			navigation: navigation("supbrd-plug-content.menu.item_0", 0),
			title: "Content repository",
		},
	],
});
