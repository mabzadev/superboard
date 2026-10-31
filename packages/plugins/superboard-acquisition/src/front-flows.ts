import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

// Fallback navigation (used only when the EmDash menu is missing) mirrors the seeded section.
const acquisition = navigationGroup({
	group_id: "acquisition",
	group_label: "Acquisition",
	group_order: 5,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-flows",
	plugin_label: "Flows",
	description:
		"Design workflows, components, launch configurations, and runtime settings from the Flows plugin.",
	translations: {
		en: { "superboard-flows.menu.settings": "Settings" },
		fr: { "superboard-flows.menu.settings": "Paramètres" },
	},
	surfaces: [
		{ path_pattern: "/flows", title: "Flows" },
		{ path_pattern: "/acquisition/workflows", title: "Workflows" },
		{ path_pattern: "/acquisition/workflows/:id", title: "Workflow" },
		{ path_pattern: "/acquisition/launchpad", title: "Launchpad" },
		{ path_pattern: "/acquisition/users", title: "Flow users" },
		{ path_pattern: "/acquisition/users/:id", title: "Flow user" },
		{ path_pattern: "/acquisition/components", title: "Components" },
		{
			path_pattern: "/acquisition/settings",
			title: "Acquisition settings",
			navigation: acquisition("superboard-flows.menu.settings", 3),
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
