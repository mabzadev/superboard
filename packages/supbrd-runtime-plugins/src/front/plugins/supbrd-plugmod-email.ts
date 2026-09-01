import { defineNativeFrontPlugin } from "../runtime-factory.js";

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-email",
	plugin_label: "Email",
	description: "Email presentation is contributed when a Front Draft selects an Email surface.",
	surfaces: [],
});
