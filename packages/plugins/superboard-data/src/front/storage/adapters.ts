import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-storage.data_source.data_buckets",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-storage:operator-proxy->data:operator:buckets-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-storage.data_source.data_bucket_objects",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-storage:operator-proxy->data:operator:objects-list",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-storage.command.create_data_bucket",
		kind: "command",
		operations: [
			{
				route_id: "api:data-storage:operator-proxy->data:operator:buckets-create",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-storage.command.update_data_bucket",
		kind: "command",
		operations: [
			{
				route_id: "api:data-storage:operator-proxy->data:operator:bucket-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-storage.command.delete_data_bucket",
		kind: "command",
		operations: [
			{
				route_id: "api:data-storage:operator-proxy->data:operator:bucket-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
