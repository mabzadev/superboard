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
	plugin_id: "superboard-database",
	plugin_label: "Database",
	description: "Manage application tables, rows, SQL queries, realtime and the server keys of the Data API.",
	translations: {
		en: {
			"superboard-database.menu.item_0": "Database",
			"superboard-database.menu.item_1": "Data settings",
		},
		fr: {
			"superboard-database.menu.item_0": "Base de données",
			"superboard-database.menu.item_1": "Paramètres Data",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/database",
			navigation: navigation("superboard-database.menu.item_0", 1),
			title: "Application database",
		},
		{
			path_pattern: "/data/api",
			navigation: navigation("superboard-database.menu.item_1", 6),
			title: "Data settings",
		},
	],
});
