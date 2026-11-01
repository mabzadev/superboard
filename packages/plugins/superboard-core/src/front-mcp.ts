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
	plugin_id: "superboard-mcp",
	plugin_label: "MCP",
	description: "Review and authorize MCP access through the active MCP plugin contract.",
	translations: {
		en: {
			"superboard-mcp.menu.tools": "AI assistant access",
		},
		fr: {
			"superboard-mcp.menu.tools": "Accès des assistants IA",
		},
	},
	surfaces: [
		{
			path_pattern: "/mcp",
			title: "MCP tools",
			navigation: navigation("superboard-mcp.menu.tools", 6),
		},
		{ path_pattern: "/mcp/authorize", title: "MCP authorization" },
	],
});
