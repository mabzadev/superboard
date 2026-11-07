export const pluginId = "superboard-database";
export const views = {
	"superboard.data_database": () => import("./views/superboard.data_database.js"),
	"superboard.data_api": () => import("./views/superboard.data_api.js"),
};
