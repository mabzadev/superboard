import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-flows.command.create_workflow",
		kind: "command",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:POST:/internal/v1/projects/:projectRef/workflows",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-flows.command.update_workflow",
		kind: "command",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:PUT:/internal/v1/projects/:projectRef/workflows/:workflowId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-flows.command.publish_workflow",
		kind: "command",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:POST:/internal/v1/projects/:projectRef/workflows/:workflowId/publish",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-flows.command.activate_version",
		kind: "command",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:POST:/internal/v1/projects/:projectRef/workflows/:workflowId/releases",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-flows.command.create_environment",
		kind: "command",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:POST:/internal/v1/projects/:projectRef/environments",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-flows.command.rotate_environment_key",
		kind: "command",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:POST:/internal/v1/projects/:projectRef/environments/:environmentId/rotate-key",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-flows.command.save_localization",
		kind: "command",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:PUT:/internal/v1/projects/:projectRef/localization",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-flows.data_source.overview",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:GET:/internal/v1/projects/:projectRef/overview",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-flows.data_source.components",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:GET:/internal/v1/projects/:projectRef/components",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-flows.data_source.workflows",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:GET:/internal/v1/projects/:projectRef/workflows",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-flows.data_source.workflow",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:GET:/internal/v1/projects/:projectRef/workflows/:workflowId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-flows.data_source.environments",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:GET:/internal/v1/projects/:projectRef/environments",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-flows.data_source.localization",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:GET:/internal/v1/projects/:projectRef/localization",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-flows.data_source.users",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:GET:/internal/v1/projects/:projectRef/users",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-flows.data_source.user_details",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:flows:operator-proxy->flows:index.app:GET:/internal/v1/projects/:projectRef/users/:userHash",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
