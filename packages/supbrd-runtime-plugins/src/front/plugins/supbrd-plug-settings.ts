import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const application = navigationGroup({
	group_id: "application",
	group_label: "Application",
	group_order: 1,
});
const platform = navigationGroup({ group_id: "platform", group_label: "Platform", group_order: 8 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plug-settings",
	plugin_label: "Settings",
	description:
		"Configure the Instance and its application SDK integrations from the verified plugin surface.",
	surfaces: [
		{ path_pattern: "/app/ios-setup", title: "iOS setup", navigation: application("iOS setup", 4) },
		{
			path_pattern: "/app/android-setup",
			title: "Android setup",
			navigation: application("Android setup", 5),
		},
		{ path_pattern: "/app/web-setup", title: "Web setup", navigation: application("Web setup", 6) },
		{ path_pattern: "/app/libraries", title: "Libraries", navigation: application("Libraries", 7) },
		{
			path_pattern: "/project-settings",
			title: "Project settings",
			navigation: platform("Project settings", 1),
		},
	],
});
