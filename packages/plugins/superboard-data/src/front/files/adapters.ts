import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-files.command.create_upload_ticket",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->files:operator:upload-create",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.complete_upload",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->files:operator:upload-complete",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.delete_object",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->files:operator:object-delete",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.command.collect_garbage",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->files:operator:collect-garbage",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.data_source.objects",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->files:operator:objects-list",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.object_metadata",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->files:operator:object-read",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.download_ticket",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->files:operator:object-download-ticket",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.storage_usage",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->files:operator:usage",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
