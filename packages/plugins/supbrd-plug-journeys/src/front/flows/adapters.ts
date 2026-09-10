import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-flows.command.create_workflow",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/flows/projects/:projectRef/workflows",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.command.update_workflow",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/flows/projects/:projectRef/workflows/:workflowId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.command.publish_workflow",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/flows/projects/:projectRef/workflows/:workflowId/publish",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.command.activate_version",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/flows/projects/:projectRef/workflows/:workflowId/releases",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.command.create_environment",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/flows/projects/:projectRef/environments",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.command.rotate_environment_key",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/flows/projects/:projectRef/environments/:environmentId/rotate-key",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.command.save_localization",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/flows/projects/:projectRef/localization",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.data_source.overview",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/flows/projects/:projectRef/overview",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.data_source.components",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/flows/projects/:projectRef/components",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.data_source.workflows",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/flows/projects/:projectRef/workflows",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.data_source.workflow",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/flows/projects/:projectRef/workflows/:workflowId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.data_source.environments",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/flows/projects/:projectRef/environments",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.data_source.localization",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/flows/projects/:projectRef/localization",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.data_source.users",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/flows/projects/:projectRef/users",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-flows.data_source.user_details",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/flows/projects/:projectRef/users/:userHash",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
