import { resolveEmailMessage, type EmailDesign } from "@superboard/contracts/email-studio";
import {
	RequestBodyError,
	readJsonLimited,
	readJsonObjectLimited,
} from "@superboard/contracts/request-body";
import { createFetchRouter } from "@superboard/contracts/route-registry";
import { configuredSecrets, matchesAnySecret } from "@superboard/contracts/secret";
import {
	EMAIL_ATTACHMENTS_MAX_BYTES,
	EMAIL_ATTACHMENTS_MAX_COUNT,
	EmailTransportError,
	normalizeAttachments,
} from "@superboard/email-transport";

import { sha256 } from "./admin-secrets.js";
import { QUEUE_MAX_DELAY_SECONDS, emailQueue, randomHex, recordEmailEvent } from "./events.js";
import { EmailValidationError, normalizeEmail } from "./validation.js";

/** Server API keys start with this prefix; only their SHA-256 digest is stored. */
const EMAIL_API_KEY_PREFIX = "sb_email_";
const EMAIL_API_KEY_HEADER = "x-superboard-email-key";
export const EMAIL_SEND_SCOPE = "email:send";
/** Request body limit: 10 MB of attachments grow by a third when base64 encoded. */
const PUBLIC_SEND_BODY_LIMIT = 15 * 1024 * 1024;
const API_RATE_LIMIT_PER_MINUTE = 300;
const SCHEDULE_MAX_SECONDS = 7 * 24 * 3_600;
const ATTACHMENT_CHUNK_CHARACTERS = 1_000_000;
const MAX_RECIPIENTS = 50;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,200}$/;
const TEMPLATE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const TAG = /^[A-Za-z0-9_-]{1,64}$/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const RESERVED_HEADERS = new Set([
	"authentication-results",
	"bcc",
	"cc",
	"content-disposition",
	"content-id",
	"content-transfer-encoding",
	"content-type",
	"date",
	"dkim-signature",
	"from",
	"message-id",
	"mime-version",
	"received",
	"reply-to",
	"return-path",
	"sender",
	"subject",
	"to",
]);
const BLOCKED_EXTENSIONS = new Set([
	"ade",
	"adp",
	"apk",
	"appx",
	"bat",
	"chm",
	"cmd",
	"com",
	"cpl",
	"dll",
	"dmg",
	"exe",
	"hta",
	"ins",
	"iso",
	"isp",
	"jar",
	"js",
	"jse",
	"lib",
	"lnk",
	"mde",
	"msc",
	"msi",
	"msix",
	"msp",
	"mst",
	"nsh",
	"pif",
	"ps1",
	"scr",
	"sct",
	"shb",
	"sys",
	"vb",
	"vbe",
	"vbs",
	"vxd",
	"wsc",
	"wsf",
	"wsh",
]);

type PublicEnv = Env & { EMAIL_SMTP_ENCRYPTION_KEY?: string };
type AuthenticatedKey = { id: string; projectId: number };
type PublicAttachment = {
	filename: string;
	contentType: string;
	content: string;
	contentId: string | null;
	disposition: "attachment" | "inline";
	size: number;
};
type PublicSendInput = {
	to: string[];
	from: { email: string; name: string | null };
	subject: string | null;
	html: string | null;
	text: string | null;
	templateId: string | null;
	variables: Record<string, unknown>;
	locale: string | null;
	replyTo: string | null;
	headers: Record<string, string>;
	tags: string[];
	metadata: Record<string, unknown>;
	attachments: PublicAttachment[];
	idempotencyKey: string | null;
	scheduledAt: string | null;
};

export const emailPublicRoutes = createFetchRouter<PublicEnv>({
	service: "email",
	module: "public-api",
	pluginId: "superboard-email",
	surface: "internal",
	access: "internal",
});
emailPublicRoutes.post("/internal/v1/public/send", ({ request, env }) =>
	handle(request, env, publicSend),
);
emailPublicRoutes.get("/internal/v1/public/messages/:id", ({ request, env, params }) =>
	handle(request, env, (key) => readPublicMessage(env, key, params.id)),
);
emailPublicRoutes.post("/internal/v1/public/messages/:id/cancel", ({ request, env, params }) =>
	handle(request, env, (key) => cancelPublicMessage(env, key, params.id)),
);

export function generateEmailApiKey(): { secret: string; prefix: string } {
	const secret = `${EMAIL_API_KEY_PREFIX}${randomHex(32)}`;
	return { secret, prefix: secret.slice(0, EMAIL_API_KEY_PREFIX.length + 8) };
}

