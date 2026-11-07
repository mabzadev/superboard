import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "data",
	group_label: "Data",
	group_order: 2,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-files",
	plugin_label: "Files",
	description: "File presentation is contributed when a Front Draft selects a Files surface.",
	translations: {
		en: {
			"superboard-files.menu.item_0": "Files and media",
		},
		fr: {
			"superboard-files.menu.item_0": "Fichiers et médias",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/files",
			navigation: navigation("superboard-files.menu.item_0", 3),
			title: "File storage",
		},
	],
});
