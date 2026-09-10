export const pluginId = "supbrd-plugmod-analytics";
export const views = {
	"superboard.home": () => import("./views/superboard.home.js"),
	"superboard.analytics": () => import("./views/superboard.analytics.js"),
	"superboard.analytics_alerts": () => import("./views/superboard.analytics_alerts.js"),
	"superboard.analytics_cohorts": () => import("./views/superboard.analytics_cohorts.js"),
	"superboard.analytics_crashes": () => import("./views/superboard.analytics_crashes.js"),
	"superboard.analytics_dashboards": () => import("./views/superboard.analytics_dashboards.js"),
	"superboard.analytics_dimensions": () => import("./views/superboard.analytics_dimensions.js"),
	"superboard.analytics_events": () => import("./views/superboard.analytics_events.js"),
	"superboard.analytics_feedback": () => import("./views/superboard.analytics_feedback.js"),
	"superboard.analytics_insights": () => import("./views/superboard.analytics_insights.js"),
	"superboard.analytics_installations": () =>
		import("./views/superboard.analytics_installations.js"),
	"superboard.analytics_purchases": () => import("./views/superboard.analytics_purchases.js"),
	"superboard.analytics_remote_config": () =>
		import("./views/superboard.analytics_remote_config.js"),
	"superboard.analytics_reports": () => import("./views/superboard.analytics_reports.js"),
	"superboard.analytics_settings": () => import("./views/superboard.analytics_settings.js"),
	"superboard.analytics_users": () => import("./views/superboard.analytics_users.js"),
	"superboard.analytics_views": () => import("./views/superboard.analytics_views.js"),
	"superboard.app_shell": () => import("./views/superboard.app_shell.js"),
	"superboard.dashboard": () => import("./views/superboard.dashboard.js"),
};