export async function hashEmailApiKey(secret: string): Promise<string> {
	return sha256(`superboard-email-api-key:v1:${secret}`);
}

async function handle(
	request: Request,
	env: PublicEnv,
	action: (key: AuthenticatedKey, request: Request, env: PublicEnv) => Promise<Response>,
): Promise<Response> {
	if (
		!(await matchesAnySecret(
			request.headers.get("x-internal-token") ?? "",
			configuredSecrets(env.EMAIL_INTERNAL_TOKEN, env.EMAIL_INTERNAL_TOKEN_PREVIOUS),
		))
	)
		return failure(401, "unauthorized", "Internal authentication is required");
	try {
		const key = await authenticateApiKey(env, request.headers.get(EMAIL_API_KEY_HEADER) ?? "");
		if (!key) return failure(401, "api_key_invalid", "The API key is missing, revoked or invalid");
		const limited = await consumeRateLimit(env, key.projectId);
		if (limited) return limited;
		return await action(key, request, env);
	} catch (error) {
		if (error instanceof RequestBodyError) return failure(error.status, error.code, error.message);
		if (error instanceof EmailValidationError) return failure(422, error.code, error.message);
		if (error instanceof EmailTransportError) return failure(422, error.code, error.message);
		const known = knownProblem(error);
		if (known) return failure(known.status, known.code, known.message, known.details);
		console.error(
			JSON.stringify({
				event: "email_public_api_failed",
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		return failure(
			503,
			"email_api_unavailable",
			"The email API is temporarily unavailable",
			undefined,
			true,
		);
	}
}

async function authenticateApiKey(
	env: Pick<Env, "DB">,
	secret: string,
): Promise<AuthenticatedKey | null> {
	const value = secret.trim();
	if (!value.startsWith(EMAIL_API_KEY_PREFIX) || !/^sb_email_[a-f0-9]{64}$/.test(value))
		return null;
	const row = await env.DB.prepare(
		"SELECT id, project_id, scopes_json, last_used_at FROM email_api_keys WHERE key_hash = ? AND revoked_at IS NULL",
	)
		.bind(await hashEmailApiKey(value))
		.first<{ id: string; project_id: number; scopes_json: string; last_used_at: string | null }>();
	if (!row || !jsonArray(row.scopes_json).includes(EMAIL_SEND_SCOPE)) return null;
	const now = new Date();
	if (!row.last_used_at || Date.parse(row.last_used_at) < now.getTime() - 300_000)
		await env.DB.prepare("UPDATE email_api_keys SET last_used_at = ? WHERE id = ?")
			.bind(now.toISOString(), row.id)
			.run();
	return { id: row.id, projectId: Number(row.project_id) };
}

/** Fixed one-minute window per project; returns a 429 response once exceeded. */
export async function consumeRateLimit(
	env: Pick<Env, "DB">,
	projectId: number,
	limit = API_RATE_LIMIT_PER_MINUTE,
	now = Date.now(),
): Promise<Response | null> {
	const window = Math.floor(now / 60_000);
	const row = await env.DB.prepare(
		`INSERT INTO email_api_rate_windows (project_id, window_start, request_count) VALUES (?, ?, 1)
     ON CONFLICT(project_id, window_start) DO UPDATE SET request_count = request_count + 1
     RETURNING request_count`,
	)
		.bind(projectId, window)
		.first<{ request_count: number }>();
	const count = Number(row?.request_count ?? 1);
	if (count === 1)
		await env.DB.prepare(
			"DELETE FROM email_api_rate_windows WHERE project_id = ? AND window_start < ?",
		)
			.bind(projectId, window - 5)
			.run();
	if (count <= limit) return null;
	const retryAfter = String(Math.max(1, 60 - Math.floor((now % 60_000) / 1_000)));
	return Response.json(
		{
			error: {
				code: "rate_limited",
				message: "Too many requests for this project",
				retryable: true,
			},
		},
		{ status: 429, headers: { "Cache-Control": "no-store", "Retry-After": retryAfter } },
	);
}

async function publicSend(
	key: AuthenticatedKey,
	request: Request,
	env: PublicEnv,
): Promise<Response> {
	const input = parsePublicSendRequest(
		await readJsonLimited(request, PUBLIC_SEND_BODY_LIMIT),
		request.headers.get("Idempotency-Key"),
	);
	const environment = env.ENVIRONMENT === "local" ? "development" : env.ENVIRONMENT;
	const requestSha256 = await publicRequestSha256(input);
	const idempotencyKey = input.idempotencyKey
		? `api:${key.projectId}:${input.idempotencyKey}`
		: null;
	if (idempotencyKey) {
		const replay = await replayReceipt(env, environment, idempotencyKey, requestSha256);
		if (replay) return replay;
	}
	const content = input.templateId
		? await renderTemplate(env, key.projectId, input)
		: { subject: input.subject ?? "", html: input.html, text: input.text };
	const sender = await resolveVerifiedSender(env, key.projectId, input.from.email);
	const suppressed = await suppressedRecipients(env.DB, key.projectId, input.to);
	const recipients = input.to.filter((recipient) => !suppressed.has(recipient));
	if (!recipients.length)
		throw problem(
			422,
			"recipients_suppressed",
			"Every recipient is suppressed after a hard bounce or complaint",
			{
				suppressed: [...suppressed.keys()],
			},
		);

	const id = crypto.randomUUID();
	const now = new Date();
	const nowIso = now.toISOString();
	const capture = env.MAIL_TRANSPORT === "capture";
	const status = capture ? "captured" : "queued";
	const scheduledAt =
		!capture && input.scheduledAt && Date.parse(input.scheduledAt) > now.getTime() + 1_000
			? input.scheduledAt
			: null;
	const scheduled = scheduledAt !== null;
	const publicConfig = {
		...sender.publicConfig,
		...(input.from.name ? { from_name: input.from.name } : {}),
	};
	const exists = "WHERE EXISTS (SELECT 1 FROM email_messages WHERE id = ?)";
	const statements: D1PreparedStatement[] = [
		env.DB.prepare(
			`INSERT ${idempotencyKey ? "OR IGNORE " : ""}INTO email_messages
         (id,environment,transport,kind,project_id,template_key,idempotency_key,request_sha256,
          from_name,from_address,reply_to,subject,text_body,html_body,headers_json,metadata_json,status,created_at,updated_at)
       SELECT ?,?,?,'transactional',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
       WHERE (? IS NULL OR (SELECT COUNT(*) FROM email_deliveries delivery JOIN email_message_senders sender ON sender.message_id = delivery.message_id WHERE sender.profile_id = ? AND julianday(delivery.created_at) >= julianday('now', '-1 hour')) + ? <= ?)
         AND (? IS NULL OR (SELECT COUNT(*) FROM email_deliveries delivery JOIN email_message_senders sender ON sender.message_id = delivery.message_id WHERE sender.profile_id = ? AND julianday(delivery.created_at) >= julianday('now', '-1 day')) + ? <= ?)`,
		).bind(
			id,
			environment,
			env.MAIL_TRANSPORT,
			key.projectId,
			input.templateId,
			idempotencyKey,
			requestSha256,
			publicConfig.from_name ?? env.MAIL_FROM_NAME,
			publicConfig.from_email,
			input.replyTo || publicConfig.reply_to || null,
			content.subject,
			content.text,
			content.html,
			JSON.stringify(input.headers),
			JSON.stringify(input.metadata),
			status,
			nowIso,
			nowIso,
			sender.hourly_quota,
			sender.id,
			recipients.length,
			sender.hourly_quota,
			sender.daily_quota,
			sender.id,
			recipients.length,
			sender.daily_quota,
		),
		env.DB.prepare(
			`INSERT INTO email_message_senders (message_id, profile_id, public_config_json, encrypted_config) SELECT ?, ?, ?, ? ${exists}`,
		).bind(id, sender.id, JSON.stringify(publicConfig), sender.encrypted_config, id),
		env.DB.prepare(
			`INSERT INTO email_message_dispatch (message_id,project_id,source,api_key_id,state,scheduled_at,tags_json,created_at)
       SELECT ?,?,'api',?,?,?,?,? ${exists}`,
		).bind(
			id,
			key.projectId,
			key.id,
			scheduled ? "scheduled" : "released",
			scheduled ? input.scheduledAt : null,
			JSON.stringify(input.tags),
			nowIso,
			id,
		),
		...recipients.map((recipient) =>
			env.DB.prepare(
				`INSERT INTO email_deliveries (id, message_id, recipient, status, created_at, updated_at) SELECT ?,?,?,?,?,? ${exists}`,
			).bind(crypto.randomUUID(), id, recipient, status, nowIso, nowIso, id),
		),
		...input.attachments.flatMap((attachment, position) => {
			const attachmentId = crypto.randomUUID();
			const chunks = chunk(attachment.content, ATTACHMENT_CHUNK_CHARACTERS);
			return [
				env.DB.prepare(
					`INSERT INTO email_message_attachments
             (id,message_id,position,filename,content_type,content_id,disposition,size_bytes,chunk_count)
           SELECT ?,?,?,?,?,?,?,?,? ${exists}`,
				).bind(
					attachmentId,
					id,
					position,
					attachment.filename,
					attachment.contentType,
					attachment.contentId,
					attachment.disposition,
					attachment.size,
					chunks.length,
					id,
				),
				...chunks.map((content, index) =>
					env.DB.prepare(
						`INSERT INTO email_message_attachment_chunks (attachment_id,chunk_index,content_base64)
             SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM email_message_attachments WHERE id = ?)`,
					).bind(attachmentId, index, content, attachmentId),
				),
			];
		}),
		timelineStatement(env, id, key.projectId, null, scheduled ? "scheduled" : "accepted", nowIso, {
			recipients: recipients.length,
			...(scheduled ? { scheduled_at: input.scheduledAt } : {}),
			...(input.templateId ? { template_id: input.templateId } : {}),
		}),
		...[...suppressed].map(([recipient, reason]) =>
			timelineStatement(env, id, key.projectId, recipient, "suppressed", nowIso, { reason }),
		),
	];
	await env.DB.batch(statements);
	const stored = await env.DB.prepare("SELECT id FROM email_messages WHERE id = ?")
		.bind(id)
		.first<{ id: string }>();
	if (!stored) {
		if (idempotencyKey) {
			const replay = await replayReceipt(env, environment, idempotencyKey, requestSha256);
			if (replay) return replay;
		}
		throw problem(429, "sender_quota_exceeded", "The sender's hourly or daily quota is exhausted");
	}
	if (!capture) {
		const delaySeconds = scheduledAt ? delayUntil(scheduledAt) : 0;
		await emailQueue(env).send(
			{ type: "email.deliver", messageId: id },
			delaySeconds ? { delaySeconds } : undefined,
		);
	}
	await releaseOverdueScheduledMessages(env).catch(() => undefined);
	return Response.json(
		{
			id,
			status: capture ? "captured" : scheduled ? "scheduled" : "queued",
			scheduled_at: scheduled ? input.scheduledAt : null,
			recipients: recipients.length,
			suppressed: [...suppressed.keys()],
		},
		{ status: 202, headers: { "Cache-Control": "no-store" } },
	);
}

async function replayReceipt(
	env: PublicEnv,
	environment: string,
	idempotencyKey: string,
	requestSha256: string,
): Promise<Response | null> {
	const existing = await env.DB.prepare(
		`SELECT m.id, m.status, m.request_sha256, d.state, d.scheduled_at FROM email_messages m
     LEFT JOIN email_message_dispatch d ON d.message_id = m.id
     WHERE m.environment = ? AND m.idempotency_key = ?`,
	)
		.bind(environment, idempotencyKey)
		.first<{
			id: string;
			status: string;
			request_sha256: string;
			state: string | null;
			scheduled_at: string | null;
		}>();
	if (!existing) return null;
	if (existing.request_sha256 !== requestSha256)
		throw problem(
			409,
			"idempotency_conflict",
			"This Idempotency-Key was already used with another request",
		);
	if (existing.status === "queued" && existing.state !== "canceled") {
		// The queue command is idempotent: delivery acquisition is conditional.
		const delaySeconds =
			existing.state === "scheduled" && existing.scheduled_at
				? delayUntil(existing.scheduled_at)
				: 0;
		await emailQueue(env).send(
			{ type: "email.deliver", messageId: existing.id },
			delaySeconds ? { delaySeconds } : undefined,
		);
	}
	return Response.json(
		{
			id: existing.id,
			status: publicStatus(existing.status, existing.state),
			scheduled_at: existing.state === "scheduled" ? existing.scheduled_at : null,
			replayed: true,
		},
		{ status: 200, headers: { "Cache-Control": "no-store", "Idempotency-Replayed": "true" } },
	);
}

async function readPublicMessage(
	env: PublicEnv,
	key: AuthenticatedKey,
	id: string,
): Promise<Response> {
	if (!/^[a-f0-9-]{36}$/.test(id)) throw problem(404, "message_not_found", "Message not found");
	const message = await env.DB.prepare(
		`SELECT m.id, m.subject, m.status, m.from_address, m.created_at, m.sent_at, m.last_error,
            d.state, d.scheduled_at, d.tags_json, d.canceled_at
     FROM email_messages m LEFT JOIN email_message_dispatch d ON d.message_id = m.id
     WHERE m.id = ? AND m.project_id = ?`,
	)
		.bind(id, key.projectId)
		.first<Record<string, string | null>>();
	if (!message) throw problem(404, "message_not_found", "Message not found");
	const [deliveries, events] = await Promise.all([
		env.DB.prepare(
			"SELECT recipient, status, provider_status, provider_event_at, attempt_count, sent_at FROM email_deliveries WHERE message_id = ? ORDER BY recipient",
		)
			.bind(id)
			.all(),
		env.DB.prepare(
			"SELECT event_type AS type, recipient, occurred_at, detail FROM email_message_events WHERE message_id = ? ORDER BY occurred_at, id LIMIT 200",
		)
			.bind(id)
			.all<{
				type: string;
				recipient: string | null;
				occurred_at: string;
				detail: string | null;
			}>(),
	]);
	return Response.json(
		{
			id: message.id,
			status: publicStatus(String(message.status), message.state),
			subject: message.subject,
			from: message.from_address,
			created_at: message.created_at,
			sent_at: message.sent_at,
			scheduled_at: message.scheduled_at,
			canceled_at: message.canceled_at,
			tags: jsonArray(message.tags_json ?? "[]"),
			recipients: deliveries.results,
			events: events.results.map((event) => ({ ...event, detail: jsonObject(event.detail) })),
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

async function cancelPublicMessage(
	env: PublicEnv,
	key: AuthenticatedKey,
	id: string,
): Promise<Response> {
	if (!/^[a-f0-9-]{36}$/.test(id)) throw problem(404, "message_not_found", "Message not found");
	const now = new Date().toISOString();
	const canceled = await env.DB.prepare(
		`UPDATE email_message_dispatch SET state = 'canceled', canceled_at = ?
     WHERE message_id = ? AND project_id = ? AND state = 'scheduled' RETURNING message_id`,
	)
		.bind(now, id, key.projectId)
		.first<{ message_id: string }>();
	if (!canceled) {
		const current = await env.DB.prepare(
			"SELECT m.status, d.state FROM email_messages m LEFT JOIN email_message_dispatch d ON d.message_id = m.id WHERE m.id = ? AND m.project_id = ?",
		)
			.bind(id, key.projectId)
			.first<{ status: string; state: string | null }>();
		if (!current) throw problem(404, "message_not_found", "Message not found");
		throw problem(
			409,
			"message_not_cancelable",
			"Only scheduled messages that were not released can be canceled",
			{
				status: publicStatus(current.status, current.state),
			},
		);
	}
	await env.DB.batch([
		env.DB.prepare(
			"UPDATE email_messages SET status = 'failed', last_error = 'canceled', updated_at = ? WHERE id = ? AND status = 'queued'",
		).bind(now, id),
		env.DB.prepare(
			"UPDATE email_deliveries SET status = 'failed', last_error = 'canceled', updated_at = ? WHERE message_id = ? AND status = 'queued'",
		).bind(now, id),
	]);
	await recordEmailEvent(env, {
		messageId: id,
		projectId: key.projectId,
		type: "canceled",
		occurredAt: now,
	});
	return Response.json(
		{ id, status: "canceled", canceled_at: now },
		{ headers: { "Cache-Control": "no-store" } },
	);
}

/**
 * Safety net for lost delayed queue messages: scheduled messages overdue by more
 * than five minutes are enqueued again (delivery acquisition is idempotent).
 */
export async function releaseOverdueScheduledMessages(
	env: Pick<Env, "DB" | "EMAIL_QUEUE">,
): Promise<number> {
	const rows = await env.DB.prepare(
		"SELECT message_id FROM email_message_dispatch WHERE state = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 25",
	)
		.bind(new Date(Date.now() - 300_000).toISOString())
		.all<{ message_id: string }>();
	for (const row of rows.results)
		await emailQueue(env).send({ type: "email.deliver", messageId: row.message_id });
	return rows.results.length;
}

function delayUntil(scheduledAt: string): number {
	const seconds = Math.ceil((Date.parse(scheduledAt) - Date.now()) / 1_000);
	return Math.max(0, Math.min(QUEUE_MAX_DELAY_SECONDS, seconds));
}

function publicStatus(status: string, state: string | null | undefined): string {
	if (state === "canceled") return "canceled";
	if (state === "scheduled" && status === "queued") return "scheduled";
	return status;
}

export function parsePublicSendRequest(
	value: unknown,
	headerIdempotencyKey?: string | null,
): PublicSendInput {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid("request_invalid");
	const input: Record<string, unknown> = { ...value };
	const rawRecipients: unknown[] = Array.isArray(input.to)
		? input.to
		: input.to == null
			? []
			: [input.to];
	const to = [
		...new Set(
			rawRecipients.map((recipient) =>
				normalizeEmail(
					recipient && typeof recipient === "object"
						? "email" in recipient
							? recipient.email
							: undefined
						: recipient,
				),
			),
		),
	];
	if (!to.length || to.length > MAX_RECIPIENTS) invalid("recipients_invalid");
	const from = parseSender(input.from);
	const templateId = optionalScalar(input.template_id, "template_id_invalid");
	if (templateId !== null && !TEMPLATE_ID.test(templateId)) invalid("template_id_invalid");
	const subject =
		input.subject == null || input.subject === ""
			? null
			: headerText(input.subject, "subject", 998);
	const html = body(input.html, "html");
	const text = body(input.text, "text");
	if (templateId && (html || text)) invalid("content_conflict");
	if (!templateId && (!subject || (!html && !text))) invalid("content_required");
	const locale = optionalScalar(input.locale, "locale_invalid");
	if (locale !== null && !LOCALE.test(locale)) invalid("locale_invalid");
	const variables = plainObject(input.variables, "variables", 32_000);
	const replyTo =
		input.reply_to == null || input.reply_to === "" ? null : normalizeEmail(input.reply_to);
	const headers = customHeaders(input.headers);
	const tags = Array.isArray(input.tags)
		? [...new Set(input.tags.map(String))]
		: input.tags == null
			? []
			: invalid("tags_invalid");
	if (tags.length > 10 || tags.some((tag) => !TAG.test(tag))) invalid("tags_invalid");
	const metadata = plainObject(input.metadata, "metadata", 4_096);
	const idempotencySource = headerIdempotencyKey?.trim() || input.idempotency_key;
	const idempotencyKey = optionalScalar(idempotencySource, "idempotency_key_invalid");
	if (idempotencyKey !== null && !IDEMPOTENCY_KEY.test(idempotencyKey))
		invalid("idempotency_key_invalid");
	return {
		to,
		from,
		subject,
		html,
		text,
		templateId,
		variables,
		locale,
		replyTo,
		headers,
		tags,
		metadata,
		attachments: parseAttachments(input.attachments),
		idempotencyKey,
		scheduledAt: parseSchedule(input.scheduled_at),
	};
}

function parseSender(value: unknown): { email: string; name: string | null } {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const sender = value as { email?: unknown; name?: unknown };
		return {
			email: normalizeEmail(sender.email),
			name: sender.name == null || sender.name === "" ? null : headerText(sender.name, "from", 200),
		};
	}
	const raw = typeof value === "string" ? value.trim() : "";
	if (unsafeHeaderText(raw)) invalid("from_invalid");
	const named = /^(.*?)\s*<([^<>]+)>$/.exec(raw);
	if (named) {
		const name = (named[1] ?? "").replace(/^"|"$/g, "").trim();
		return { email: normalizeEmail(named[2]), name: name ? headerText(name, "from", 200) : null };
	}
	if (!raw) invalid("from_required");
	return { email: normalizeEmail(raw), name: null };
}

function parseAttachments(value: unknown): PublicAttachment[] {
	if (value == null) return [];
	if (!Array.isArray(value) || value.length > EMAIL_ATTACHMENTS_MAX_COUNT)
		invalid("attachments_invalid");
	const normalized = normalizeAttachments(
		value.map((item) => {
			if (!isRecord(item)) invalid("attachment_invalid");
			const attachment = item;
			if (
				typeof attachment.filename !== "string" ||
				!attachment.filename.trim() ||
				attachment.filename.length > 255
			)
				invalid("attachment_filename_invalid");
			if (typeof attachment.content !== "string") invalid("attachment_content_invalid");
			return {
				filename: attachment.filename,
				content: attachment.content,
				contentType: typeof attachment.content_type === "string" ? attachment.content_type : null,
				contentId: typeof attachment.content_id === "string" ? attachment.content_id : null,
				disposition:
					attachment.disposition === "inline" ? ("inline" as const) : ("attachment" as const),
			};
		}),
	);
	let total = 0;
	return normalized.map((attachment) => {
		const extension = attachment.filename.toLowerCase().split(".").at(-1) ?? "";
		if (attachment.filename.includes(".") && BLOCKED_EXTENSIONS.has(extension))
			invalid("attachment_type_forbidden");
		const size =
			Math.floor((attachment.content.length * 3) / 4) -
			(attachment.content.endsWith("==") ? 2 : attachment.content.endsWith("=") ? 1 : 0);
		total += size;
		if (total > EMAIL_ATTACHMENTS_MAX_BYTES) invalid("attachments_too_large");
		return { ...attachment, size };
	});
}

function parseSchedule(value: unknown): string | null {
	if (value == null || value === "") return null;
	if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value))
		invalid("scheduled_at_invalid");
	const time = Date.parse(value);
	const now = Date.now();
	if (!Number.isFinite(time) || time < now - 60_000) invalid("scheduled_at_invalid");
	if (time > now + SCHEDULE_MAX_SECONDS * 1_000) invalid("scheduled_at_too_far");
	return new Date(time).toISOString();
}

function customHeaders(value: unknown): Record<string, string> {
	if (value == null) return {};
	if (typeof value !== "object" || Array.isArray(value)) invalid("headers_invalid");
	const entries = Object.entries(value);
	if (entries.length > 30) invalid("headers_invalid");
	return Object.fromEntries(
		entries.map(([name, item]) => {
			const lower = name.toLowerCase();
			if (
				!HEADER_NAME.test(name) ||
				RESERVED_HEADERS.has(lower) ||
				lower.startsWith("x-ses-") ||
				lower.startsWith("x-superboard-") ||
				typeof item !== "string" ||
				item.length > 2_000 ||
				unsafeHeaderText(item)
			)
				invalid("headers_invalid");
			return [name, item];
		}),
	);
}

/** Line breaks and NUL bytes would allow SMTP header injection. */
function unsafeHeaderText(value: string): boolean {
	return /[\r\n]/.test(value) || value.includes(String.fromCharCode(0));
}

function headerText(value: unknown, field: string, maximum: number): string {
	if (typeof value !== "string") invalid(`${field}_invalid`);
	const result = value.trim();
	if (!result || result.length > maximum || unsafeHeaderText(result)) invalid(`${field}_invalid`);
	return result;
}

function body(value: unknown, field: string): string | null {
	if (value == null || value === "") return null;
	if (typeof value !== "string" || value.length > 512_000) invalid(`${field}_invalid`);
	return value;
}

function plainObject(value: unknown, field: string, maximumBytes: number): Record<string, unknown> {
	if (value == null) return {};
	if (typeof value !== "object" || Array.isArray(value)) invalid(`${field}_invalid`);
	if (JSON.stringify(value).length > maximumBytes) invalid(`${field}_too_large`);
	return { ...value };
}

async function publicRequestSha256(input: PublicSendInput): Promise<string> {
	const attachments = await Promise.all(
		input.attachments.map(async ({ content, ...attachment }) => ({
			...attachment,
			sha256: await sha256(content),
		})),
	);
	return sha256(
		stableJson({ ...input, idempotencyKey: undefined, to: [...input.to].sort(), attachments }),
	);
}

async function renderTemplate(env: PublicEnv, projectId: number, input: PublicSendInput) {
	if (!env.API_SERVICE) throw problem(503, "template_unavailable", "Templates are unavailable");
	const response = await env.API_SERVICE.fetch(
		new Request("https://api.internal/internal/v1/email/template-source", {
			method: "POST",
			headers: { "content-type": "application/json", "x-internal-token": env.EMAIL_INTERNAL_TOKEN },
			body: JSON.stringify({ project_id: projectId, template_id: input.templateId }),
		}),
	);
	if (response.status === 404)
		throw problem(404, "template_not_found", "The template does not exist or is not published");
	if (!response.ok) throw problem(503, "template_unavailable", "The template could not be loaded");
	const payload = (await readJsonObjectLimited(response, 2_000_000)) as {
		data?: { document?: EmailDesign } | null;
	};
	const design = payload?.data?.document;
	if (!design || typeof design !== "object")
		throw problem(404, "template_not_found", "The template does not exist or is not published");
	const resolved = resolveEmailMessage(design, {
		request_locale: input.locale ?? undefined,
		profile: { ...input.variables, email: input.to[0] },
		event: input.variables,
		currency: typeof input.variables.currency === "string" ? input.variables.currency : undefined,
		time_zone:
			typeof input.variables.time_zone === "string" ? input.variables.time_zone : undefined,
	});
	if (resolved.status !== "ready")
		throw problem(
			422,
			"template_translation_unavailable",
			"No approved translation is available for this locale",
		);
	if (resolved.missing_variables.length)
		throw problem(422, "template_variables_missing", "Required template variables are missing", {
			variables: resolved.missing_variables,
		});
	return { subject: input.subject ?? resolved.subject, html: resolved.html, text: resolved.text };
}

type SenderRow = {
	id: string;
	public_config_json: string;
	encrypted_config: string;
	authentication_status: string;
	hourly_quota: number | null;
	daily_quota: number | null;
};

async function resolveVerifiedSender(env: PublicEnv, projectId: number, email: string) {
	const rows = await env.DB.prepare(
		"SELECT id, public_config_json, encrypted_config, authentication_status, hourly_quota, daily_quota FROM email_smtp_profiles WHERE project_id = ? AND enabled = 1 ORDER BY priority, created_at, id LIMIT 100",
	)
		.bind(projectId)
		.all<SenderRow>();
	const candidates = rows.results
		.map((row) => ({
			row,
			publicConfig: senderPublicConfig(row.public_config_json),
		}))
		.filter(({ publicConfig }) => publicConfig.from_email?.toLowerCase() === email);
	if (!candidates.length)
		throw problem(
			422,
			"sender_not_found",
			"from must be an enabled sender identity of this project",
		);
	const verified = candidates.find(({ row }) => row.authentication_status === "verified");
	const selected = verified ?? (env.ENVIRONMENT === "production" ? null : candidates[0]);
	if (!selected)
		throw problem(
			422,
			"sender_not_verified",
			"Verify the sender domain before sending through the API",
		);
	return {
		id: selected.row.id,
		publicConfig: { ...selected.publicConfig, from_email: email } as Record<string, unknown> & {
			from_email: string;
			from_name?: string | null;
			reply_to?: string | null;
		},
		encrypted_config: selected.row.encrypted_config,
		hourly_quota: typeof selected.row.hourly_quota === "number" ? selected.row.hourly_quota : null,
		daily_quota: typeof selected.row.daily_quota === "number" ? selected.row.daily_quota : null,
	};
}

async function suppressedRecipients(db: D1Database, projectId: number, recipients: string[]) {
	const rows = await db
		.prepare(
			`SELECT recipient, reason FROM email_suppressions WHERE project_id = ? AND recipient IN (${recipients.map(() => "?").join(",")})`,
		)
		.bind(projectId, ...recipients)
		.all<{ recipient: string; reason: string }>();
	return new Map(rows.results.map((row) => [row.recipient, row.reason]));
}

function timelineStatement(
	env: Pick<Env, "DB">,
	messageId: string,
	projectId: number,
	recipient: string | null,
	type: string,
	occurredAt: string,
	detail: Record<string, unknown>,
) {
	return env.DB.prepare(
		`INSERT INTO email_message_events (id,message_id,project_id,recipient,event_type,occurred_at,detail)
     SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM email_messages WHERE id = ?)`,
	).bind(
		crypto.randomUUID(),
		messageId,
		projectId,
		recipient,
		type,
		occurredAt,
		JSON.stringify(detail),
		messageId,
	);
}

function chunk(value: string, size: number): string[] {
	const chunks: string[] = [];
	for (let index = 0; index < value.length; index += size)
		chunks.push(value.slice(index, index + size));
	return chunks.length ? chunks : [""];
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (isRecord(value))
		return `{${Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}

function jsonArray(value: string): unknown[] {
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
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

/** Text of a scalar JSON value; objects and arrays are rejected with `code`. */
function optionalScalar(value: unknown, code: string): string | null {
	if (value == null || value === "") return null;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return invalid(code);
}

/** Stored sender configuration with its display fields checked; other keys are kept. */
function senderPublicConfig(json: string) {
	const {
		from_email: fromEmail,
		from_name: fromName,
		reply_to: replyTo,
		...rest
	} = jsonObject(json);
	return {
		...rest,
		...(typeof fromEmail === "string" ? { from_email: fromEmail } : {}),
		...(typeof fromName === "string" || fromName === null ? { from_name: fromName } : {}),
		...(typeof replyTo === "string" || replyTo === null ? { reply_to: replyTo } : {}),
	};
}

/** Errors raised with `problem()` carry a client status, code and message. */
function knownProblem(
	error: unknown,
): { status: number; code: string; message: string; details: unknown } | null {
	if (typeof error !== "object" || error === null) return null;
	const status = "status" in error ? error.status : undefined;
	const code = "code" in error ? error.code : undefined;
	if (typeof code !== "string" || !code || typeof status !== "number" || !status || status >= 500)
		return null;
	const message = "message" in error ? error.message : undefined;
	return {
		status,
		code,
		message: typeof message === "string" ? message : code,
		details: "details" in error ? error.details : undefined,
	};
}

function invalid(code: string): never {
	throw new EmailValidationError(code);
}

function problem(status: number, code: string, message: string, details?: unknown) {
	return Object.assign(new Error(message), { status, code, details });
}

function failure(
	status: number,
	code: string,
	message: string,
	details?: unknown,
	retryable = false,
): Response {
	return Response.json(
		{ error: { code, message, retryable, ...(details ? { details } : {}) } },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
}
