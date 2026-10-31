import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

// Fallback navigation (used only when the EmDash menu is missing) mirrors the seeded section.
const communication = navigationGroup({
	group_id: "marketing",
	group_label: "Communication",
	group_order: 4,
});
const menu = [
	["marketing-email", "Emails", "E-mails"],
	["journeys", "Automations", "Automatisations"],
	["in-app-messages", "In-app & Push", "In-app et push"],
	["audience", "Audience", "Audience"],
	["statistics", "Activity", "Activité"],
	["settings", "Settings", "Paramètres"],
] as const;
const menuKey = (path: string) => `superboard-marketing.menu.${path}`;
const navigation = (path: string) => {
	const index = menu.findIndex(([item]) => item === path);
	return index === -1 ? {} : { navigation: communication(menuKey(path), index) };
};

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-marketing",
	plugin_label: "Marketing",
	description:
		"Build campaigns, journeys, messages, and channel settings from the active Marketing plugin.",
	translations: {
		en: Object.fromEntries(menu.map(([path, en]) => [menuKey(path), en])),
		fr: Object.fromEntries(menu.map(([path, , fr]) => [menuKey(path), fr])),
	},
	surfaces: [
		{ path_pattern: "/communication/notifications", title: "Push notifications" },
		...(
			[
				["marketing-email", "Email"],
				["in-app-messages", "In-app Messages"],
				["campaigns", "Campaigns"],
				["journeys", "Journeys"],
				["audience", "Audience"],
				["channels", "Channels"],
				["statistics", "Statistics"],
				["settings", "Settings"],
			] as const
		).map(([path, title]) => ({
			path_pattern: `/communication/${path}`,
			title,
			...navigation(path),
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
