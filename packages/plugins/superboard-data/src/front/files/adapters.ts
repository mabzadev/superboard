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
	{
		id: "superboard-files.data_source.data_status",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:status",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_tables",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:tables-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_table",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:table-get",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_rows",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:rows-list",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_settings",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:settings-get",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_buckets",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:buckets-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_bucket_objects",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:objects-list",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_functions",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:functions-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_function",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:function-get",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_function_runs",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:function-runs",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_vector_collections",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:vector-collections-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.data_source.data_keys",
		kind: "data_source",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:keys-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.command.create_data_table",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:tables-create",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.update_data_table",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:table-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.delete_data_table",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:table-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.command.add_data_column",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:column-add",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.update_data_column",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:column-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.delete_data_column",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:column-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.command.insert_data_row",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:rows-insert",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.update_data_row",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:row-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.delete_data_row",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:row-delete",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.command.run_data_sql",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:sql",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.update_data_settings",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:settings-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.create_data_bucket",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:buckets-create",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.update_data_bucket",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:bucket-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.delete_data_bucket",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:bucket-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.command.deploy_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:function-deploy",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.delete_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:function-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.command.rollback_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:function-rollback",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.invoke_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:function-invoke",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.schedule_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:function-schedule-set",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.unschedule_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:function-schedule-delete",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.command.create_vector_collection",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:vector-collections-create",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.update_vector_collection",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:vector-collection-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.delete_vector_collection",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:vector-collection-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-files.command.create_service_key",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:keys-create",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-files.command.revoke_service_key",
		kind: "command",
		operations: [
			{
				route_id: "api:files:operator-proxy->data:operator:key-revoke",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
