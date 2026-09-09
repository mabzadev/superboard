import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters: PluginApiAdapter[] = [
	...["jobs", "voices", "conversions", "outputs"].map(
		(name): PluginApiAdapter => ({
			id: `supbrd-plugmod-vocostar.data_source.${name}`,
			kind: "data_source",
			operations: [
				{
					method: "GET",
					path: `/api/v1/plugins/vocostar/projects/:projectRef/${name}`,
					query: "passthrough",
					body: "none",
				},
			],
		}),
	),
	{
		id: "supbrd-plugmod-vocostar.command.retry_job",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/plugins/vocostar/projects/:projectRef/jobs/:jobId/retry",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-vocostar.data_source.settings",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/_emdash/api/admin/plugins/supbrd-plugmod-vocostar/settings",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-vocostar.command.update_settings",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/_emdash/api/admin/plugins/supbrd-plugmod-vocostar/settings",
				query: "none",
				body: "passthrough",
			},
		],
	},
];
