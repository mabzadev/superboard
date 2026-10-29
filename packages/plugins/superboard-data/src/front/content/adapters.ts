import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-content.command.create_document",
		kind: "command",
		operations: [
			{
				route_id: "site:astro:POST:/_emdash/api/content/[collection]",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-content.command.update_document",
		kind: "command",
		operations: [
			{
				route_id: "site:astro:PUT:/_emdash/api/content/[collection]/[id]",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-content.command.publish_document",
		kind: "command",
		operations: [
			{
				route_id: "site:astro:POST:/_emdash/api/content/[collection]/[id]/publish",
				query: "passthrough",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-content.data_source.documents",
		kind: "data_source",
		operations: [
			{
				route_id: "site:astro:GET:/_emdash/api/content/[collection]",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-content.data_source.taxonomies",
		kind: "data_source",
		operations: [
			{
				route_id: "site:astro:GET:/_emdash/api/taxonomies",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-content.data_source.revisions",
		kind: "data_source",
		operations: [
			{
				route_id: "site:astro:GET:/_emdash/api/content/[collection]/[id]/revisions",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
