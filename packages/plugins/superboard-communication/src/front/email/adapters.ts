import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-email.command.send_transactional_email",
		kind: "command",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:POST:/internal/v1/admin/transactional",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-email.command.save_smtp_settings",
		kind: "command",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:PUT:/internal/v1/admin/settings/smtp",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-email.command.delete_smtp_settings",
		kind: "command",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:DELETE:/internal/v1/admin/settings/smtp/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-email.command.test_smtp_settings",
		kind: "command",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:POST:/internal/v1/admin/settings/smtp/test",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-email.command.verify_smtp_domain",
		kind: "command",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:POST:/internal/v1/admin/settings/smtp/:id/verify-domain",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-email.command.retry_delivery_outbox",
		kind: "command",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:POST:/internal/v1/admin/settings/delivery-outbox/:id/retry",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-email.command.replay_dead_letter",
		kind: "command",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:POST:/internal/v1/admin/settings/dead-letters/:id/:action{replay|discard}",
				query: "none",
				body: "passthrough",
				parameter_values: {
					action: ["replay"],
				},
			},
		],
	},
	{
		id: "superboard-email.command.discard_dead_letter",
		kind: "command",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:POST:/internal/v1/admin/settings/dead-letters/:id/:action{replay|discard}",
				query: "none",
				body: "passthrough",
				parameter_values: {
					action: ["discard"],
				},
			},
		],
	},
	{
		id: "superboard-email.data_source.smtp_settings",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:GET:/internal/v1/admin/settings/smtp",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-email.data_source.delivery_outbox",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:GET:/internal/v1/admin/settings/delivery-outbox",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-email.data_source.dead_letters",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:GET:/internal/v1/admin/settings/dead-letters",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-email.data_source.provider_webhooks",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:GET:/internal/v1/admin/settings/provider-webhooks",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-email.data_source.provider_events",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:email:operator-proxy->email:administration:GET:/internal/v1/admin/provider-events",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
