import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

const support = navigationGroup({ group_id: "support", group_label: "Support", group_order: 6 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-support",
	plugin_label: "Support",
	description:
		"Operate support conversations, contacts, automations, knowledge, and quality workflows.",
	surfaces: [
		...[
			["inbox", "Inbox"],
			["contacts", "Contacts"],
			["workforce", "Workforce"],
			["channels", "Channels"],
			["automations", "Automations"],
			["proactive-support", "Proactive Support"],
			["help-center", "Help Center"],
			["captain", "Captain"],
			["integrations", "Integrations"],
			["reports", "Reports"],
			["settings", "Settings"],
		].map(([path, title], index) => ({
			path_pattern: `/support/${path}`,
			title,
			navigation: support(title, index),
		})),
		{ path_pattern: "/support/quality", title: "Quality", navigation: support("Quality", 11) },
		{
			path_pattern: "/support/configuration",
			title: "Configuration",
			navigation: support("Configuration", 12),
		},
	],
});
