import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "superboard-files.navigation",
	group_label: "superboard-files.menu.group",
	group_order: 75,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-files",
	plugin_label: "Files",
	description: "File presentation is contributed when a Front Draft selects a Files surface.",
	translations: {
		en: {
			"superboard-files.menu.group": "Files",
			"superboard-files.menu.item_0": "Files",
		},
		fr: {
			"superboard-files.menu.group": "Fichiers",
			"superboard-files.menu.item_0": "Fichiers",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/files",
			navigation: navigation("superboard-files.menu.item_0", 0),
			title: "File storage",
		},
		{
			path_pattern: "/data/settings",
			title: "Data settings",
		},
	],
});
