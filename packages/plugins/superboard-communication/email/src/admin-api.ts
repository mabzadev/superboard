import type { InternalProjectContext } from "@superboard/contracts/project-context";
import { createFetchRouter } from "@superboard/contracts/route-registry";

import {
	EMAIL_WEBHOOK_EVENT_TYPES,
	deliverWebhook,
	encryptWebhookSecret,
	generateWebhookSecret,
	normalizeWebhookEvents,
	normalizeWebhookUrl,
	parseEvents,
} from "./events.js";
import { EMAIL_SEND_SCOPE, generateEmailApiKey, hashEmailApiKey } from "./public-api.js";
import {
	expectedDnsRecords,
	normalizeDomainAuthenticationConfig,
	type DomainAuthenticationConfig,
} from "./sender-authentication.js";

const ADMIN_PREFIX = "/internal/v1/admin";
const MAX_ACTIVE_API_KEYS = 10;
const MAX_EVENT_WEBHOOKS = 5;

/** Mirrors the mutation contract of admin.ts; `response` is returned but never persisted. */
interface EmailApiAdminMutation {
	action: string;
	resourceId: string;
	statements: D1PreparedStatement[];
	data: unknown;
	response?: unknown;
	status?: number;
}
interface EmailApiAdminState {
	env: Env & { EMAIL_SMTP_ENCRYPTION_KEY?: string };
	context: InternalProjectContext;
	body: Record<string, unknown>;
	commit(mutation: EmailApiAdminMutation): Promise<Response>;
}

export const emailApiAdminRoutes = createFetchRouter<EmailApiAdminState>({
	service: "email",
	module: "administration-api",
	pluginId: "superboard-email",
	surface: "internal",
	access: "internal",
});

emailApiAdminRoutes.get(`${ADMIN_PREFIX}/settings/api-keys`, async ({ env: { env, context } }) => {
	const rows = await env.DB.prepare(
		"SELECT id, name, prefix, scopes_json, created_at, last_used_at FROM email_api_keys WHERE project_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50",
	)
		.bind(context.projectId)
		.all<{
			id: string;
			name: string;
			prefix: string;
			scopes_json: string;
			created_at: string;
			last_used_at: string | null;
		}>();
	return json({
		data: rows.results.map(({ scopes_json, ...row }) => ({
			...row,
			scopes: parseEvents(scopes_json),
		})),
	});
});

emailApiAdminRoutes.post(
	`${ADMIN_PREFIX}/settings/api-keys`,
	async ({ env: { env, context, body, commit } }) => {
		const name = text(body.name ?? "Server key", "name", 100);
		const active = await env.DB.prepare(
			"SELECT COUNT(*) AS total FROM email_api_keys WHERE project_id = ? AND revoked_at IS NULL",
		)
			.bind(context.projectId)
			.first<{ total: number }>();
		if (Number(active?.total ?? 0) >= MAX_ACTIVE_API_KEYS)
			return error(409, "api_key_limit_reached");
		const id = crypto.randomUUID();
		const { secret, prefix } = generateEmailApiKey();
		const createdAt = new Date().toISOString();
		const data = {
			id,
			name,
			prefix,
			scopes: [EMAIL_SEND_SCOPE],
			created_at: createdAt,
			last_used_at: null,
		};
		return commit({
			action: "api_key.created",
			resourceId: id,
			status: 201,
			// The plaintext key is returned once and never stored (not even in the idempotency log).
			data: { ...data, secret: null },
			response: { data: { ...data, secret } },
			statements: [
				env.DB.prepare(
					"INSERT INTO email_api_keys (id, project_id, name, prefix, key_hash, scopes_json, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
				).bind(
					id,
					context.projectId,
					name,
					prefix,
					await hashEmailApiKey(secret),
					JSON.stringify([EMAIL_SEND_SCOPE]),
					context.operatorId ?? String(context.actorId),
					createdAt,
				),
			],
		});
	},
);

