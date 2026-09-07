export const pluginId = "supbrd-plugmod-dynamic-links";
export const views = {
	"superboard.dynamic_links_campaigns": () =>
		import("./views/superboard.dynamic_links_campaigns.js"),
	"superboard.dynamic_links_campaigns_by_id": () =>
		import("./views/superboard.dynamic_links_campaigns_by_id.js"),
	"superboard.dynamic_links_domain": () => import("./views/superboard.dynamic_links_domain.js"),
	"superboard.dynamic_links_links": () => import("./views/superboard.dynamic_links_links.js"),
	"superboard.dynamic_links_redirect_rules": () =>
		import("./views/superboard.dynamic_links_redirect_rules.js"),
	"superboard.dynamic_links_social_media_preview": () =>
		import("./views/superboard.dynamic_links_social_media_preview.js"),
	"superboard.dynamic_links_tracking": () => import("./views/superboard.dynamic_links_tracking.js"),
};
