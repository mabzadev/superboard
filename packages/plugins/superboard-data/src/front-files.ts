import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

// Fallback navigation (used only when the EmDash menu is missing) mirrors the seeded section.
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
			"superboard-files.menu.settings": "Configuration",
		},
		fr: {
			"superboard-files.menu.item_0": "Fichiers et médias",
			"superboard-files.menu.settings": "Configuration",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/files",
			navigation: navigation("superboard-files.menu.item_0", 1),
			title: "File storage",
		},
		{
			path_pattern: "/data/settings",
			title: "Data settings",
			navigation: navigation("superboard-files.menu.settings", 2),
		},
	],
});
