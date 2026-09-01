import { defineNativeFrontPlugin } from "../runtime-factory.js";

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-mcp",
	plugin_label: "MCP",
	description: "Review and authorize MCP access through the active MCP plugin contract.",
	surfaces: [{ path_pattern: "/mcp/authorize", title: "MCP authorization" }],
});
