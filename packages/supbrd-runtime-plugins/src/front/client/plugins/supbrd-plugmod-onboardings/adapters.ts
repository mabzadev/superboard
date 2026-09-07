import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-onboardings.command.create_onboarding",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/onboardings/projects/:projectRef",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.command.update_onboarding",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/onboardings/projects/:projectRef/:onboardingId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.command.delete_onboarding",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/onboardings/projects/:projectRef/:onboardingId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.command.create_onboarding_version",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/onboardings/projects/:projectRef/:onboardingId/versions",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.command.publish_onboarding",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/onboardings/projects/:projectRef/:onboardingId/publish",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.command.save_onboarding_placement",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/onboardings/projects/:projectRef/placements/:placementId",
				query: "none",
				body: "passthrough",
			},
			{
				method: "POST",
				path: "/api/v1/onboardings/projects/:projectRef/placements",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.command.create_onboarding_targeting_rule",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/onboardings/projects/:projectRef/targeting-rules",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.command.create_onboarding_experience",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/onboardings/projects/:projectRef/experiences",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.command.set_onboarding_experience_status",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/onboardings/projects/:projectRef/experiences/:experienceId/status",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.data_source.onboardings",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/onboardings/projects/:projectRef",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.data_source.onboarding_versions",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/onboardings/projects/:projectRef/:onboardingId/versions",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.data_source.onboarding_placements",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/onboardings/projects/:projectRef/placements",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.data_source.onboarding_targeting_rules",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/onboardings/projects/:projectRef/targeting-rules",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.data_source.onboarding_experiences",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/onboardings/projects/:projectRef/experiences",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-onboardings.data_source.onboarding_statistics",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/onboardings/projects/:projectRef/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
