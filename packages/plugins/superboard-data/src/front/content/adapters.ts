import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plug-content.command.create_document",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/_emdash/api/content/:collection",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-content.command.update_document",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/_emdash/api/content/:collection/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-content.command.publish_document",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/_emdash/api/content/:collection/:id/publish",
				query: "passthrough",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-content.data_source.documents",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/_emdash/api/content/:collection",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-content.data_source.taxonomies",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/_emdash/api/taxonomies",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-content.data_source.revisions",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/_emdash/api/content/:collection/:id/revisions",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
