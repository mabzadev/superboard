import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-settings.command.update_effective_settings",
		kind: "command",
		operations: [
			{
				route_id: "site:settings:put",
				query: "none",
				body: "passthrough",
				parameter_values: {
					pluginId: ["superboard-settings"],
				},
			},
		],
	},
	{
		id: "superboard-settings.command.save_sdk_configuration",
		kind: "command",
		operations: [
			{
				route_id: "api:app:operator-proxy->app:index.app:PUT:/internal/v1/setup/:platform",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-settings.command.test_sdk_configuration",
		kind: "command",
		operations: [
			{
				route_id: "api:app:operator-proxy->app:index.app:POST:/internal/v1/setup/:platform/test",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-settings.data_source.effective_settings",
		kind: "data_source",
		operations: [
			{
				route_id: "site:settings:get",
				query: "passthrough",
				body: "none",
				parameter_values: {
					pluginId: ["superboard-settings"],
				},
			},
		],
	},
	{
		id: "superboard-settings.data_source.settings_versions",
		kind: "data_source",
		operations: [
			{
				route_id: "site:settings:versions",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-settings.data_source.sdk_configurations",
		kind: "data_source",
		operations: [
			{
				route_id: "api:app:operator-proxy->app:index.app:GET:/internal/v1/setup/:platform",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
