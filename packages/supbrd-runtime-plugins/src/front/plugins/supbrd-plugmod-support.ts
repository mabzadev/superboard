import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const support = navigationGroup({ group_id: "support", group_label: "Support", group_order: 6 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-support",
	plugin_label: "Support",
	description:
		"Operate support conversations, contacts, automations, knowledge, and quality workflows.",
	surfaces: [
		...[
			"inbox",
			"contacts",
			"channels",
			"automations",
			"help-center",
			"proactive-support",
			"captain",
			"quality",
			"workforce",
			"reports",
			"integrations",
			"configuration",
			"settings",
		].map(supportSurface),
	],
});

function supportSurface(path: string, index: number) {
	const title = path
		.split("-")
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
	return {
		path_pattern: `/support/${path}`,
		title,
		navigation: support(title, index),
	};
}
