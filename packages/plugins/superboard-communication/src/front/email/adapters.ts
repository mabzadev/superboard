import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-email.command.send_transactional_email",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/email/projects/:projectRef/transactional",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.command.save_smtp_settings",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/email/projects/:projectRef/settings/smtp",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.command.delete_smtp_settings",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/email/projects/:projectRef/settings/smtp/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.command.test_smtp_settings",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/email/projects/:projectRef/settings/smtp/test",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.command.verify_smtp_domain",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/email/projects/:projectRef/settings/smtp/:profileId/verify-domain",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.command.retry_delivery_outbox",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/email/projects/:projectRef/settings/delivery-outbox/:id/retry",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.command.replay_dead_letter",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/email/projects/:projectRef/settings/dead-letters/:id/replay",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.command.discard_dead_letter",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/email/projects/:projectRef/settings/dead-letters/:id/discard",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.data_source.smtp_settings",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/email/projects/:projectRef/settings/smtp",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.data_source.delivery_outbox",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/email/projects/:projectRef/settings/delivery-outbox",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.data_source.dead_letters",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/email/projects/:projectRef/settings/dead-letters",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.data_source.provider_webhooks",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/email/projects/:projectRef/settings/provider-webhooks",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-email.data_source.provider_events",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/email/projects/:projectRef/provider-events",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
