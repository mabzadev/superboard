import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-database.data_source.data_status",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:status",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-database.data_source.data_tables",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:tables-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-database.data_source.data_table",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:table-get",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-database.data_source.data_rows",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:rows-list",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-database.data_source.data_settings",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:settings-get",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-database.data_source.data_keys",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:keys-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-database.command.create_data_table",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:tables-create",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-database.command.update_data_table",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:table-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-database.command.delete_data_table",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:table-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-database.command.add_data_column",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:column-add",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-database.command.update_data_column",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:column-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-database.command.delete_data_column",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:column-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-database.command.insert_data_row",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:rows-insert",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-database.command.update_data_row",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:row-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-database.command.delete_data_row",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:row-delete",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-database.command.run_data_sql",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:sql",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-database.command.update_data_settings",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:settings-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-database.command.create_service_key",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:keys-create",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-database.command.revoke_service_key",
		kind: "command",
		operations: [
			{
				route_id: "api:data-database:operator-proxy->data:operator:key-revoke",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
