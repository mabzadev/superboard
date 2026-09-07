export const pluginId = "supbrd-plugmod-observability";
export const views = {
	"superboard.infrastructure": () => import("./views/superboard.infrastructure.js"),
};
