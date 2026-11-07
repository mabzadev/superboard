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
	plugin_id: "superboard-functions",
	plugin_label: "Functions",
	description: "Deploy, schedule and test server functions.",
	translations: {
		en: {
			"superboard-functions.menu.item_0": "Functions",
		},
		fr: {
			"superboard-functions.menu.item_0": "Fonctions",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/functions",
			navigation: navigation("superboard-functions.menu.item_0", 4),
			title: "Server functions",
		},
	],
});
