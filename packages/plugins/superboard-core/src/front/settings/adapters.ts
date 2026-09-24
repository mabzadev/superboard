import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plug-settings.command.update_effective_settings",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/_emdash/api/admin/plugins/supbrd-plug-settings/settings",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-settings.command.save_sdk_configuration",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/app/projects/:projectRef/setup/:platform",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-settings.command.test_sdk_configuration",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/app/projects/:projectRef/setup/:platform/test",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-settings.data_source.effective_settings",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/_emdash/api/admin/plugins/supbrd-plug-settings/settings",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-settings.data_source.settings_versions",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/_emdash/api/superboard/settings/versions",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-settings.data_source.sdk_configurations",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/app/projects/:projectRef/setup/:platform",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
