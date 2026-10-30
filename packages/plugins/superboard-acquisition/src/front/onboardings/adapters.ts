import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-onboardings.command.create_onboarding",
		kind: "command",
		operations: [
			{
				route_id: "api:onboardings:operator-proxy->POST:/api/v1/onboardings/projects/:projectRef",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-onboardings.command.update_onboarding",
		kind: "command",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->PUT:/api/v1/onboardings/projects/:projectRef/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-onboardings.command.delete_onboarding",
		kind: "command",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->DELETE:/api/v1/onboardings/projects/:projectRef/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-onboardings.command.create_onboarding_version",
		kind: "command",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->POST:/api/v1/onboardings/projects/:projectRef/:id/versions",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-onboardings.command.publish_onboarding",
		kind: "command",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->POST:/api/v1/onboardings/projects/:projectRef/:id/publish",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-onboardings.command.save_onboarding_placement",
		kind: "command",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->PUT:/api/v1/onboardings/projects/:projectRef/placements/:id",
				query: "none",
				body: "passthrough",
			},
			{
				route_id:
					"api:onboardings:operator-proxy->POST:/api/v1/onboardings/projects/:projectRef/placements",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-onboardings.command.create_onboarding_targeting_rule",
		kind: "command",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->POST:/api/v1/onboardings/projects/:projectRef/targeting-rules",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-onboardings.command.create_onboarding_experience",
		kind: "command",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->POST:/api/v1/onboardings/projects/:projectRef/experiences",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-onboardings.command.set_onboarding_experience_status",
		kind: "command",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->POST:/api/v1/onboardings/projects/:projectRef/experiences/:id/status",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-onboardings.data_source.onboardings",
		kind: "data_source",
		operations: [
			{
				route_id: "api:onboardings:operator-proxy->GET:/api/v1/onboardings/projects/:projectRef",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-onboardings.data_source.onboarding_versions",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->GET:/api/v1/onboardings/projects/:projectRef/:id/versions",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-onboardings.data_source.onboarding_placements",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->GET:/api/v1/onboardings/projects/:projectRef/placements",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-onboardings.data_source.onboarding_targeting_rules",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->GET:/api/v1/onboardings/projects/:projectRef/targeting-rules",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-onboardings.data_source.onboarding_experiences",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->GET:/api/v1/onboardings/projects/:projectRef/experiences",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-onboardings.data_source.onboarding_statistics",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:onboardings:operator-proxy->GET:/api/v1/onboardings/projects/:projectRef/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
