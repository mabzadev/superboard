import {
	defineNativeFrontPlugin,
	navigationGroup,
} from "../../../supbrd-core/src/plugin-front-runtime.js";

// Fallback navigation (used only when the EmDash menu is missing) mirrors the seeded section.
const acquisition = navigationGroup({
	group_id: "acquisition",
	group_label: "Acquisition",
	group_order: 5,
});

export const nativeFrontPlugin = defineNativeFrontPlugin({
	plugin_id: "superboard-dynamic-links",
	plugin_label: "Dynamic links",
	description:
		"Manage links, campaigns, domains, redirects, previews, and tracking from the plugin Store.",
	translations: {
		en: { "superboard-dynamic-links.menu.links": "Dynamic links" },
		fr: { "superboard-dynamic-links.menu.links": "Liens dynamiques" },
	},
	surfaces: [
		{
			path_pattern: "/acquisition/dynamic-links",
			title: "Dynamic links",
			navigation: acquisition("superboard-dynamic-links.menu.links", 2),
		},
		{ path_pattern: "/acquisition/dynamic-links/campaigns", title: "Campaigns" },
		{ path_pattern: "/acquisition/dynamic-links/campaigns/:id", title: "Link campaign" },
		{ path_pattern: "/acquisition/dynamic-links/redirect-rules", title: "Redirect Rules" },
		{ path_pattern: "/acquisition/dynamic-links/domain", title: "Domain" },
		{
			path_pattern: "/acquisition/dynamic-links/social-media-preview",
			title: "Social Media Preview",
		},
		{ path_pattern: "/acquisition/dynamic-links/tracking", title: "Tracking" },
		{ path_pattern: "/dynamic-links/links", title: "Links" },
		{ path_pattern: "/dynamic-links/campaigns", title: "Campaigns" },
		{ path_pattern: "/dynamic-links/campaigns/:id", title: "Link campaign" },
		{ path_pattern: "/dynamic-links/redirect-rules", title: "Redirect Rules" },
		{ path_pattern: "/dynamic-links/domain", title: "Domain" },
		{ path_pattern: "/dynamic-links/social-media-preview", title: "Social Media Preview" },
		{ path_pattern: "/dynamic-links/tracking", title: "Tracking" },
	],
});
