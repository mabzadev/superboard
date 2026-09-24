export const pluginId = "supbrd-plug-content";
export const views = {
	"superboard.system_content": () => import("./views/superboard.system_content.js"),
	"superboard.data_content": () => import("./views/superboard.system_content.js"),
};
