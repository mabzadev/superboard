import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-marketing.command.create_notification",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/projects/:projectRef/notifications",
				query: "none",
				body: "passthrough",
			},
		],
	},

	{
		id: "supbrd-plugmod-marketing.data_source.notifications",
		kind: "data_source",
		operations: [
			{
				method: "POST",
				path: "/api/v1/projects/:projectRef/notifications/search",
				query: "none",
				body: "passthrough",
				read_only: true,
			},
		],
	},

	{
		id: "supbrd-plugmod-marketing.command.create_email_campaign",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/marketing/projects/:projectRef/campaigns",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.command.update_email_campaign",
		kind: "command",
		operations: [
			{
				method: "PATCH",
				path: "/api/v1/marketing/projects/:projectRef/campaigns/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.command.transition_email_campaign",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/marketing/projects/:projectRef/campaigns/:id/:transition",
				query: "none",
				body: "passthrough",
				parameter_values: {
					transition: ["start", "pause", "resume", "cancel", "archive"],
				},
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.command.schedule_email_campaign",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/marketing/projects/:projectRef/campaigns/:id/schedule",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.command.create_marketing_journey",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/marketing/projects/:projectRef/journeys",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.command.update_marketing_journey",
		kind: "command",
		operations: [
			{
				method: "PATCH",
				path: "/api/v1/marketing/projects/:projectRef/journeys/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.command.transition_marketing_journey",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/marketing/projects/:projectRef/journeys/:id/:transition",
				query: "none",
				body: "passthrough",
				parameter_values: {
					transition: ["activate", "pause", "resume", "archive"],
				},
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.command.create_marketing_channel_connector",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/marketing/projects/:projectRef/channel-connectors",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.command.update_marketing_channel_connector",
		kind: "command",
		operations: [
			{
				method: "PATCH",
				path: "/api/v1/marketing/projects/:projectRef/channel-connectors/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.command.delete_marketing_channel_connector",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/marketing/projects/:projectRef/channel-connectors/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.email_subscribers",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/email/subscribers",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.subscriber_lists",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/lists",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.subscriber_segments",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/segments",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.email_templates",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/templates",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.email_campaigns",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/campaigns",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.marketing_statistics",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.marketing_journeys",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/journeys",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.journey_enrollments",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/journeys/:id/enrollments",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.journey_statistics",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/journeys/:id/statistics",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-marketing.data_source.marketing_channel_connectors",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/marketing/projects/:projectRef/channel-connectors",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
