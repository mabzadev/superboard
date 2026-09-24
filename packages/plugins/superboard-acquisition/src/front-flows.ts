import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const flows = navigationGroup({ group_id: "flows", group_label: "Flows", group_order: 4 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-flows",
	plugin_label: "Flows",
	description:
		"Design workflows, components, launch configurations, and runtime settings from the Flows plugin.",
	surfaces: [
		{ path_pattern: "/flows", title: "Flows", navigation: flows("Overview", 0) },
		{
			path_pattern: "/acquisition/workflows",
			title: "Workflows",
			navigation: flows("Workflows", 1),
		},
		{ path_pattern: "/acquisition/workflows/:id", title: "Workflow" },
		{
			path_pattern: "/acquisition/launchpad",
			title: "Launchpad",
			navigation: flows("Launchpad", 2),
		},
		{ path_pattern: "/acquisition/users", title: "Flow users" },
		{ path_pattern: "/acquisition/users/:id", title: "Flow user" },
		{
			path_pattern: "/acquisition/components",
			title: "Components",
			navigation: flows("Components", 4),
		},
		{
			path_pattern: "/acquisition/settings",
			title: "Acquisition settings",
			navigation: flows("Settings", 5),
		},
		{
			path_pattern: "/acquisition/settings/environments",
			title: "Flow environments",
		},
		{
			path_pattern: "/acquisition/settings/localization",
			title: "Flow localization",
		},
		{ path_pattern: "/acquisition/settings/sdk", title: "Flow SDK" },
		{ path_pattern: "/flows/workflows", title: "Workflows" },
		{ path_pattern: "/flows/workflows/:id", title: "Workflow" },
		{ path_pattern: "/flows/launchpad", title: "Launchpad" },
		{ path_pattern: "/flows/users", title: "Flow users" },
		{ path_pattern: "/flows/users/:id", title: "Flow user" },
		{ path_pattern: "/flows/components", title: "Components" },
		{ path_pattern: "/flows/settings/environments", title: "Flow environments" },
		{ path_pattern: "/flows/settings/localization", title: "Flow localization" },
		{ path_pattern: "/flows/settings/sdk", title: "Flow SDK" },
	],
});
