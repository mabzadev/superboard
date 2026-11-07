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
			"superboard-files.menu.item_1": "Database",
			"superboard-files.menu.item_2": "Storage",
			"superboard-files.menu.item_3": "Functions",
			"superboard-files.menu.item_4": "Vectors",
			"superboard-files.menu.item_5": "API and keys",
		},
		fr: {
			"superboard-files.menu.item_0": "Fichiers et médias",
			"superboard-files.menu.item_1": "Base de données",
			"superboard-files.menu.item_2": "Stockage",
			"superboard-files.menu.item_3": "Fonctions",
			"superboard-files.menu.item_4": "Vecteurs",
			"superboard-files.menu.item_5": "API et clés",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/files",
			navigation: navigation("superboard-files.menu.item_0", 1),
			title: "File storage",
		},
		{
			path_pattern: "/data/database",
			navigation: navigation("superboard-files.menu.item_1", 2),
			title: "Application database",
		},
		{
			path_pattern: "/data/storage",
			navigation: navigation("superboard-files.menu.item_2", 3),
			title: "Application storage",
		},
		{
			path_pattern: "/data/functions",
			navigation: navigation("superboard-files.menu.item_3", 4),
			title: "Server functions",
		},
		{
			path_pattern: "/data/vectors",
			navigation: navigation("superboard-files.menu.item_4", 5),
			title: "Vector collections",
		},
		{
			path_pattern: "/data/api",
			navigation: navigation("superboard-files.menu.item_5", 6),
			title: "API and server keys",
		},
	],
});
