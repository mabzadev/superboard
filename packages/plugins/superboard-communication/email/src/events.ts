import { decryptJson, encryptJson } from "./admin-secrets.js";

/** Event types customers can subscribe to on an outbound webhook endpoint. */
export const EMAIL_WEBHOOK_EVENT_TYPES = [
	"sent",
	"delivered",
	"bounced",
	"complained",
	"opened",
	"clicked",
	"failed",
] as const;
type EmailWebhookEventType = (typeof EMAIL_WEBHOOK_EVENT_TYPES)[number];

export type EmailWorkerJob =
	| { type: "email.deliver"; messageId: string }
	| { type: "email.webhook"; deliveryId: string };

/** Retry delays (seconds) after each failed webhook attempt; 7 attempts over ~20 hours. */
const WEBHOOK_RETRY_DELAYS = [60, 300, 1_800, 7_200, 21_600, 43_200] as const;
const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_SIGNATURE_HEADER = "X-SuperBoard-Signature";
const WEBHOOK_TIMESTAMP_HEADER = "X-SuperBoard-Timestamp";
const MAX_WEBHOOKS_PER_EVENT = 10;
/** Cloudflare Queues accepts at most 12 hours of delivery delay per message. */
export const QUEUE_MAX_DELAY_SECONDS = 43_200;

type EventEnv = Pick<Env, "DB" | "EMAIL_QUEUE"> & { EMAIL_SMTP_ENCRYPTION_KEY?: string };

export function emailQueue(env: Pick<Env, "EMAIL_QUEUE">): Queue<EmailWorkerJob> {
	// The generated binding type only declares the delivery job; the consumer
	// accepts both job shapes (see the queue handler).
	const queue: Queue<unknown> = env.EMAIL_QUEUE;
	return queue;
}

type EmailTimelineEvent = {
	messageId: string;
	projectId: number | null;
	recipient?: string | null;
	/** Timeline label: accepted, scheduled, released, canceled, sending, sent, deferred, failed, delivered, … */
	type: string;
	/** Outbound webhook type, when the timeline event is customer-visible. */
	webhook?: EmailWebhookEventType | null;
	occurredAt?: string;
	detail?: Record<string, unknown>;
	/** Stable id for deduplication of at-least-once sources (provider events). */
	eventId?: string;
};

/**
 * Appends a message timeline event and fans it out to subscribed webhook
 * endpoints. Never throws: observability must not break delivery.
 */
export async function recordEmailEvent(env: EventEnv, event: EmailTimelineEvent): Promise<void> {
	try {
		const id = event.eventId ?? crypto.randomUUID();
		const occurredAt = event.occurredAt ?? new Date().toISOString();
		const detail =
			event.detail && Object.keys(event.detail).length
				? JSON.stringify(event.detail).slice(0, 4_000)
				: null;
		const inserted = await env.DB.prepare(
			`INSERT INTO email_message_events (id,message_id,project_id,recipient,event_type,occurred_at,detail)
       SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM email_messages WHERE id = ?)
       ON CONFLICT(id) DO NOTHING RETURNING id`,
		)
			.bind(
				id,
				event.messageId,
				event.projectId,
				event.recipient ?? null,
				event.type,
				occurredAt,
				detail,
				event.messageId,
			)
			.first<{ id: string }>();
		if (!inserted || !event.webhook || event.projectId == null) return;
		await fanOutWebhooks(env, {
			...event,
			eventId: id,
			occurredAt,
			webhook: event.webhook,
			projectId: event.projectId,
		});
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "email_timeline_event_failed",
				message_id: event.messageId,
				type: event.type,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
	}
}

