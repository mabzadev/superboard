export const pluginId = "supbrd-plugmod-files";
export const views = {
	"superboard.system_files": () => import("./views/superboard.system_files.js"),
	"superboard.data_files": () => import("./views/superboard.system_files.js"),
	"superboard.data_settings": () => import("./views/superboard.data_settings.js"),
};
