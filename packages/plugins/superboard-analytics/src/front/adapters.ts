import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-analytics.command.create_analytics_report",
		kind: "command",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:POST:/internal/v1/reports",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.command.update_analytics_report",
		kind: "command",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:PUT:/internal/v1/reports/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.command.delete_analytics_report",
		kind: "command",
		operations: [
			{
				route_id:
					"api:analytics:operator-proxy->analytics:index.app:DELETE:/internal/v1/reports/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.command.create_analytics_operation",
		kind: "command",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:POST:/internal/v1/operations",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.command.create_analytics_dashboard",
		kind: "command",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:POST:/internal/v1/dashboards",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.command.update_analytics_dashboard",
		kind: "command",
		operations: [
			{
				route_id:
					"api:analytics:operator-proxy->analytics:index.app:PUT:/internal/v1/dashboards/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.command.delete_analytics_dashboard",
		kind: "command",
		operations: [
			{
				route_id:
					"api:analytics:operator-proxy->analytics:index.app:DELETE:/internal/v1/dashboards/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.command.create_analytics_cohort",
		kind: "command",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:POST:/internal/v1/cohorts",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.command.evaluate_analytics_cohort",
		kind: "command",
		operations: [
			{
				route_id:
					"api:analytics:operator-proxy->analytics:index.app:POST:/internal/v1/cohorts/:id/evaluate",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.command.upsert_analytics_remote_config",
		kind: "command",
		operations: [
			{
				route_id:
					"api:analytics:operator-proxy->analytics:index.app:PUT:/internal/v1/remote-config/:key",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.command.create_analytics_alert",
		kind: "command",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:POST:/internal/v1/alerts",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.command.update_analytics_settings",
		kind: "command",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:PUT:/internal/v1/settings",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_overview",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/overview",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_events",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/events",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_event_analysis",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/events/analyze",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_installations",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/installations",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_purchases",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/purchases",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_retention",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/retention",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_reports",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/reports",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_dashboards",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/dashboards",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_sessions",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/sessions",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_profiles",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/profiles",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_views",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/views",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_dimensions",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/dimensions",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_crashes",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/crashes",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_feedback",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/feedback",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_cohorts",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/cohorts",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_remote_config",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/remote-config",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_alerts",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/alerts",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-analytics.data_source.analytics_settings",
		kind: "data_source",
		operations: [
			{
				route_id: "api:analytics:operator-proxy->analytics:index.app:GET:/internal/v1/settings",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
