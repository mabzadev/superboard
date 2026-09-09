export const pluginId = "supbrd-plugmod-vocostar";
export const views = Object.fromEntries(
	["voices", "conversions", "outputs", "jobs", "settings"].map((page) => [
		`superboard.plugins_vocostar_${page}`,
		() => import("./VocostarPage.js"),
	]),
);
