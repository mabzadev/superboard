import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-files.command.create_upload_ticket",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/files/projects/:projectRef/upload-tickets",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-files.command.complete_upload",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/files/projects/:projectRef/upload-tickets/:ticketId/complete",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-files.command.delete_object",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/files/projects/:projectRef/objects/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-files.command.collect_garbage",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/files/projects/:projectRef/collect-garbage",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-files.data_source.objects",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/files/projects/:projectRef/objects",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-files.data_source.object_metadata",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/files/projects/:projectRef/objects/:id",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-files.data_source.download_ticket",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/files/projects/:projectRef/objects/:id/download-ticket",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-files.data_source.storage_usage",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/files/projects/:projectRef/usage",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
