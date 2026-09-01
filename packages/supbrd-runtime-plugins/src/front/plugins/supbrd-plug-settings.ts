import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const app = navigationGroup({
	group_id: "app",
	group_label: "App",
	group_order: 1,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plug-settings",
	plugin_label: "Settings",
	description:
		"Configure the Instance and its application SDK integrations from the verified plugin surface.",
	surfaces: [
		{ path_pattern: "/app/libraries", title: "Libraries", navigation: app("Libraries", 4) },
		{
			path_pattern: "/app/android-setup",
			title: "Android Setup",
			navigation: app("Android Setup", 5),
		},
		{ path_pattern: "/app/ios-setup", title: "iOS Setup", navigation: app("iOS Setup", 6) },
		{ path_pattern: "/app/web-setup", title: "Web Setup", navigation: app("Web Setup", 7) },
		{ path_pattern: "/project-settings", title: "Project settings" },
	],
});