emailApiAdminRoutes.delete(
	`${ADMIN_PREFIX}/settings/api-keys/:id`,
	async ({ params, env: { env, context, commit } }) => {
		const row = await env.DB.prepare(
			"SELECT id FROM email_api_keys WHERE id = ? AND project_id = ? AND revoked_at IS NULL",
		)
			.bind(params.id, context.projectId)
			.first<{ id: string }>();
		if (!row) return error(404, "api_key_not_found");
		return commit({
			action: "api_key.revoked",
			resourceId: row.id,
			data: { id: row.id, revoked: true },
			statements: [
				env.DB.prepare(
					"UPDATE email_api_keys SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL",
				).bind(new Date().toISOString(), row.id, context.projectId),
			],
		});
	},
);

emailApiAdminRoutes.get(
	`${ADMIN_PREFIX}/settings/event-webhooks`,
	async ({ env: { env, context } }) => {
		const rows = await env.DB.prepare(
			`SELECT w.id, w.url, w.description, w.events_json, w.secret_prefix, w.enabled, w.created_at, w.updated_at,
            (SELECT status FROM email_event_webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY d.created_at DESC LIMIT 1) AS last_status,
            (SELECT created_at FROM email_event_webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY d.created_at DESC LIMIT 1) AS last_delivery_at
     FROM email_event_webhooks w WHERE w.project_id = ? ORDER BY w.created_at, w.id`,
		)
			.bind(context.projectId)
			.all<Record<string, unknown> & { events_json: string; enabled: number }>();
		return json({
			data: rows.results.map(({ events_json, ...row }) => ({
				...row,
				events: parseEvents(events_json),
				enabled: row.enabled === 1,
			})),
			meta: { event_types: EMAIL_WEBHOOK_EVENT_TYPES },
		});
	},
);

emailApiAdminRoutes.post(
	`${ADMIN_PREFIX}/settings/event-webhooks`,
	async ({ env: { env, context, body, commit } }) => {
		const url = normalizeWebhookUrl(body.url);
		const events = normalizeWebhookEvents(body.events);
		const description = optionalText(body.description, 200);
		const count = await env.DB.prepare(
			"SELECT COUNT(*) AS total FROM email_event_webhooks WHERE project_id = ?",
		)
			.bind(context.projectId)
			.first<{ total: number }>();
		if (Number(count?.total ?? 0) >= MAX_EVENT_WEBHOOKS)
			return error(409, "event_webhook_limit_reached");
		const id = crypto.randomUUID();
		const secret = generateWebhookSecret();
		const secretPrefix = `${secret.slice(0, 12)}…`;
		const data = { id, url, description, events, enabled: true, secret_prefix: secretPrefix };
		return commit({
			action: "event_webhook.created",
			resourceId: id,
			status: 201,
			data: { ...data, secret: null },
			response: { data: { ...data, secret } },
			statements: [
				env.DB.prepare(
					"INSERT INTO email_event_webhooks (id, project_id, url, description, events_json, encrypted_secret, secret_prefix, enabled) VALUES (?,?,?,?,?,?,?,1)",
				).bind(
					id,
					context.projectId,
					url,
					description,
					JSON.stringify(events),
					await encryptWebhookSecret(env, secret),
					secretPrefix,
				),
			],
		});
	},
);

