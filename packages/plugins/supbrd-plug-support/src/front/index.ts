export const pluginId = "supbrd-plugmod-support";
export const views = {
	"superboard.support_automations": () => import("./views/superboard.support_automations.js"),
	"superboard.support_captain": () => import("./views/superboard.support_captain.js"),
	"superboard.support_channels": () => import("./views/superboard.support_channels.js"),
	"superboard.support_configuration": () => import("./views/superboard.support_configuration.js"),
	"superboard.support_contacts": () => import("./views/superboard.support_contacts.js"),
	"superboard.support_help_center": () => import("./views/superboard.support_help_center.js"),
	"superboard.support_inbox": () => import("./views/superboard.support_inbox.js"),
	"superboard.support_integrations": () => import("./views/superboard.support_integrations.js"),
	"superboard.support_proactive_support": () =>
		import("./views/superboard.support_proactive_support.js"),
	"superboard.support_quality": () => import("./views/superboard.support_quality.js"),
	"superboard.support_reports": () => import("./views/superboard.support_reports.js"),
	"superboard.support_settings": () => import("./views/superboard.support_settings.js"),
	"superboard.support_workforce": () => import("./views/superboard.support_workforce.js"),
};
