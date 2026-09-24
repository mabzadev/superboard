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
			path_pattern: "/communication/notifications",
			title: "Push notifications",
			navigation: marketing("Push notifications", 8),
		},
		{
			path_pattern: "/communication/marketing-email",
			title: "Email",
			navigation: marketing("Email", 1),
		},
		...(
			[
				["in-app-messages", "In-app Messages", 0],
				["campaigns", "Campaigns", 2],
				["journeys", "Journeys", 3],
				["channels", "Channels", 4],
				["statistics", "Statistics", 5],
				["settings", "Settings", 6],
			] as const
		).map(([path, label, index]) => ({
			path_pattern: `/communication/${path}`,
			title: label,
			navigation: marketing(label, index),
		})),
		{ path_pattern: "/notifications", title: "Push notifications" },
		...[
			["in-app-messages", "In-app Messages"],
			["email", "Email"],
			["campaigns", "Campaigns"],
			["journeys", "Journeys"],
			["channels", "Channels"],
			["statistics", "Statistics"],
			["settings", "Settings"],
		].map(([path, label]) => ({
			path_pattern: `/marketing/${path}`,
			title: label,
		})),
		{ path_pattern: "/message-preview-craft", title: "Message preview" },
	],
});
