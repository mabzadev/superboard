export const pluginId = "superboard-onboardings";
export const views = {
	"superboard.onboardings": () => import("./views/superboard.onboardings.js"),
	"superboard.onboardings_statistics": () => import("./views/superboard.onboardings_statistics.js"),
};
