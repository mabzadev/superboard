import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-dynamic-links.command.create_link",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:POST:/internal/v1/links",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.update_link",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:PUT:/internal/v1/links/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.delete_link",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:DELETE:/internal/v1/links/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.create_link_campaign",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:POST:/internal/v1/campaigns",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.delete_link_campaign",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:DELETE:/internal/v1/campaigns/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.create_redirect_rule",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:POST:/internal/v1/redirect-rules",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.update_redirect_rule",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:PUT:/internal/v1/redirect-rules/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.delete_redirect_rule",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:DELETE:/internal/v1/redirect-rules/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.create_domain",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:POST:/internal/v1/domains",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.verify_domain",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:POST:/internal/v1/domains/:id/verify",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.delete_domain",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:DELETE:/internal/v1/domains/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.save_social_preview",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:PUT:/internal/v1/social-preview",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-dynamic-links.command.save_tracking",
		kind: "command",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:PUT:/internal/v1/tracking",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-dynamic-links.data_source.links",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:GET:/internal/v1/links",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.data_source.resolved_link",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:POST:/internal/v1/links/:slug/resolve",
				query: "none",
				body: "passthrough",
				read_only: true,
			},
		],
	},
	{
		id: "superboard-dynamic-links.data_source.link_campaigns",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:GET:/internal/v1/campaigns",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.data_source.link_campaign_analytics",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:GET:/internal/v1/campaign-analytics",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.data_source.redirect_rules",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:GET:/internal/v1/redirect-rules",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.data_source.domains",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:GET:/internal/v1/domains",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.data_source.social_preview",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:GET:/internal/v1/social-preview",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.data_source.tracking",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:GET:/internal/v1/tracking",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-dynamic-links.data_source.link_statistics",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:dynamic-links:operator-proxy->dynamic-links:index.app:GET:/internal/v1/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
