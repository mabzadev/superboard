import { defineNativeFrontPlugin } from "../runtime-factory.js";

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-files",
	plugin_label: "Files",
	description: "File presentation is contributed when a Front Draft selects a Files surface.",
	surfaces: [{ path_pattern: "/system/files", title: "File storage" }],
});
