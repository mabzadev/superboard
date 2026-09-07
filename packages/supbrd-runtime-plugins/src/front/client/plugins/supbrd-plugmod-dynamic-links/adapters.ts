import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-dynamic-links.command.create_link",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/dynamic-links/projects/:projectRef/links",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.update_link",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/dynamic-links/projects/:projectRef/links/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.delete_link",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/dynamic-links/projects/:projectRef/links/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.create_link_campaign",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/dynamic-links/projects/:projectRef/campaigns",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.delete_link_campaign",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/dynamic-links/projects/:projectRef/campaigns/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.create_redirect_rule",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/dynamic-links/projects/:projectRef/redirect-rules",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.update_redirect_rule",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/dynamic-links/projects/:projectRef/redirect-rules/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.delete_redirect_rule",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/dynamic-links/projects/:projectRef/redirect-rules/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.create_domain",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/dynamic-links/projects/:projectRef/domains",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.verify_domain",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/dynamic-links/projects/:projectRef/domains/:id/verify",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.delete_domain",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/dynamic-links/projects/:projectRef/domains/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.save_social_preview",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/dynamic-links/projects/:projectRef/social-preview",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.command.save_tracking",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/dynamic-links/projects/:projectRef/tracking",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.data_source.links",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/dynamic-links/projects/:projectRef/links",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.data_source.resolved_link",
		kind: "data_source",
		operations: [
			{
				method: "POST",
				path: "/api/v1/dynamic-links/projects/:projectRef/links/:slug/resolve",
				query: "none",
				body: "passthrough",
				read_only: true,
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.data_source.link_campaigns",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/dynamic-links/projects/:projectRef/campaigns",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.data_source.link_campaign_analytics",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/dynamic-links/projects/:projectRef/campaign-analytics",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.data_source.redirect_rules",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/dynamic-links/projects/:projectRef/redirect-rules",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.data_source.domains",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/dynamic-links/projects/:projectRef/domains",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.data_source.social_preview",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/dynamic-links/projects/:projectRef/social-preview",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.data_source.tracking",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/dynamic-links/projects/:projectRef/tracking",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-dynamic-links.data_source.link_statistics",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/dynamic-links/projects/:projectRef/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
