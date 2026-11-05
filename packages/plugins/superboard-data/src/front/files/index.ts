export const pluginId = "superboard-files";
export const views = {
	"superboard.system_files": () => import("./views/superboard.system_files.js"),
	"superboard.data_files": () => import("./views/superboard.system_files.js"),
};