emailApiAdminRoutes.put(
	`${ADMIN_PREFIX}/settings/event-webhooks/:id`,
	async ({ params, env: { env, context, body, commit } }) => {
		const row = await ownedWebhook(env, context.projectId, params.id);
		if (!row) return error(404, "event_webhook_not_found");
		const url = body.url === undefined ? row.url : normalizeWebhookUrl(body.url);
		const events =
			body.events === undefined
				? parseEvents(row.events_json)
				: normalizeWebhookEvents(body.events);
		const enabled = body.enabled === undefined ? row.enabled === 1 : body.enabled === true;
		const description =
			body.description === undefined ? row.description : optionalText(body.description, 200);
		return commit({
			action: "event_webhook.updated",
			resourceId: row.id,
			data: { id: row.id, url, events, enabled, description },
			statements: [
				env.DB.prepare(
					"UPDATE email_event_webhooks SET url = ?, events_json = ?, enabled = ?, description = ?, updated_at = ? WHERE id = ? AND project_id = ?",
				).bind(
					url,
					JSON.stringify(events),
					enabled ? 1 : 0,
					description,
					new Date().toISOString(),
					row.id,
					context.projectId,
				),
			],
		});
	},
);

emailApiAdminRoutes.delete(
	`${ADMIN_PREFIX}/settings/event-webhooks/:id`,
	async ({ params, env: { env, context, commit } }) => {
		const row = await ownedWebhook(env, context.projectId, params.id);
		if (!row) return error(404, "event_webhook_not_found");
		return commit({
			action: "event_webhook.deleted",
			resourceId: row.id,
			data: { id: row.id, deleted: true },
			statements: [
				env.DB.prepare("DELETE FROM email_event_webhooks WHERE id = ? AND project_id = ?").bind(
					row.id,
					context.projectId,
				),
			],
		});
	},
);

emailApiAdminRoutes.post(
	`${ADMIN_PREFIX}/settings/event-webhooks/:id/test`,
	async ({ params, env: { env, context, commit } }) => {
		const row = await ownedWebhook(env, context.projectId, params.id);
		if (!row) return error(404, "event_webhook_not_found");
		const deliveryId = crypto.randomUUID();
		const eventId = `test_${crypto.randomUUID()}`;
		const now = new Date().toISOString();
		await env.DB.prepare(
			`INSERT INTO email_event_webhook_deliveries (id, webhook_id, project_id, event_id, event_type, payload_json, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'pending',?,?)`,
		)
			.bind(
				deliveryId,
				row.id,
				context.projectId,
				eventId,
				"test",
				JSON.stringify({
					id: `evt_${eventId.replace(/-/g, "")}`,
					type: "email.test",
					created_at: now,
					project_id: context.projectId,
					data: { message: "SuperBoard webhook test event" },
				}),
				now,
				now,
			)
			.run();
		const result = await deliverWebhook(env, deliveryId, { retry: false });
		return commit({
			action: "event_webhook.tested",
			resourceId: row.id,
			data: result,
			statements: [],
		});
	},
);

