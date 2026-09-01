import { defineNativeFrontPlugin, navigationGroup } from "../runtime-factory.js";

const dynamicLinks = navigationGroup({
	group_id: "dynamic-links",
	group_label: "Dynamic Links",
	group_order: 5,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "supbrd-plugmod-dynamic-links",
	plugin_label: "Dynamic links",
	description:
		"Manage links, campaigns, domains, redirects, previews, and tracking from the plugin Store.",
	surfaces: [
		{ path_pattern: "/dynamic-links/links", title: "Links", navigation: dynamicLinks("Links", 0) },
		{
			path_pattern: "/dynamic-links/campaigns",
			title: "Campaigns",
			navigation: dynamicLinks("Campaigns", 1),
		},
		{ path_pattern: "/dynamic-links/campaigns/:id", title: "Link campaign" },
		{
			path_pattern: "/dynamic-links/redirect-rules",
			title: "Redirect Rules",
			navigation: dynamicLinks("Redirect Rules", 2),
		},
		{
			path_pattern: "/dynamic-links/domain",
			title: "Domain",
			navigation: dynamicLinks("Domain", 3),
		},
		{
			path_pattern: "/dynamic-links/social-media-preview",
			title: "Social Media Preview",
			navigation: dynamicLinks("Social Media Preview", 4),
		},
		{
			path_pattern: "/dynamic-links/tracking",
			title: "Tracking",
			navigation: dynamicLinks("Tracking", 5),
		},
	],
});
