import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const navigation = navigationGroup({
	group_id: "supbrd-plugmod-mcp.navigation",
	group_label: "supbrd-plugmod-mcp.menu.group",
	group_order: 78,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-mcp",
	plugin_label: "MCP",
	description: "Review and authorize MCP access through the active MCP plugin contract.",
	translations: {
		en: {
			"supbrd-plugmod-mcp.menu.group": "MCP",
			"supbrd-plugmod-mcp.menu.tools": "Tools and access",
		},
		fr: {
			"supbrd-plugmod-mcp.menu.group": "MCP",
			"supbrd-plugmod-mcp.menu.tools": "Outils et accès",
		},
	},
	surfaces: [
		{
			path_pattern: "/mcp",
			title: "MCP tools",
			navigation: navigation("supbrd-plugmod-mcp.menu.tools", 0),
		},
		{ path_pattern: "/mcp/authorize", title: "MCP authorization" },
	],
});
