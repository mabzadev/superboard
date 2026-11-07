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
	plugin_id: "superboard-vectors",
	plugin_label: "Vectors",
	description: "Manage vector collections for semantic search.",
	translations: {
		en: {
			"superboard-vectors.menu.item_0": "Vectors",
		},
		fr: {
			"superboard-vectors.menu.item_0": "Vecteurs",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/vectors",
			navigation: navigation("superboard-vectors.menu.item_0", 5),
			title: "Vector collections",
		},
	],
});
