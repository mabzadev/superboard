export const pluginId = "superboard-content";
export const views = {
	"superboard.system_content": () => import("./views/superboard.system_content.js"),
	"superboard.data_content": () => import("./views/superboard.system_content.js"),
};
