export const pluginId = "supbrd-plugmod-paywalls";
export const views = {
	"superboard.paywalls": () => import("./views/superboard.paywalls.js"),
	"superboard.paywalls_statistics": () => import("./views/superboard.paywalls_statistics.js"),
	"superboard.acquisition_paywalls": () => import("./views/superboard.paywalls.js"),
	"superboard.acquisition_paywalls_statistics": () =>
		import("./views/superboard.paywalls_statistics.js"),
};
