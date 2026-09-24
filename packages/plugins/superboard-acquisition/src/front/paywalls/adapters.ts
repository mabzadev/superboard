import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-paywalls.command.create_paywall",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/paywalls/projects/:projectRef",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.command.update_paywall",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.command.archive_paywall",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.command.create_paywall_version",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId/versions",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.command.publish_paywall_version",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId/versions/:versionId/publish",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.command.save_paywall_placement",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/paywalls/projects/:projectRef/placements/:id",
				query: "none",
				body: "passthrough",
			},
			{
				method: "POST",
				path: "/api/v1/paywalls/projects/:projectRef/placements",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.command.create_paywall_experience",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/paywalls/projects/:projectRef/experiences",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.command.update_paywall_experience",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/paywalls/projects/:projectRef/experiences/:experienceId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.command.archive_paywall_experience",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/paywalls/projects/:projectRef/experiences/:experienceId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.data_source.paywalls",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/paywalls/projects/:projectRef",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.data_source.paywall_versions",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId/versions",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.data_source.paywall_placements",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/paywalls/projects/:projectRef/placements",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.data_source.paywall_experiences",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/paywalls/projects/:projectRef/experiences",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-paywalls.data_source.paywall_statistics",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/paywalls/projects/:projectRef/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
