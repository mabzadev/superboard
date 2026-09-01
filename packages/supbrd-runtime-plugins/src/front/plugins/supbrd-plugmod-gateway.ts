import { defineNativeFrontPlugin } from "../runtime-factory.js";

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-gateway",
	plugin_label: "Gateway",
	description: "Gateway presentation is contributed when a Front Draft selects a Gateway surface.",
	surfaces: [],
});
