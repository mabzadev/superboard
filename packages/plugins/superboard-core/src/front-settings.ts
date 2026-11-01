import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

// Fallback navigation (used only when the EmDash menu is missing) mirrors the seeded section.
const navigation = navigationGroup({
	group_id: "environment",
	group_label: "navigation.section.environment",
	group_order: 8,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-settings",
	plugin_label: "Settings",
	description:
		"Configure the Instance and its application SDK integrations from the verified plugin surface.",
	translations: {
		en: {
			"superboard-settings.menu.general": "General",
			"superboard-settings.menu.sdk": "SDK & apps",
		},
		fr: {
			"superboard-settings.menu.general": "Général",
			"superboard-settings.menu.sdk": "SDK et applications",
		},
	},
	surfaces: [
		{
			path_pattern: "/app/libraries",
			title: "SDK & apps",
			navigation: navigation("superboard-settings.menu.sdk", 2),
		},
		{ path_pattern: "/app/android-setup", title: "Android Setup" },
		{ path_pattern: "/app/ios-setup", title: "iOS Setup" },
		{ path_pattern: "/app/web-setup", title: "Web Setup" },
		{
			path_pattern: "/project-settings",
			title: "Environment settings",
			navigation: navigation("superboard-settings.menu.general", 0),
		},
	],
});
