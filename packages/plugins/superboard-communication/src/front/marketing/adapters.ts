import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-marketing.command.create_email_campaign",
		kind: "command",
		operations: [
			{
				route_id: "api:marketing:operator-proxy->marketing:index.app:POST:/internal/v1/campaigns",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.command.update_email_campaign",
		kind: "command",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:index.app:PATCH:/internal/v1/campaigns/:campaignId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.command.transition_email_campaign",
		kind: "command",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:index.app:POST:/internal/v1/campaigns/:campaignId/start",
				query: "none",
				body: "passthrough",
			},
			{
				route_id:
					"api:marketing:operator-proxy->marketing:index.app:POST:/internal/v1/campaigns/:campaignId/pause",
				query: "none",
				body: "passthrough",
			},
			{
				route_id:
					"api:marketing:operator-proxy->marketing:index.app:POST:/internal/v1/campaigns/:campaignId/resume",
				query: "none",
				body: "passthrough",
			},
			{
				route_id:
					"api:marketing:operator-proxy->marketing:index.app:POST:/internal/v1/campaigns/:campaignId/cancel",
				query: "none",
				body: "passthrough",
			},
			{
				route_id:
					"api:marketing:operator-proxy->marketing:index.app:POST:/internal/v1/campaigns/:campaignId/archive",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.command.schedule_email_campaign",
		kind: "command",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:index.app:POST:/internal/v1/campaigns/:campaignId/schedule",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.command.create_marketing_journey",
		kind: "command",
		operations: [
			{
				route_id: "api:marketing:operator-proxy->marketing:journeys.journeyRoutes:POST:/journeys",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.command.update_marketing_journey",
		kind: "command",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:PATCH:/journeys/:journeyId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.command.transition_marketing_journey",
		kind: "command",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:POST:/journeys/:journeyId/activate",
				query: "none",
				body: "passthrough",
			},
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:POST:/journeys/:journeyId/pause",
				query: "none",
				body: "passthrough",
			},
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:POST:/journeys/:journeyId/resume",
				query: "none",
				body: "passthrough",
			},
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:POST:/journeys/:journeyId/archive",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.command.create_marketing_channel_connector",
		kind: "command",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:POST:/channel-connectors",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.command.update_marketing_channel_connector",
		kind: "command",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:PATCH:/channel-connectors/:connectorId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.command.delete_marketing_channel_connector",
		kind: "command",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:DELETE:/channel-connectors/:connectorId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.email_subscribers",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:index.app:GET:/internal/v1/email/subscribers",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.subscriber_lists",
		kind: "data_source",
		operations: [
			{
				route_id: "api:marketing:operator-proxy->marketing:index.app:GET:/internal/v1/lists",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.subscriber_segments",
		kind: "data_source",
		operations: [
			{
				route_id: "api:marketing:operator-proxy->marketing:index.app:GET:/internal/v1/segments",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.email_templates",
		kind: "data_source",
		operations: [
			{
				route_id: "api:marketing:operator-proxy->marketing:index.app:GET:/internal/v1/templates",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.email_campaigns",
		kind: "data_source",
		operations: [
			{
				route_id: "api:marketing:operator-proxy->marketing:index.app:GET:/internal/v1/campaigns",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.marketing_statistics",
		kind: "data_source",
		operations: [
			{
				route_id: "api:marketing:operator-proxy->marketing:index.app:GET:/internal/v1/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.marketing_journeys",
		kind: "data_source",
		operations: [
			{
				route_id: "api:marketing:operator-proxy->marketing:journeys.journeyRoutes:GET:/journeys",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.journey_enrollments",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:GET:/journeys/:journeyId/enrollments",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.journey_statistics",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:GET:/journeys/:journeyId/statistics",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.marketing_channel_connectors",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:marketing:operator-proxy->marketing:journeys.journeyRoutes:GET:/channel-connectors",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-marketing.command.create_notification",
		kind: "command",
		operations: [
			{
				route_id: "api:routes.projects.projects:POST:/:projectRef/notifications",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-marketing.data_source.notifications",
		kind: "data_source",
		operations: [
			{
				route_id: "api:routes.projects.projects:POST:/:projectRef/notifications/search",
				query: "none",
				body: "passthrough",
				read_only: true,
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
