import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const growth = navigationGroup({ group_id: "growth", group_label: "Growth", group_order: 4 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-marketing",
	plugin_label: "Marketing",
	description:
		"Build campaigns, journeys, messages, and channel settings from the active Marketing plugin.",
	surfaces: [
		...[
			["campaigns", "Campaigns"],
			["email", "Email"],
			["journeys", "Journeys"],
			["channels", "Channels"],
			["in-app-messages", "In-app messages"],
			["statistics", "Marketing statistics"],
			["settings", "Marketing settings"],
		].map(([path, label], index) => ({
			path_pattern: `/marketing/${path}`,
			title: label,
			navigation: growth(label, index),
		})),
		{ path_pattern: "/message-preview-craft", title: "Message preview" },
	],
});
