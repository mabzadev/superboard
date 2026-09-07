import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plug-audit.command.archive_ledger",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/_emdash/api/superboard/audit/archives",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-audit.command.verify_ledger",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/_emdash/api/superboard/audit/verify",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-audit.data_source.ledger",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/_emdash/api/superboard/audit/ledger",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-audit.data_source.ledger_search",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/_emdash/api/superboard/audit/ledger/search",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-audit.data_source.archives",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/_emdash/api/superboard/audit/archives",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
