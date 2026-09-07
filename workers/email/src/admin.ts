import type { EmailSmtpPublicConfig, EmailSmtpSecretConfig } from "@superboard/contracts/email";
import {
	verifyInternalProjectContextRequest,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import { configuredSecrets, constantTimeEqual } from "@superboard/contracts/secret";

import { encryptJson, decryptJson, sha256 } from "./admin-secrets.js";
import { verifyEmailAuthentication } from "./sender-authentication.js";
import {
	normalizeEmail,
	parseEmailSmtpTransportRequest,
	EmailValidationError,
} from "./validation.js";

export type EmailAdminEnv = Env & { EMAIL_SMTP_ENCRYPTION_KEY?: string };
export interface EmailSenderSnapshot {
	id: string;
	publicConfig: EmailSmtpPublicConfig;
	encrypted_config: string;
	hourly_quota?: number | null;
	daily_quota?: number | null;
}
interface ProfileRow extends Record<string, unknown> {
	id: string;
	project_id: number;
	public_config_json: string;
	encrypted_config: string;
}
interface RuntimeOperations {
	enqueue(request: Request, env: Env, sender?: EmailSenderSnapshot): Promise<Response>;
	smtp(request: Request, env: Env): Promise<Response>;
	replayDeadLetter(env: Env, id: string): Promise<Response>;
	discardDeadLetter(env: Env, id: string): Promise<Response>;
}
interface AdminMutation {
	action: string;
	resourceId: string;
	statements: D1PreparedStatement[];
	data: unknown;
	status?: number;
}
const ADMIN_PREFIX = "/internal/v1/admin";
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export async function handleEmailAdmin(
	request: Request,
	env: EmailAdminEnv,
	operations: RuntimeOperations,
): Promise<Response> {
	const verified = await verifyInternalProjectContextRequest(
		request,
		configuredSecrets(env.EMAIL_INTERNAL_TOKEN, env.EMAIL_INTERNAL_TOKEN_PREVIOUS),
		"email",
	);
	if (!verified.ok) return error(401, verified.code);
	const context = verified.context;
	if (!["owner", "admin"].includes(context.role)) return error(403, "administrator_required");
	const url = new URL(request.url);
	const path = url.pathname.slice(ADMIN_PREFIX.length) || "/";
	try {
		const mutating = !["GET", "HEAD"].includes(request.method);
		const operationKey = request.headers.get("Idempotency-Key") ?? "";
		if (mutating && !TOKEN_PATTERN.test(operationKey))
			return error(400, "idempotency_key_required");
		const body = mutating && request.body ? await readJsonObjectLimited(request, 600_000) : {};
		const requestHash = mutating
			? await sha256(`${request.method} ${path}\n${JSON.stringify(body)}`)
			: "";
		if (mutating) {
			const replay = await env.DB.prepare(
				"SELECT request_sha256, response_json, response_status FROM email_admin_operations WHERE project_id = ? AND operation_key = ?",
			)
				.bind(context.projectId, operationKey)
				.first<{ request_sha256: string; response_json: string; response_status: number }>();
			if (replay)
				return replay.request_sha256 === requestHash
					? new Response(replay.response_json, {
							status: replay.response_status,
							headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
						})
					: error(409, "idempotency_conflict");
		}
		const commit = async (mutation: AdminMutation) => {
			const status = mutation.status ?? 200;
			const result = { data: mutation.data };
			await env.DB.batch([
				env.DB.prepare(
					"INSERT INTO email_admin_operations (project_id, operation_key, request_sha256, response_json, response_status) VALUES (?, ?, ?, ?, ?)",
				).bind(context.projectId, operationKey, requestHash, JSON.stringify(result), status),
				...mutation.statements,
				env.DB.prepare(
					"INSERT INTO email_admin_audit_events (id, project_id, operator_id, action, resource_id, request_id) VALUES (?, ?, ?, ?, ?, ?)",
				).bind(
					crypto.randomUUID(),
					context.projectId,
					context.operatorId ?? String(context.actorId),
					mutation.action,
					mutation.resourceId,
					context.requestId,
				),
			]);
			return json(result, status);
		};
		if (path === "/migration/smtp-profiles" && request.method === "POST") {
			if (!Array.isArray(body.profiles) || body.profiles.length > 100)
				return error(422, "profile_import_invalid");
			const mutations: AdminMutation[] = [];
			for (const raw of body.profiles) {
				if (!raw || typeof raw !== "object" || !(raw as Record<string, unknown>).id)
					return error(422, "profile_import_invalid");
				const profile = raw as Record<string, unknown>;
				const existing = await env.DB.prepare(
					"SELECT project_id FROM email_smtp_profiles WHERE id = ?",
				)
					.bind(profile.id)
					.first<{ project_id: number }>();
				if (existing) {
					const imported = await env.DB.prepare(
						"SELECT source_id FROM email_administration_imports WHERE project_id = ? AND source = 'marketing' AND source_id = ?",
					)
						.bind(context.projectId, profile.id)
						.first();
					if (existing.project_id !== context.projectId || !imported)
						return error(409, "profile_import_conflict");
					continue;
				}
				mutations.push(await saveProfile(env, context, profile, true));
			}
			return commit({
				action: "smtp_profiles.imported",
				resourceId: "marketing",
				data: { imported: mutations.length },
				statements: mutations.flatMap((mutation) => [
					...mutation.statements,
					env.DB.prepare(
						"INSERT INTO email_administration_imports (project_id,source,source_id) VALUES (?,'marketing',?) ON CONFLICT DO NOTHING",
					).bind(context.projectId, mutation.resourceId),
				]),
			});
		}
		if (path === "/settings/smtp" && request.method === "GET") {
			const rows = await env.DB.prepare(
				"SELECT * FROM email_smtp_profiles WHERE project_id = ? ORDER BY priority, created_at, id",
			)
				.bind(context.projectId)
				.all<ProfileRow>();
			const profiles = rows.results.map(serializeProfile);
			return json({
				data:
					profiles.length === 1
						? {
								...profiles[0],
								provider: env.MAIL_PROVIDER,
								aws_region: env.MAIL_PROVIDER === "aws-ses" ? env.AWS_REGION : null,
							}
						: { profiles, configured: profiles.length > 0, provider: env.MAIL_PROVIDER },
			});
		}
		if (path === "/settings/smtp" && ["PUT", "POST"].includes(request.method))
			return commit(await saveProfile(env, context, body));
		const profilePath = /^\/settings\/smtp\/([^/]+)$/.exec(path);
		if (profilePath && request.method === "DELETE") {
			const row = await loadProfile(env, context.projectId, profilePath[1]);
			if (!row) return error(404, "smtp_profile_not_found");
			return commit({
				action: "smtp_profile.deleted",
				resourceId: row.id,
				data: { deleted: true },
				statements: [
					env.DB.prepare("DELETE FROM email_smtp_profiles WHERE id = ? AND project_id = ?").bind(
						row.id,
						context.projectId,
					),
				],
			});
		}
		const verification = /^\/settings\/smtp\/([^/]+)\/verify-domain$/.exec(path);
		if (verification && request.method === "POST") {
			const row = await loadProfile(env, context.projectId, verification[1]);
			if (!row) return error(404, "smtp_profile_not_found");
			const configuration = JSON.parse(row.public_config_json) as EmailSmtpPublicConfig;
			let result: Awaited<ReturnType<typeof verifyEmailAuthentication>>;
			try {
				result = await verifyEmailAuthentication(
					configuration.from_email,
					typeof row.dkim_selector === "string" ? row.dkim_selector : null,
				);
			} catch {
				await env.DB.prepare(
					"UPDATE email_smtp_profiles SET authentication_status = 'failed', authentication_checked_at = ? WHERE id = ? AND project_id = ?",
				)
					.bind(new Date().toISOString(), row.id, context.projectId)
					.run();
				return error(503, "sender_authentication_check_failed");
			}
			return commit({
				action: "smtp_profile.domain_verified",
				resourceId: row.id,
				data: result,
				statements: [
					env.DB.prepare(
						"UPDATE email_smtp_profiles SET authentication_status = ?, spf_status = ?, dkim_status = ?, dmarc_status = ?, authentication_checked_at = ?, updated_at = ? WHERE id = ? AND project_id = ?",
					).bind(
						result.ready ? "verified" : "failed",
						result.spf,
						result.dkim,
						result.dmarc,
						result.checkedAt,
						result.checkedAt,
						row.id,
						context.projectId,
					),
				],
			});
		}
		if (
			(path === "/transactional" || path === "/settings/smtp/test") &&
			request.method === "POST"
		) {
			const row = await loadProfile(
				env,
				context.projectId,
				String(body.smtp_profile_id ?? body.profile_id ?? ""),
				path === "/transactional",
			);
			if (row?.enabled === 0 && path === "/transactional")
				return error(409, "smtp_profile_disabled");
			const sender = row ? senderSnapshot(row) : undefined;
			const key = `email-admin:${await sha256(`${context.projectId}:${operationKey}`)}`;
			if (path.endsWith("/test")) {
				if (!sender) return error(404, "smtp_profile_not_found");
				const response = await operations.smtp(
					internalRequest("/internal/v1/transport/smtp", env, {
						idempotencyKey: key,
						source: "email-admin",
						projectId: context.projectId,
						referenceId: sender.id,
						profileId: sender.id,
						publicConfig: sender.publicConfig,
						secret: await decryptJson<EmailSmtpSecretConfig>(
							encryptionKey(env),
							sender.encrypted_config,
						),
						message: {
							to: normalizeEmail(body.recipient ?? sender.publicConfig.from_email),
							subject: "SuperBoard SMTP connection test",
							text: "SMTP connection test",
							html: null,
						},
					}),
					env,
				);
				if (!response.ok) {
					await env.DB.prepare(
						"UPDATE email_smtp_profiles SET last_tested_at = ?, last_test_status = 'failed' WHERE id = ? AND project_id = ?",
					)
						.bind(new Date().toISOString(), sender.id, context.projectId)
						.run();
					return response;
				}
				let receipt: unknown;
				try {
					receipt = await readJsonObjectLimited(response, 32768);
				} catch (cause) {
					if (cause instanceof RequestBodyError) return error(503, "smtp_response_invalid");
					throw cause;
				}
				return commit({
					action: "smtp_profile.tested",
					resourceId: sender.id,
					data: receipt,
					statements: [
						env.DB.prepare(
							"UPDATE email_smtp_profiles SET last_tested_at = ?, last_test_status = 'sent' WHERE id = ? AND project_id = ?",
						).bind(new Date().toISOString(), sender.id, context.projectId),
					],
				});
			}
			if (body.template_id && !body.subject) return error(422, "transactional_content_required");
			return operations.enqueue(
				internalRequest("/internal/v1/messages", env, {
					to: body.to ?? body.recipient,
					subject: body.subject,
					text: body.text ?? body.content_text,
					html: body.html ?? body.content_html,
					kind: "transactional",
					projectId: context.projectId,
					idempotencyKey: key,
					replyTo: body.reply_to,
					templateKey: body.template_id ?? null,
					metadata: { operator_id: context.operatorId ?? String(context.actorId) },
				}),
				env,
				sender,
			);
		}
		if (path === "/settings/delivery-outbox" && request.method === "GET") {
			const rows = await env.DB.prepare(
				"SELECT id, subject, kind AS job_type, status, last_error, created_at, updated_at, sent_at AS completed_at FROM email_messages WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 500",
			)
				.bind(context.projectId)
				.all();
			return json({ data: rows.results });
		}
		const retry = /^\/settings\/delivery-outbox\/([^/]+)\/retry$/.exec(path);
		if (retry && request.method === "POST") {
			const row = await env.DB.prepare(
				"SELECT id FROM email_messages WHERE project_id = ? AND id = ? AND status IN ('queued','failed')",
			)
				.bind(context.projectId, retry[1])
				.first<{ id: string }>();
			if (!row) return error(409, "outbox_not_retryable");
			await env.EMAIL_QUEUE.send({ type: "email.deliver", messageId: row.id });
			return commit({
				action: "delivery.retried",
				resourceId: row.id,
				data: { queued: true },
				status: 202,
				statements: [],
			});
		}
		if (path === "/settings/dead-letters" && request.method === "GET") {
			const rows = await env.DB.prepare(
				"SELECT d.id,d.source_queue,d.message_id AS queue_message_id,d.job_type,d.replayable,d.attempts,d.status,d.resolution,d.received_at,d.resolved_at,m.id AS resource_id FROM email_dead_letters d JOIN email_messages m ON m.id = json_extract(d.payload_json, '$.messageId') WHERE m.project_id = ? ORDER BY d.received_at DESC,d.id DESC LIMIT 100",
			)
				.bind(context.projectId)
				.all();
			return json({
				data: rows.results.map((row) => ({ ...row, replayable: row.replayable === 1 })),
			});
		}
		const dead = /^\/settings\/dead-letters\/([^/]+)\/(replay|discard)$/.exec(path);
		if (dead && request.method === "POST") {
			const row = await env.DB.prepare(
				"SELECT d.id FROM email_dead_letters d JOIN email_messages m ON m.id = json_extract(d.payload_json, '$.messageId') WHERE d.id = ? AND m.project_id = ?",
			)
				.bind(dead[1], context.projectId)
				.first<{ id: string }>();
			if (!row) return error(404, "dead_letter_not_found");
			return dead[2] === "replay"
				? operations.replayDeadLetter(env, row.id)
				: operations.discardDeadLetter(env, row.id);
		}
		if (path === "/provider-events" && request.method === "GET") {
			const rows = await env.DB.prepare(
				"SELECT id,provider,source,reference_id,provider_message_id,event_type,occurred_at,metadata_json FROM email_provider_events WHERE project_id = ? UNION ALL SELECT id,provider,endpoint_id AS source,delivery_id AS reference_id,provider_event_id AS provider_message_id,event_type,occurred_at,metadata_json FROM email_webhook_events WHERE project_id = ? ORDER BY occurred_at DESC,id DESC LIMIT 100",
			)
				.bind(context.projectId, context.projectId)
				.all();
			return json({ data: rows.results });
		}
		const webhookDeletion = /^\/settings\/provider-webhooks\/([^/]+)$/.exec(path);
		if (webhookDeletion && request.method === "DELETE") {
			const row = await env.DB.prepare(
				"SELECT id FROM email_webhook_endpoints WHERE id = ? AND project_id = ?",
			)
				.bind(webhookDeletion[1], context.projectId)
				.first<{ id: string }>();
			if (!row) return error(404, "provider_webhook_not_found");
			return commit({
				action: "provider_webhook.deleted",
				resourceId: row.id,
				data: { deleted: true },
				statements: [
					env.DB.prepare(
						"DELETE FROM email_webhook_endpoints WHERE id = ? AND project_id = ?",
					).bind(row.id, context.projectId),
				],
			});
		}
		if (path === "/settings/provider-webhooks" && request.method === "GET") {
			const rows = await env.DB.prepare(
				"SELECT id,provider,enabled,created_at,updated_at FROM email_webhook_endpoints WHERE project_id = ? ORDER BY created_at,id",
			)
				.bind(context.projectId)
				.all();
			return json({ data: rows.results });
		}
		if (path === "/settings/provider-webhooks" && request.method === "POST") {
			const id = crypto.randomUUID();
			const provider = requiredText(body.provider, "provider", 64);
			return commit({
				action: "provider_webhook.created",
				resourceId: id,
				status: 201,
				data: { id, provider, enabled: body.enabled !== false, configured: true },
				statements: [
					env.DB.prepare(
						"INSERT INTO email_webhook_endpoints (id,project_id,provider,encrypted_secret,enabled) VALUES (?,?,?,?,?)",
					).bind(
						id,
						context.projectId,
						provider,
						await encryptJson(encryptionKey(env), {
							secret: requiredText(body.secret, "secret", 8000),
						}),
						body.enabled === false ? 0 : 1,
					),
				],
			});
		}
		return error(404, "route_not_found");
	} catch (cause) {
		if (cause instanceof RequestBodyError) return error(cause.status, cause.code);
		if (cause instanceof EmailValidationError) return error(422, cause.code);
		const failure = cause as { code?: string; status?: number };
		return error(failure.status ?? 503, failure.code ?? "email_administration_unavailable");
	}
}

async function saveProfile(
	env: EmailAdminEnv,
	context: InternalProjectContext,
	body: Record<string, unknown>,
	importing = false,
): Promise<AdminMutation> {
	const existing = await loadProfile(
		env,
		context.projectId,
		typeof body.id === "string" ? body.id : "",
	);
	const id =
		typeof body.id === "string" && body.id ? body.id : (existing?.id ?? crypto.randomUUID());
	const foreign = await env.DB.prepare("SELECT project_id FROM email_smtp_profiles WHERE id = ?")
		.bind(id)
		.first<{ project_id: number }>();
	if (foreign && foreign.project_id !== context.projectId)
		throw Object.assign(new Error("profile conflict"), {
			status: 409,
			code: "smtp_profile_conflict",
		});
	const managed = env.MAIL_PROVIDER === "aws-ses";
	const oldSecret = existing
		? await decryptJson<EmailSmtpSecretConfig>(encryptionKey(env), existing.encrypted_config)
		: { password: null };
	const password = managed
		? null
		: body.password === undefined
			? oldSecret.password
			: String(body.password);
	const input = parseEmailSmtpTransportRequest(
		{
			idempotencyKey: "profile-validation",
			source: "email",
			projectId: context.projectId,
			referenceId: id,
			profileId: id,
			publicConfig: {
				host: managed
					? `email-smtp.${env.AWS_REGION}.amazonaws.com${String(env.AWS_REGION).startsWith("cn-") ? ".cn" : ""}`
					: body.host,
				port: managed ? 587 : (body.port ?? 587),
				security: managed ? "starttls" : (body.security ?? "starttls"),
				username: managed ? null : (body.username ?? null),
				from_email: body.from_email,
				from_name: body.from_name ?? null,
				reply_to: body.reply_to ?? null,
			},
			secret: { password },
			message: { to: body.from_email, subject: "profile validation", text: "profile validation" },
		},
		env.ENVIRONMENT,
	);
	const publicConfig = input.publicConfig;
	const encrypted = await encryptJson(encryptionKey(env), { password });
	const selector = body.dkim_selector;
	if (
		selector != null &&
		(typeof selector !== "string" || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(selector))
	)
		throw Object.assign(new Error("invalid selector"), {
			status: 422,
			code: "dkim_selector_invalid",
		});
	const createdAt =
		importing && typeof body.created_at === "string" && Number.isFinite(Date.parse(body.created_at))
			? body.created_at
			: new Date().toISOString();
	const updatedAt =
		importing && typeof body.updated_at === "string" && Number.isFinite(Date.parse(body.updated_at))
			? body.updated_at
			: new Date().toISOString();
	const row = {
		id,
		created_at: createdAt,
		updated_at: updatedAt,
		name: requiredText(body.name ?? "Default", "name", 255),
		public_config_json: JSON.stringify(publicConfig),
		priority: integer(body.priority, 100),
		enabled: body.enabled === false || body.enabled === 0 ? 0 : 1,
		hourly_quota: body.hourly_quota == null ? null : integer(body.hourly_quota, 0),
		daily_quota: body.daily_quota == null ? null : integer(body.daily_quota, 0),
		dkim_selector:
			body.dkim_selector == null ? null : requiredText(body.dkim_selector, "dkim_selector", 63),
		authentication_status: "unverified",
	};
	return {
		action: "smtp_profile.saved",
		resourceId: id,
		data: {
			...row,
			...publicConfig,
			configured: true,
			enabled: row.enabled === 1,
			public_config_json: undefined,
		},
		statements: [
			env.DB.prepare(
				"INSERT INTO email_smtp_profiles (id,project_id,name,encrypted_config,public_config_json,priority,enabled,hourly_quota,daily_quota,dkim_selector,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,encrypted_config=excluded.encrypted_config,public_config_json=excluded.public_config_json,priority=excluded.priority,enabled=excluded.enabled,hourly_quota=excluded.hourly_quota,daily_quota=excluded.daily_quota,dkim_selector=excluded.dkim_selector,authentication_status='unverified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
			).bind(
				id,
				context.projectId,
				row.name,
				encrypted,
				row.public_config_json,
				row.priority,
				row.enabled,
				row.hourly_quota,
				row.daily_quota,
				row.dkim_selector,
				row.created_at,
				row.updated_at,
			),
		],
	};
}
export async function loadProfile(
	env: EmailAdminEnv,
	projectId: number,
	id: string,
	enabledOnly = false,
): Promise<ProfileRow | null> {
	return id
		? env.DB.prepare("SELECT * FROM email_smtp_profiles WHERE id = ? AND project_id = ?")
				.bind(id, projectId)
				.first<ProfileRow>()
		: env.DB.prepare(
				"SELECT * FROM email_smtp_profiles WHERE project_id = ? AND (? = 0 OR enabled = 1) ORDER BY priority,created_at,id LIMIT 1",
			)
				.bind(projectId, enabledOnly ? 1 : 0)
				.first<ProfileRow>();
}
export function senderSnapshot(row: ProfileRow): EmailSenderSnapshot {
	return {
		id: row.id,
		publicConfig: JSON.parse(row.public_config_json) as EmailSmtpPublicConfig,
		encrypted_config: row.encrypted_config,
		hourly_quota: typeof row.hourly_quota === "number" ? row.hourly_quota : null,
		daily_quota: typeof row.daily_quota === "number" ? row.daily_quota : null,
	};
}
export async function decryptEmailSender(
	env: EmailAdminEnv,
	snapshot: EmailSenderSnapshot,
): Promise<EmailSmtpSecretConfig> {
	return decryptJson<EmailSmtpSecretConfig>(encryptionKey(env), snapshot.encrypted_config);
}
function serializeProfile(row: ProfileRow) {
	const { encrypted_config, public_config_json, ...safe } = row;
	return {
		...safe,
		...(JSON.parse(public_config_json) as EmailSmtpPublicConfig),
		configured: Boolean(encrypted_config),
		enabled: row.enabled === 1,
	};
}
function encryptionKey(env: EmailAdminEnv): string {
	if (!env.EMAIL_SMTP_ENCRYPTION_KEY)
		throw Object.assign(new Error("encryption unavailable"), {
			status: 503,
			code: "email_encryption_unavailable",
		});
	return env.EMAIL_SMTP_ENCRYPTION_KEY;
}
function requiredText(value: unknown, name: string, limit: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > limit)
		throw Object.assign(new Error("invalid value"), { status: 422, code: `${name}_invalid` });
	return value.trim();
}
function integer(value: unknown, fallback: number): number {
	if (value == null) return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0)
		throw Object.assign(new Error("invalid integer"), { status: 422, code: "integer_invalid" });
	return parsed;
}
function internalRequest(path: string, env: Env, body: unknown): Request {
	return new Request(`https://email.internal${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-internal-token": env.EMAIL_INTERNAL_TOKEN },
		body: JSON.stringify(body),
	});
}
function json(value: unknown, status = 200) {
	return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
function error(status: number, code: string) {
	return json({ error: { code } }, status);
}

export async function resolveOwnedDelegatedSender(
	value: unknown,
	env: EmailAdminEnv,
): Promise<unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const input = value as Record<string, unknown>;
	if (
		input.source !== "marketing" ||
		typeof input.profileId !== "string" ||
		!Number.isSafeInteger(input.projectId)
	)
		return value;
	const row = await loadProfile(env, Number(input.projectId), input.profileId);
	if (!row) return value;
	if (row.enabled !== 1)
		throw Object.assign(new Error("profile disabled"), {
			status: 409,
			code: "smtp_profile_disabled",
		});
	const snapshot = senderSnapshot(row);
	return {
		...input,
		publicConfig: snapshot.publicConfig,
		secret: await decryptEmailSender(env, snapshot),
	};
}

export async function receiveEmailProviderWebhook(
	request: Request,
	env: EmailAdminEnv,
): Promise<Response> {
	try {
		const endpointId = new URL(request.url).pathname.split("/").at(-1) ?? "";
		const endpoint = await env.DB.prepare(
			"SELECT id,project_id,provider,encrypted_secret FROM email_webhook_endpoints WHERE id = ? AND enabled = 1",
		)
			.bind(endpointId)
			.first<{ id: string; project_id: number; provider: string; encrypted_secret: string }>();
		if (!endpoint) return error(404, "provider_webhook_not_found");
		const secret = await decryptJson<{ secret: string }>(
			encryptionKey(env),
			endpoint.encrypted_secret,
		);
		if (!(await constantTimeEqual(request.headers.get("x-webhook-secret") ?? "", secret.secret)))
			return error(401, "provider_webhook_signature_invalid");
		const body = await readJsonObjectLimited(request, 64_000);
		const eventType = requiredText(body.event_type, "event_type", 32);
		if (
			!new Set([
				"delivered",
				"soft_bounce",
				"hard_bounce",
				"complaint",
				"delivery_delayed",
				"rejected",
			]).has(eventType)
		)
			return error(422, "event_type_invalid");
		const delivery = await env.DB.prepare(
			"SELECT d.id FROM email_deliveries d JOIN email_messages m ON m.id = d.message_id WHERE m.project_id = ? AND (d.id = ? OR d.provider_message_id = ?) LIMIT 1",
		)
			.bind(
				endpoint.project_id,
				typeof body.delivery_id === "string" ? body.delivery_id : "",
				typeof body.provider_message_id === "string" ? body.provider_message_id : "",
			)
			.first<{ id: string }>();
		if (!delivery) return error(404, "delivery_not_found");
		const eventKey =
			typeof body.provider_event_id === "string"
				? requiredText(body.provider_event_id, "provider_event_id", 255)
				: await sha256(JSON.stringify(body));
		const occurredAt =
			typeof body.occurred_at === "string" && Number.isFinite(Date.parse(body.occurred_at))
				? body.occurred_at
				: new Date().toISOString();
		const existing = await env.DB.prepare(
			"SELECT id FROM email_webhook_events WHERE project_id = ? AND provider = ? AND provider_event_id = ?",
		)
			.bind(endpoint.project_id, endpoint.provider, eventKey)
			.first();
		if (existing) return json({ data: { accepted: true, duplicate: true } }, 202);
		const id = crypto.randomUUID();
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO email_webhook_events (id,project_id,endpoint_id,provider,provider_event_id,delivery_id,event_type,occurred_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,provider,provider_event_id) DO NOTHING",
			).bind(
				id,
				endpoint.project_id,
				endpoint.id,
				endpoint.provider,
				eventKey,
				delivery.id,
				eventType,
				occurredAt,
				JSON.stringify(body.metadata ?? {}),
			),
			env.DB.prepare(
				"UPDATE email_deliveries SET provider_status = ?,provider_event_at = ? WHERE id = ? AND (provider_event_at IS NULL OR provider_event_at <= ?) AND EXISTS (SELECT 1 FROM email_webhook_events WHERE id = ?)",
			).bind(eventType, occurredAt, delivery.id, occurredAt, id),
		]);
		return json({ data: { accepted: true } }, 202);
	} catch (cause) {
		if (cause instanceof RequestBodyError) return error(cause.status, cause.code);
		return error(503, "provider_webhook_unavailable");
	}
}
