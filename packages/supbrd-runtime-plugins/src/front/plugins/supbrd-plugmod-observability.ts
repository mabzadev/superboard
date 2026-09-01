import { defineNativeFrontPlugin } from "../runtime-factory.js";

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-observability",
	plugin_label: "Observability",
	description:
		"Inspect infrastructure health and operational signals from the Observability plugin.",
	surfaces: [{ path_pattern: "/infrastructure", title: "Infrastructure" }],
});
