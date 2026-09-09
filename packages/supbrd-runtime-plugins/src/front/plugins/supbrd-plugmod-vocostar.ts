import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const navigation = navigationGroup({
	group_id: "vocostar",
	group_label: "Vocostar",
	group_order: 9,
});
export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-vocostar",
	plugin_label: "Vocostar",
	description: "Manage voice and media processing for the current application environment.",
	surfaces: [
		["voices", "Voices"],
		["conversions", "Conversions"],
		["outputs", "Generated files"],
		["jobs", "Processing jobs"],
		["settings", "Vocostar settings"],
	].map(([path, title], index) => ({
		path_pattern: `/plugins/vocostar/${path}`,
		title,
		navigation: navigation(title, index),
	})),
});
