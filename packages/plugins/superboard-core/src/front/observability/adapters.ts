import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-observability.command.acknowledge_incident",
		kind: "command",
		operations: [
			{
				route_id: "api:observability:incident-acknowledge",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-observability.command.resolve_incident",
		kind: "command",
		operations: [
			{
				route_id: "api:observability:incident-resolve",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-observability.command.retry_custom_job",
		kind: "command",
		operations: [
			{
				route_id: "api:routes.platform-status.platform:POST:/custom/jobs/:jobId/retry",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-observability.command.replay_email_dead_letter",
		kind: "command",
		operations: [
			{
				route_id:
					"api:routes.platform-status.platform:POST:/email/dead-letters/:deadLetterId/replay",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-observability.command.discard_email_dead_letter",
		kind: "command",
		operations: [
			{
				route_id:
					"api:routes.platform-status.platform:POST:/email/dead-letters/:deadLetterId/discard",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-observability.data_source.platform_status",
		kind: "data_source",
		operations: [
			{
				route_id: "api:routes.platform-status.platform:GET:/status",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-observability.data_source.runtime_metrics",
		kind: "data_source",
		operations: [
			{
				route_id: "api:observability:runtime-metrics",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-observability.data_source.service_health",
		kind: "data_source",
		operations: [
			{
				route_id: "api:observability:service-health",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-observability.data_source.incidents",
		kind: "data_source",
		operations: [
			{
				route_id: "api:observability:incidents-list",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-observability.data_source.platform_custom_jobs",
		kind: "data_source",
		operations: [
			{
				route_id: "api:routes.platform-status.platform:GET:/custom/jobs",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-observability.data_source.platform_email_operations",
		kind: "data_source",
		operations: [
			{
				route_id: "api:routes.platform-status.platform:GET:/email/operations",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