emailApiAdminRoutes.get(
	`${ADMIN_PREFIX}/settings/event-webhooks/:id/deliveries`,
	async ({ params, env: { env, context } }) => {
		const row = await ownedWebhook(env, context.projectId, params.id);
		if (!row) return error(404, "event_webhook_not_found");
		const rows = await env.DB.prepare(
			`SELECT id, event_id, event_type, status, attempt_count, response_status, last_error, next_attempt_at, created_at, delivered_at
     FROM email_event_webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
		)
			.bind(row.id)
			.all();
		return json({ data: rows.results });
	},
);

emailApiAdminRoutes.get(
	`${ADMIN_PREFIX}/settings/smtp/:id/authentication`,
	async ({ params, env: { env, context } }) => {
		const row = await authenticationProfile(env, context.projectId, params.id);
		if (!row) return error(404, "smtp_profile_not_found");
		return json({ data: authenticationView(env, row) });
	},
);

emailApiAdminRoutes.put(
	`${ADMIN_PREFIX}/settings/smtp/:id/authentication`,
	async ({ params, env: { env, context, body, commit } }) => {
		const row = await authenticationProfile(env, context.projectId, params.id);
		if (!row) return error(404, "smtp_profile_not_found");
		const fromEmail = profileFromEmail(row.public_config_json);
		const config = normalizeDomainAuthenticationConfig(body.config ?? body, fromEmail);
		const updated = {
			...row,
			authentication_config_json: JSON.stringify(config),
			dkim_selector: config.dkim_selector ?? null,
		};
		return commit({
			action: "smtp_profile.authentication_configured",
			resourceId: row.id,
			data: authenticationView(env, updated),
			statements: [
				env.DB.prepare(
					"UPDATE email_smtp_profiles SET authentication_config_json = ?, dkim_selector = ?, authentication_status = 'unverified', updated_at = ? WHERE id = ? AND project_id = ?",
				).bind(
					updated.authentication_config_json,
					updated.dkim_selector,
					new Date().toISOString(),
					row.id,
					context.projectId,
				),
			],
		});
	},
);

type AuthenticationProfileRow = {
	id: string;
	public_config_json: string;
	dkim_selector: string | null;
	authentication_status: string;
	authentication_config_json: string | null;
	authentication_report_json: string | null;
	authentication_checked_at: string | null;
};

export function profileAuthenticationConfig(row: object): DomainAuthenticationConfig {
	const configJson = "authentication_config_json" in row ? row.authentication_config_json : null;
	const selector = "dkim_selector" in row ? row.dkim_selector : null;
	const stored = jsonObject(
		typeof configJson === "string" ? configJson : null,
	) as DomainAuthenticationConfig;
	const legacySelector = typeof selector === "string" && selector ? selector : null;
	return {
		...stored,
		// The column is written by both the profile form and the wizard: it wins.
		dkim_selector: legacySelector ?? stored.dkim_selector ?? null,
		dkim_tokens: Array.isArray(stored.dkim_tokens) ? stored.dkim_tokens : [],
	};
}

function authenticationView(env: Env, row: AuthenticationProfileRow) {
	const fromEmail = profileFromEmail(row.public_config_json);
	const provider = env.MAIL_PROVIDER === "aws-ses" ? "aws-ses" : "smtp";
	const config = profileAuthenticationConfig(row);
	return {
		profile_id: row.id,
		domain: fromEmail.split("@")[1] ?? "",
		provider,
		aws_region: provider === "aws-ses" ? env.AWS_REGION || null : null,
		config,
		records: expectedDnsRecords({
			fromAddress: fromEmail,
			provider,
			awsRegion: env.AWS_REGION,
			config,
		}),
		status: row.authentication_status,
		checked_at: row.authentication_checked_at,
		report: row.authentication_report_json ? jsonObject(row.authentication_report_json) : null,
	};
}

async function authenticationProfile(env: Env, projectId: number, id: string) {
	return env.DB.prepare(
		"SELECT id, public_config_json, dkim_selector, authentication_status, authentication_config_json, authentication_report_json, authentication_checked_at FROM email_smtp_profiles WHERE id = ? AND project_id = ?",
	)
		.bind(id, projectId)
		.first<AuthenticationProfileRow>();
}

async function ownedWebhook(env: Env, projectId: number, id: string) {
	return env.DB.prepare(
		"SELECT id, url, description, events_json, enabled FROM email_event_webhooks WHERE id = ? AND project_id = ?",
	)
		.bind(id, projectId)
		.first<{
			id: string;
			url: string;
			description: string | null;
			events_json: string;
			enabled: number;
		}>();
}

function text(value: unknown, name: string, limit: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > limit || /[\r\n]/.test(value))
		throw Object.assign(new Error("invalid value"), { status: 422, code: `${name}_invalid` });
	return value.trim();
}

function optionalText(value: unknown, limit: number): string | null {
	if (value == null || value === "") return null;
	return text(value, "description", limit);
}

function jsonObject(value: string | null | undefined): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(value ?? "{}");
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function profileFromEmail(publicConfigJson: string): string {
	const fromEmail = jsonObject(publicConfigJson).from_email;
	return typeof fromEmail === "string" ? fromEmail : "";
}

function json(value: unknown, status = 200) {
	return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status: number, code: string) {
	return json({ error: { code } }, status);
}
