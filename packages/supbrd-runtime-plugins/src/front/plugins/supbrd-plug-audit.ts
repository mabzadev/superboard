import { defineNativeFrontPlugin } from "../runtime-factory.js";

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plug-audit",
	plugin_label: "Audit",
	description: "Audit presentation is contributed when a Front Draft selects an Audit surface.",
	surfaces: [{ path_pattern: "/system/audit", title: "Audit ledger" }],
});
