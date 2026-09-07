import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-analytics.command.create_analytics_report",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/analytics/projects/:projectRef/reports",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.update_analytics_report",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/analytics/projects/:projectRef/reports/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.delete_analytics_report",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/analytics/projects/:projectRef/reports/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.create_analytics_operation",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/analytics/projects/:projectRef/operations",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.create_analytics_dashboard",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/analytics/projects/:projectRef/dashboards",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.update_analytics_dashboard",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/analytics/projects/:projectRef/dashboards/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.delete_analytics_dashboard",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/analytics/projects/:projectRef/dashboards/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.create_analytics_cohort",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/analytics/projects/:projectRef/cohorts",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.evaluate_analytics_cohort",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/analytics/projects/:projectRef/cohorts/:id/evaluate",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.upsert_analytics_remote_config",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/analytics/projects/:projectRef/remote-config/:key",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.create_analytics_alert",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/analytics/projects/:projectRef/alerts",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.command.update_analytics_settings",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/analytics/projects/:projectRef/settings",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_overview",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/overview",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_events",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/events",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_event_analysis",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/events/analyze",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_installations",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/installations",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_purchases",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/purchases",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_retention",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/retention",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_reports",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/reports",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_dashboards",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/dashboards",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_sessions",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/sessions",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_profiles",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/profiles",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_views",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/views",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_dimensions",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/dimensions",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_crashes",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/crashes",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_feedback",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/feedback",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_cohorts",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/cohorts",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_remote_config",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/remote-config",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_alerts",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/alerts",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-analytics.data_source.analytics_settings",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/analytics/projects/:projectRef/settings",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
