export const pluginId = "superboard-observability";
export const views = {
	"superboard.infrastructure": () => import("./views/superboard.infrastructure.js"),
};
