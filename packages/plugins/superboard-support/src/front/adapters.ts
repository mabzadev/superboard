import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-support.command.update_support_settings",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:configuration.configuration:PATCH:/:projectId/settings",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.create_support_configuration",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:configuration.configuration:POST:/:projectId/settings/entities",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.update_support_configuration",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:configuration.configuration:PATCH:/:projectId/settings/entities/:entityId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.delete_support_configuration",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:configuration.configuration:DELETE:/:projectId/settings/entities/:entityId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.command.rotate_support_webhook_secret",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:configuration.configuration:PUT:/:projectId/settings/entities/:entityId/secret",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.revoke_support_webhook_secret",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:configuration.configuration:DELETE:/:projectId/settings/entities/:entityId/secret",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.command.send_inbox_message",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:index.app:POST:/internal/v1/projects/:projectId/conversations/:conversationId/messages",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.update_inbox_conversation",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:index.app:PATCH:/internal/v1/projects/:projectId/conversations/:conversationId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.create_support_provider",
		kind: "command",
		operations: [
			{
				route_id: "api:support:operator-proxy->support:native.native:POST:/:projectId/providers",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.update_support_provider",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:native.native:PATCH:/:projectId/providers/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.delete_support_provider",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:native.native:DELETE:/:projectId/providers/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.command.create_support_integration",
		kind: "command",
		operations: [
			{
				route_id: "api:support:operator-proxy->support:native.native:POST:/:projectId/integrations",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.update_support_integration",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:native.native:PATCH:/:projectId/integrations/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-support.command.delete_support_integration",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:native.native:DELETE:/:projectId/integrations/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.command.publish_support_article",
		kind: "command",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:native.native:POST:/:projectId/help-center/articles/:id/publish",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.support_settings",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:configuration.configuration:GET:/:projectId/settings",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.unified_inbox_items",
		kind: "data_source",
		operations: [
			{
				route_id: "api:support:operator-proxy->support:operations.operations:GET:/:projectId/items",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.inbox_conversations",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:operations.operations:GET:/:projectId/conversations",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.inbox_messages",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:index.app:GET:/internal/v1/projects/:projectId/conversations/:conversationId/messages",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.support_channels",
		kind: "data_source",
		operations: [
			{
				route_id: "api:support:operator-proxy->support:native.native:GET:/:projectId/channels",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.support_providers",
		kind: "data_source",
		operations: [
			{
				route_id: "api:support:operator-proxy->support:native.native:GET:/:projectId/providers",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.support_integrations",
		kind: "data_source",
		operations: [
			{
				route_id: "api:support:operator-proxy->support:native.native:GET:/:projectId/integrations",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.support_portals",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:native.native:GET:/:projectId/help-center/portals",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.support_categories",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:native.native:GET:/:projectId/help-center/categories",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.support_folders",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:native.native:GET:/:projectId/help-center/folders",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.support_articles",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:support:operator-proxy->support:native.native:GET:/:projectId/help-center/articles",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-support.data_source.support_assistant_tasks",
		kind: "data_source",
		operations: [
			{
				route_id: "api:support:operator-proxy->support:native.native:GET:/:projectId/captain/tasks",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
