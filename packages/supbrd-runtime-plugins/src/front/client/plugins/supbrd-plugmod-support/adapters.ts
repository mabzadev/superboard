import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-support.command.update_support_settings",
		kind: "command",
		operations: [
			{
				method: "PATCH",
				path: "/api/v1/support/projects/:projectRef/settings",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.create_support_configuration",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/support/projects/:projectRef/settings/entities",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.update_support_configuration",
		kind: "command",
		operations: [
			{
				method: "PATCH",
				path: "/api/v1/support/projects/:projectRef/settings/entities/:entityId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.delete_support_configuration",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/support/projects/:projectRef/settings/entities/:entityId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.rotate_support_webhook_secret",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/support/projects/:projectRef/settings/entities/:entityId/secret",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.revoke_support_webhook_secret",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/support/projects/:projectRef/settings/entities/:entityId/secret",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.send_inbox_message",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/support/projects/:projectRef/conversations/:conversationId/messages",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.update_inbox_conversation",
		kind: "command",
		operations: [
			{
				method: "PATCH",
				path: "/api/v1/support/projects/:projectRef/conversations/:conversationId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.create_support_provider",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/support/projects/:projectRef/providers",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.update_support_provider",
		kind: "command",
		operations: [
			{
				method: "PATCH",
				path: "/api/v1/support/projects/:projectRef/providers/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.delete_support_provider",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/support/projects/:projectRef/providers/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.create_support_integration",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/support/projects/:projectRef/integrations",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.update_support_integration",
		kind: "command",
		operations: [
			{
				method: "PATCH",
				path: "/api/v1/support/projects/:projectRef/integrations/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.delete_support_integration",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/support/projects/:projectRef/integrations/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.command.publish_support_article",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/support/projects/:projectRef/help-center/articles/:id/publish",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.support_settings",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/settings",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.unified_inbox_items",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/items",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.inbox_conversations",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/conversations",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.inbox_messages",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/conversations/:conversationId/messages",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.support_channels",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/channels",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.support_providers",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/providers",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.support_integrations",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/integrations",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.support_portals",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/help-center/portals",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.support_categories",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/help-center/categories",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.support_folders",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/help-center/folders",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.support_articles",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/help-center/articles",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-support.data_source.support_assistant_tasks",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/support/projects/:projectRef/captain/tasks",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
