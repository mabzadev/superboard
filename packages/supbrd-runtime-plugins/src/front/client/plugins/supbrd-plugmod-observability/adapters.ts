import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-observability.command.acknowledge_incident",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/observability/incidents/:incidentId/acknowledge",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.command.resolve_incident",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/observability/incidents/:incidentId/resolve",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.command.retry_custom_job",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/platform/custom/jobs/:jobId/retry",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.command.replay_email_dead_letter",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/platform/email/dead-letters/:deadLetterId/replay",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.command.discard_email_dead_letter",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/platform/email/dead-letters/:deadLetterId/discard",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.data_source.platform_status",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/platform/status",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.data_source.runtime_metrics",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/observability/runtime-metrics",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.data_source.service_health",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/observability/service-health",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.data_source.incidents",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/observability/incidents",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.data_source.platform_custom_jobs",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/platform/custom/jobs",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-observability.data_source.platform_email_operations",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/platform/email/operations",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
