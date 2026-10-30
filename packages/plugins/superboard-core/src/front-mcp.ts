import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "superboard-mcp.navigation",
	group_label: "superboard-mcp.menu.group",
	group_order: 78,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-mcp",
	plugin_label: "MCP",
	description: "Review and authorize MCP access through the active MCP plugin contract.",
	translations: {
		en: {
			"superboard-mcp.menu.group": "MCP",
			"superboard-mcp.menu.tools": "Tools and access",
		},
		fr: {
			"superboard-mcp.menu.group": "MCP",
			"superboard-mcp.menu.tools": "Outils et accès",
		},
	},
	surfaces: [
		{
			path_pattern: "/mcp",
			title: "MCP tools",
			navigation: navigation("superboard-mcp.menu.tools", 0),
		},
		{ path_pattern: "/mcp/authorize", title: "MCP authorization" },
	],
});
