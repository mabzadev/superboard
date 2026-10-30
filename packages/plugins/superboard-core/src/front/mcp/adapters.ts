import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-mcp.command.approve_consent",
		kind: "command",
		operations: [
			{
				route_id: "api:routes.mcp.mcp:POST:/approve_consent",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-mcp.command.revoke_token",
		kind: "command",
		operations: [
			{
				route_id: "api:routes.mcp.mcp:DELETE:/tokens/:tokenId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-mcp.command.invoke_tool",
		kind: "command",
		operations: [
			{
				route_id: "api:mcp-operator:invoke",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-mcp.data_source.tokens",
		kind: "data_source",
		operations: [
			{
				route_id: "api:routes.mcp.mcp:GET:/tokens",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-mcp.data_source.sessions",
		kind: "data_source",
		operations: [
			{
				route_id: "api:mcp-operator:sessions-list",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-mcp.data_source.tool_receipts",
		kind: "data_source",
		operations: [
			{
				route_id: "api:mcp-operator:receipts-list",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
