import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-vectors.data_source.data_vector_collections",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-vectors:operator-proxy->data:operator:vector-collections-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-vectors.command.create_vector_collection",
		kind: "command",
		operations: [
			{
				route_id: "api:data-vectors:operator-proxy->data:operator:vector-collections-create",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-vectors.command.update_vector_collection",
		kind: "command",
		operations: [
			{
				route_id: "api:data-vectors:operator-proxy->data:operator:vector-collection-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-vectors.command.delete_vector_collection",
		kind: "command",
		operations: [
			{
				route_id: "api:data-vectors:operator-proxy->data:operator:vector-collection-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
