import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-paywalls.command.create_paywall",
		kind: "command",
		operations: [
			{
				route_id: "api:paywalls:operator-proxy->POST:/api/v1/paywalls/projects/:projectRef",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-paywalls.command.update_paywall",
		kind: "command",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->PUT:/api/v1/paywalls/projects/:projectRef/paywalls/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-paywalls.command.archive_paywall",
		kind: "command",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->DELETE:/api/v1/paywalls/projects/:projectRef/paywalls/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-paywalls.command.create_paywall_version",
		kind: "command",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->POST:/api/v1/paywalls/projects/:projectRef/paywalls/:id/versions",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-paywalls.command.publish_paywall_version",
		kind: "command",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->POST:/api/v1/paywalls/projects/:projectRef/paywalls/:id/versions/:versionId/publish",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-paywalls.command.save_paywall_placement",
		kind: "command",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->PUT:/api/v1/paywalls/projects/:projectRef/placements/:id",
				query: "none",
				body: "passthrough",
			},
			{
				route_id:
					"api:paywalls:operator-proxy->POST:/api/v1/paywalls/projects/:projectRef/placements",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-paywalls.command.create_paywall_experience",
		kind: "command",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->POST:/api/v1/paywalls/projects/:projectRef/experiences",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-paywalls.command.update_paywall_experience",
		kind: "command",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->PUT:/api/v1/paywalls/projects/:projectRef/experiences/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-paywalls.command.archive_paywall_experience",
		kind: "command",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->DELETE:/api/v1/paywalls/projects/:projectRef/experiences/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-paywalls.data_source.paywalls",
		kind: "data_source",
		operations: [
			{
				route_id: "api:paywalls:operator-proxy->GET:/api/v1/paywalls/projects/:projectRef",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-paywalls.data_source.paywall_versions",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->GET:/api/v1/paywalls/projects/:projectRef/paywalls/:id/versions",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-paywalls.data_source.paywall_placements",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->GET:/api/v1/paywalls/projects/:projectRef/placements",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-paywalls.data_source.paywall_experiences",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->GET:/api/v1/paywalls/projects/:projectRef/experiences",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-paywalls.data_source.paywall_statistics",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:paywalls:operator-proxy->GET:/api/v1/paywalls/projects/:projectRef/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
