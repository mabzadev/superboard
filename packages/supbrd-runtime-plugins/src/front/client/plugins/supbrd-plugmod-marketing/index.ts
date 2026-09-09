export const pluginId = "supbrd-plugmod-marketing";
export const views = {
	"superboard.notifications": () => import("./PushNotificationsPage.js"),
	"superboard.marketing_campaigns": () => import("./views/superboard.marketing_campaigns.js"),
	"superboard.marketing_channels": () => import("./views/superboard.marketing_channels.js"),
	"superboard.marketing_email": () => import("./views/superboard.marketing_email.js"),
	"superboard.marketing_in_app_messages": () =>
		import("./views/superboard.marketing_in_app_messages.js"),
	"superboard.marketing_journeys": () => import("./views/superboard.marketing_journeys.js"),
	"superboard.marketing_settings": () => import("./views/superboard.marketing_settings.js"),
	"superboard.marketing_statistics": () => import("./views/superboard.marketing_statistics.js"),
	"superboard.message_preview_craft": () => import("./views/superboard.message_preview_craft.js"),
};
