import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-functions.data_source.data_functions",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:functions-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-functions.data_source.data_function",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:function-get",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-functions.data_source.data_function_runs",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:function-runs",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-functions.command.deploy_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:function-deploy",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-functions.command.delete_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:function-delete",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-functions.command.rollback_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:function-rollback",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-functions.command.invoke_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:function-invoke",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-functions.command.schedule_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:function-schedule-set",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-functions.command.unschedule_data_function",
		kind: "command",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:function-schedule-delete",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-functions.data_source.data_function_status",
		kind: "data_source",
		operations: [
			{
				route_id: "api:data-functions:operator-proxy->data:operator:functions-status",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