async function fanOutWebhooks(
	env: EventEnv,
	event: EmailTimelineEvent & {
		eventId: string;
		occurredAt: string;
		webhook: EmailWebhookEventType;
		projectId: number;
	},
) {
	const endpoints = (
		await env.DB.prepare(
			"SELECT id, events_json FROM email_event_webhooks WHERE project_id = ? AND enabled = 1 ORDER BY created_at LIMIT ?",
		)
			.bind(event.projectId, MAX_WEBHOOKS_PER_EVENT)
			.all<{ id: string; events_json: string }>()
	).results.filter((endpoint) => parseEvents(endpoint.events_json).includes(event.webhook));
	if (!endpoints.length) return;
	const message = await env.DB.prepare(
		`SELECT m.subject, m.metadata_json, d.tags_json FROM email_messages m
     LEFT JOIN email_message_dispatch d ON d.message_id = m.id WHERE m.id = ?`,
	)
		.bind(event.messageId)
		.first<{ subject: string; metadata_json: string; tags_json: string | null }>();
	const payload = JSON.stringify({
		id: `evt_${event.eventId.replace(/-/g, "")}`,
		type: `email.${event.webhook}`,
		created_at: event.occurredAt,
		project_id: event.projectId,
		data: {
			message_id: event.messageId,
			recipient: event.recipient ?? null,
			subject: message?.subject ?? null,
			tags: safeArray(message?.tags_json),
			metadata: publicMetadata(message?.metadata_json),
			...event.detail,
		},
	});
	const now = new Date().toISOString();
	for (const endpoint of endpoints) {
		const deliveryId = crypto.randomUUID();
		const created = await env.DB.prepare(
			`INSERT INTO email_event_webhook_deliveries
         (id,webhook_id,project_id,event_id,event_type,payload_json,status,next_attempt_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'pending',?,?,?) ON CONFLICT(webhook_id,event_id) DO NOTHING RETURNING id`,
		)
			.bind(
				deliveryId,
				endpoint.id,
				event.projectId,
				event.eventId,
				event.webhook,
				payload,
				now,
				now,
				now,
			)
			.first<{ id: string }>();
		if (created) await emailQueue(env).send({ type: "email.webhook", deliveryId: created.id });
	}
}

type WebhookDeliveryRow = {
	id: string;
	webhook_id: string;
	event_id: string;
	event_type: string;
	payload_json: string;
	status: string;
	attempt_count: number;
	url: string;
	encrypted_secret: string;
	enabled: number;
};

/**
 * Sends one webhook delivery attempt. Retries are scheduled as delayed queue
 * messages so the delivery queue's own retry budget is never consumed.
 */
export async function deliverWebhook(
	env: EventEnv,
	deliveryId: string,
	options: { retry?: boolean; fetcher?: typeof fetch } = {},
): Promise<{
	status: "delivered" | "retrying" | "failed" | "skipped";
	responseStatus: number | null;
	error: string | null;
}> {
	const now = new Date();
	const claimed = await env.DB.prepare(
		`UPDATE email_event_webhook_deliveries
     SET attempt_count = attempt_count + 1, status = 'retrying', next_attempt_at = NULL, updated_at = ?
     WHERE id = ? AND status IN ('pending','retrying')
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     RETURNING attempt_count`,
	)
		.bind(now.toISOString(), deliveryId, new Date(now.getTime() + 5_000).toISOString())
		.first<{ attempt_count: number }>();
	if (!claimed) return { status: "skipped", responseStatus: null, error: null };
	const row = await env.DB.prepare(
		`SELECT d.id, d.webhook_id, d.event_id, d.event_type, d.payload_json, d.status, d.attempt_count,
            w.url, w.encrypted_secret, w.enabled
     FROM email_event_webhook_deliveries d JOIN email_event_webhooks w ON w.id = d.webhook_id
     WHERE d.id = ?`,
	)
		.bind(deliveryId)
		.first<WebhookDeliveryRow>();
	if (!row) return { status: "skipped", responseStatus: null, error: null };
	if (row.enabled !== 1) {
		await finishDelivery(env, row.id, "failed", null, "webhook_disabled");
		return { status: "failed", responseStatus: null, error: "webhook_disabled" };
	}
	let responseStatus: number | null = null;
	let failure: string | null = null;
	try {
		const secret = await decryptJson<{ secret: string }>(encryptionKey(env), row.encrypted_secret);
		const timestamp = String(Math.floor(Date.now() / 1_000));
		const signature = await signWebhookPayload(secret.secret, timestamp, row.payload_json);
		const response = await (options.fetcher ?? fetch)(row.url, {
			method: "POST",
			redirect: "manual",
			signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
			headers: {
				"content-type": "application/json",
				"user-agent": "SuperBoard-Webhooks/1.0",
				"x-superboard-event-id": row.event_id,
				"x-superboard-event-type": row.event_type,
				[WEBHOOK_TIMESTAMP_HEADER.toLowerCase()]: timestamp,
				[WEBHOOK_SIGNATURE_HEADER.toLowerCase()]: `v1=${signature}`,
			},
			body: row.payload_json,
		});
		responseStatus = response.status;
		await response.body?.cancel().catch(() => undefined);
		if (response.status >= 200 && response.status < 300) {
			await finishDelivery(env, row.id, "delivered", responseStatus, null);
			return { status: "delivered", responseStatus, error: null };
		}
		failure = `HTTP ${response.status}`;
	} catch (error) {
		failure =
			error instanceof Error
				? error.name === "TimeoutError"
					? "timeout"
					: error.message
				: String(error);
	}
	const attempt = Number(claimed.attempt_count);
	const delay = options.retry === false ? undefined : WEBHOOK_RETRY_DELAYS[attempt - 1];
	if (delay === undefined) {
		await finishDelivery(env, row.id, "failed", responseStatus, failure);
		return { status: "failed", responseStatus, error: failure };
	}
	await env.DB.prepare(
		`UPDATE email_event_webhook_deliveries SET status = 'retrying', response_status = ?, last_error = ?,
       next_attempt_at = ?, updated_at = ? WHERE id = ?`,
	)
		.bind(
			responseStatus,
			failure?.slice(0, 500) ?? null,
			new Date(Date.now() + delay * 1_000).toISOString(),
			new Date().toISOString(),
			row.id,
		)
		.run();
	await emailQueue(env).send(
		{ type: "email.webhook", deliveryId: row.id },
		{ delaySeconds: delay },
	);
	return { status: "retrying", responseStatus, error: failure };
}

