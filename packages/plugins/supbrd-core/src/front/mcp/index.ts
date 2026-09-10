export const pluginId = "supbrd-plugmod-mcp";
export const views = {
	"superboard.mcp": () => import("./views/superboard.mcp.js"),
	"superboard.mcp_authorize": () => import("./views/superboard.mcp_authorize.js"),
};
