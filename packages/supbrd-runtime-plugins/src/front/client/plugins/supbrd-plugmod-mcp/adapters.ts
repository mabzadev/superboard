import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-mcp.command.approve_consent",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/mcp/approve_consent",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-mcp.command.revoke_token",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/mcp/tokens/:tokenId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-mcp.command.invoke_tool",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/mcp/operator/invocations",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-mcp.data_source.tokens",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/mcp/tokens",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-mcp.data_source.sessions",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/mcp/operator/sessions",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-mcp.data_source.tool_receipts",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/mcp/operator/receipts",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
