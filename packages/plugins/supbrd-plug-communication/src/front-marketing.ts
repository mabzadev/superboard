import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const marketing = navigationGroup({
	group_id: "marketing",
	group_label: "Marketing",
	group_order: 7,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-marketing",
	plugin_label: "Marketing",
	description:
		"Build campaigns, journeys, messages, and channel settings from the active Marketing plugin.",
	surfaces: [
		{
			path_pattern: "/notifications",
			title: "Push notifications",
			navigation: marketing("Push notifications", 8),
		},
		...[
			["in-app-messages", "In-app Messages"],
			["email", "Email"],
			["campaigns", "Campaigns"],
			["journeys", "Journeys"],
			["channels", "Channels"],
			["statistics", "Statistics"],
			["settings", "Settings"],
		].map(([path, label], index) => ({
			path_pattern: `/marketing/${path}`,
			title: label,
			navigation: marketing(label, index),
		})),
		{ path_pattern: "/message-preview-craft", title: "Message preview" },
	],
});
