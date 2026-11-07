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
	plugin_id: "superboard-storage",
	plugin_label: "Application buckets",
	description: "Manage the buckets your applications read and write through the SDK.",
	translations: {
		en: {
			"superboard-storage.menu.item_0": "Application buckets",
		},
		fr: {
			"superboard-storage.menu.item_0": "Buckets d’application",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/storage",
			navigation: navigation("superboard-storage.menu.item_0", 2),
			title: "Application buckets",
		},
	],
});