async function finishDelivery(
	env: EventEnv,
	id: string,
	status: "delivered" | "failed",
	responseStatus: number | null,
	error: string | null,
) {
	const now = new Date().toISOString();
	await env.DB.prepare(
		`UPDATE email_event_webhook_deliveries SET status = ?, response_status = ?, last_error = ?,
       next_attempt_at = NULL, delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END, updated_at = ?
     WHERE id = ?`,
	)
		.bind(status, responseStatus, error?.slice(0, 500) ?? null, status, now, now, id)
		.run();
}

/** `hex(HMAC-SHA256(secret, "<timestamp>.<raw body>"))`, the value after `v1=`. */
export async function signWebhookPayload(
	secret: string,
	timestamp: string,
	body: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`${timestamp}.${body}`),
	);
	return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateWebhookSecret(): string {
	return `whsec_${randomHex(32)}`;
}

export async function encryptWebhookSecret(env: EventEnv, secret: string): Promise<string> {
	return encryptJson(encryptionKey(env), { secret });
}

/**
 * Accepts only public HTTPS endpoints: no credentials, IP literals, custom
 * ports or internal hostnames (prevents SSRF into private infrastructure).
 */
export function normalizeWebhookUrl(value: unknown): string {
	let url: URL;
	try {
		url = new URL((typeof value === "string" ? value : "").trim());
	} catch {
		throw invalid("webhook_url_invalid");
	}
	const host = url.hostname.toLowerCase();
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		(url.port && url.port !== "443") ||
		url.href.length > 2_048 ||
		!host.includes(".") ||
		/^[\d.]+$/.test(host) ||
		host.startsWith("[") ||
		/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/.test(host)
	)
		throw invalid("webhook_url_invalid");
	url.hash = "";
	return url.href;
}

export function normalizeWebhookEvents(value: unknown): EmailWebhookEventType[] {
	const list = Array.isArray(value) ? value : EMAIL_WEBHOOK_EVENT_TYPES;
	const names = [...new Set(list.map(String))];
	const events = names.filter(isWebhookEventType);
	if (!events.length || events.length !== names.length) throw invalid("webhook_events_invalid");
	return events;
}

function isWebhookEventType(value: string): value is EmailWebhookEventType {
	return (EMAIL_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

export function parseEvents(value: string): string[] {
	return safeArray(value).filter((item): item is string => typeof item === "string");
}

/** Maps provider event types to the customer-facing webhook taxonomy. */
export function webhookTypeForProviderEvent(eventType: string): EmailWebhookEventType | null {
	if (eventType === "delivered") return "delivered";
	if (eventType === "hard_bounce" || eventType === "soft_bounce") return "bounced";
	if (eventType === "complaint") return "complained";
	if (eventType === "rejected") return "failed";
	if (eventType === "opened" || eventType === "clicked") return eventType;
	return null;
}

export function randomHex(bytes: number): string {
	return [...crypto.getRandomValues(new Uint8Array(bytes))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function publicMetadata(value: string | undefined): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(value ?? "{}");
		if (!isRecord(parsed)) return {};
		const { operator_id: _operator, ...rest } = parsed;
		return rest;
	} catch {
		return {};
	}
}

function safeArray(value: string | null | undefined): unknown[] {
	try {
		const parsed: unknown = JSON.parse(value ?? "[]");
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function encryptionKey(env: EventEnv): string {
	if (!env.EMAIL_SMTP_ENCRYPTION_KEY)
		throw Object.assign(new Error("encryption unavailable"), {
			status: 503,
			code: "email_encryption_unavailable",
		});
	return env.EMAIL_SMTP_ENCRYPTION_KEY;
}

function invalid(code: string) {
	return Object.assign(new Error(code), { status: 422, code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
