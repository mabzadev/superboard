import { defineNativeFrontPlugin } from "../runtime-factory.js";

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plug-content",
	plugin_label: "Content",
	description: "Content presentation is contributed when a Front Draft selects a Content surface.",
	surfaces: [],
});
