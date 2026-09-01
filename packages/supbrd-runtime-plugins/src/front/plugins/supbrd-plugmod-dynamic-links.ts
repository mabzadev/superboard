import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const growth = navigationGroup({ group_id: "growth", group_label: "Growth", group_order: 4 });

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-dynamic-links",
	plugin_label: "Dynamic links",
	description:
		"Manage links, campaigns, domains, redirects, previews, and tracking from the plugin Store.",
	surfaces: [
		{ path_pattern: "/dynamic-links/links", title: "Links", navigation: growth("Links", 10) },
		{
			path_pattern: "/dynamic-links/campaigns",
			title: "Link campaigns",
			navigation: growth("Link campaigns", 11),
		},
		{ path_pattern: "/dynamic-links/campaigns/:id", title: "Link campaign" },
		{
			path_pattern: "/dynamic-links/domain",
			title: "Link domain",
			navigation: growth("Link domain", 12),
		},
		{
			path_pattern: "/dynamic-links/redirect-rules",
			title: "Redirect rules",
			navigation: growth("Redirect rules", 13),
		},
		{
			path_pattern: "/dynamic-links/social-media-preview",
			title: "Social preview",
			navigation: growth("Social preview", 14),
		},
		{
			path_pattern: "/dynamic-links/tracking",
			title: "Link tracking",
			navigation: growth("Link tracking", 15),
		},
	],
});
