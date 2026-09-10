import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "supbrd-plugmod-files.navigation",
	group_label: "supbrd-plugmod-files.menu.group",
	group_order: 75,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-files",
	plugin_label: "Files",
	description: "File presentation is contributed when a Front Draft selects a Files surface.",
	translations: {
		en: {
			"supbrd-plugmod-files.menu.group": "Files",
			"supbrd-plugmod-files.menu.item_0": "Files",
		},
		fr: {
			"supbrd-plugmod-files.menu.group": "Fichiers",
			"supbrd-plugmod-files.menu.item_0": "Fichiers",
		},
	},
	surfaces: [
		{
			path_pattern: "/system/files",
			navigation: navigation("supbrd-plugmod-files.menu.item_0", 0),
			title: "File storage",
		},
	],
});
