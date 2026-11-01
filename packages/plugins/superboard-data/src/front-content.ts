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
	plugin_id: "superboard-content",
	plugin_label: "Content",
	description: "Content presentation is contributed when a Front Draft selects a Content surface.",
	translations: {
		en: {
			"superboard-content.menu.item_0": "Content",
		},
		fr: {
			"superboard-content.menu.item_0": "Contenus",
		},
	},
	surfaces: [
		{
			path_pattern: "/data/content",
			navigation: navigation("superboard-content.menu.item_0", 0),
			title: "Content repository",
		},
	],
});
