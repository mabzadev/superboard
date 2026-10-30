import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-audit.command.archive_ledger",
		kind: "command",
		operations: [
			{
				route_id: "site:audit:archive",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-audit.command.verify_ledger",
		kind: "command",
		operations: [
			{
				route_id: "site:audit:verify",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-audit.data_source.ledger",
		kind: "data_source",
		operations: [
			{
				route_id: "site:audit:ledger",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-audit.data_source.ledger_search",
		kind: "data_source",
		operations: [
			{
				route_id: "site:audit:ledger@internal:/_emdash/api/superboard/audit/ledger/search",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-audit.data_source.archives",
		kind: "data_source",
		operations: [
			{
				route_id: "site:audit:archives-list",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
