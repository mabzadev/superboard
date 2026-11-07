export const pluginId = "superboard-files";
export const views = {
	"superboard.system_files": () => import("./views/superboard.system_files.js"),
	"superboard.data_files": () => import("./views/superboard.system_files.js"),
	"superboard.data_database": () => import("./views/superboard.data_database.js"),
	"superboard.data_storage": () => import("./views/superboard.data_storage.js"),
	"superboard.data_functions": () => import("./views/superboard.data_functions.js"),
	"superboard.data_vectors": () => import("./views/superboard.data_vectors.js"),
	"superboard.data_api": () => import("./views/superboard.data_api.js"),
};
