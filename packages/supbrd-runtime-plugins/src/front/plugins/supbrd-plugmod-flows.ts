import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const flows = navigationGroup({ group_id: "flows", group_label: "Flows", group_order: 5 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-flows",
	plugin_label: "Flows",
	description:
		"Design workflows, components, launch configurations, and runtime settings from the Flows plugin.",
	surfaces: [
		{ path_pattern: "/flows", title: "Flows", navigation: flows("Overview", 0) },
		{ path_pattern: "/flows/workflows", title: "Workflows", navigation: flows("Workflows", 1) },
		{ path_pattern: "/flows/workflows/:id", title: "Workflow" },
		{ path_pattern: "/flows/launchpad", title: "Launchpad", navigation: flows("Launchpad", 2) },
		{ path_pattern: "/flows/components", title: "Components", navigation: flows("Components", 3) },
		{ path_pattern: "/flows/users", title: "Flow users", navigation: flows("Users", 4) },
		{ path_pattern: "/flows/users/:id", title: "Flow user" },
		{
			path_pattern: "/flows/settings/environments",
			title: "Flow environments",
			navigation: flows("Environments", 5),
		},
		{
			path_pattern: "/flows/settings/localization",
			title: "Flow localization",
			navigation: flows("Localization", 6),
		},
		{ path_pattern: "/flows/settings/sdk", title: "Flow SDK", navigation: flows("SDK", 7) },
	],
});
