import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@superboard/email-transport", async (importOriginal) => ({
	...(await importOriginal<typeof import("@superboard/email-transport")>()),
	sendSmtpMessage: smtp.send,
}));

import { encryptJson } from "../../../../../../packages/plugins/superboard-communication/email/src/admin-secrets";
import {
	deliverWebhook,
	signWebhookPayload,
} from "../../../../../../packages/plugins/superboard-communication/email/src/events";
import worker from "../../../../../../packages/plugins/superboard-communication/email/src/index";
import {
	consumeRateLimit,
	hashEmailApiKey,
	parsePublicSendRequest,
} from "../../../../../../packages/plugins/superboard-communication/email/src/public-api";

const INTERNAL = "internal-secret";
const ENCRYPTION = "encryption-secret";
const PROJECT = 12;
const context = {
	waitUntil: vi.fn(),
	passThroughOnException: vi.fn(),
	props: {},
} as unknown as ExecutionContext;

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness(overrides: Partial<Env> = {}) {
	const { sqlite, db } = emailDatabase();
	const queue = { send: vi.fn().mockResolvedValue(undefined), metrics: vi.fn() };
	const api = { fetch: vi.fn<(request: Request) => Promise<Response>>() };
	const env = {
		DB: db,
		EMAIL_QUEUE: queue as unknown as Queue<EmailQueueJob>,
		API_SERVICE: api as unknown as Fetcher,
		ENVIRONMENT: "production",
		D1_EXPECTED_MIGRATION: "0010_email_event_webhooks.sql",
		MAIL_TRANSPORT: "smtp",
		MAIL_PROVIDER: "smtp",
		MAIL_FROM_NAME: "SuperBoard",
		MAIL_FROM_ADDRESS: "noreply@example.test",
		MAIL_REPLY_TO: "",
		EMAIL_INTERNAL_TOKEN: INTERNAL,
		EMAIL_SMTP_ENCRYPTION_KEY: ENCRYPTION,
		...overrides,
	} as Env;
	sqlite
		.prepare(
			"INSERT INTO email_smtp_profiles (id,project_id,name,encrypted_config,public_config_json,priority,enabled,authentication_status) VALUES (?,?,?,?,?,?,?,?)",
		)
		.run(
			"profile-1",
			PROJECT,
			"Primary",
			await encryptJson(ENCRYPTION, { password: "smtp-password" }),
			JSON.stringify({
				host: "smtp.example.test",
				port: 587,
				security: "starttls",
				username: "mailer",
				from_email: "hello@example.com",
				from_name: "Example",
				reply_to: null,
			}),
			100,
			1,
			"verified",
		);
	return { sqlite, db, queue, api, env };
}

async function admin(h: Harness, method: string, path: string, body?: unknown) {
	const url = `https://email.internal/internal/v1/admin${path}`;
	const headers = await createProjectContextHeaders(
		{
			projectId: PROJECT,
			projectRef: "1-prod",
			instanceId: 1,
			environment: "production",
			actorId: 0,
			operatorId: "operator-1",
			role: "owner",
			requestId: `request-${crypto.randomUUID()}`,
			issuedAt: Math.floor(Date.now() / 1000),
			module: "email",
			method,
			pathname: new URL(url).pathname,
		},
		INTERNAL,
	);
	if (method !== "GET") headers.set("Idempotency-Key", crypto.randomUUID());
	if (body !== undefined) headers.set("content-type", "application/json");
	return worker.fetch(
		new Request(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
		h.env,
		context,
	);
}

async function createKey(h: Harness): Promise<string> {
	const response = await admin(h, "POST", "/settings/api-keys", { name: "Backend" });
	expect(response.status).toBe(201);
	const payload = (await response.json()) as { data: { secret: string } };
	return payload.data.secret;
}

function publicRequest(
	path: string,
	key: string | null,
	body?: unknown,
	headers: Record<string, string> = {},
) {
	return new Request(`https://email.internal/internal/v1/public${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			"content-type": "application/json",
			"x-internal-token": INTERNAL,
			...(key ? { "x-superboard-email-key": key } : {}),
			...headers,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

const message = {
	to: ["customer@example.net"],
	from: "Example Billing <hello@example.com>",
	subject: "Your receipt",
	html: "<p>Thanks</p>",
	text: "Thanks",
	tags: ["receipt"],
	metadata: { order_id: "A-1" },
};

describe("Email API keys", () => {
	it("returns the secret once and stores only its digest", async () => {
		const h = await harness();
		const secret = await createKey(h);
		expect(secret).toMatch(/^sb_email_[a-f0-9]{64}$/);
		const row = h.sqlite
			.prepare("SELECT key_hash, prefix, scopes_json FROM email_api_keys")
			.get() as Record<string, string>;
		expect(row.key_hash).toBe(await hashEmailApiKey(secret));
		expect(row.key_hash).not.toContain(secret.slice(9));
		expect(JSON.parse(row.scopes_json)).toEqual(["email:send"]);
		const operations = h.sqlite
			.prepare("SELECT response_json FROM email_admin_operations")
			.all() as Array<{ response_json: string }>;
		expect(operations.map((item) => item.response_json).join("")).not.toContain(secret);
		const list = (await (await admin(h, "GET", "/settings/api-keys")).json()) as {
			data: Array<Record<string, unknown>>;
		};
		expect(list.data).toHaveLength(1);
		expect(JSON.stringify(list.data)).not.toContain(secret);
	});

	it("rejects missing internal authentication, unknown keys and revoked keys", async () => {
		const h = await harness();
		const secret = await createKey(h);
		const noInternal = new Request("https://email.internal/internal/v1/public/send", {
			method: "POST",
			headers: { "x-superboard-email-key": secret },
			body: JSON.stringify(message),
		});
		expect((await worker.fetch(noInternal, h.env, context)).status).toBe(401);
		const unknown = await worker.fetch(
			publicRequest("/send", `sb_email_${"0".repeat(64)}`, message),
			h.env,
			context,
		);
		expect(unknown.status).toBe(401);
		const { id } = h.sqlite.prepare("SELECT id FROM email_api_keys").get() as { id: string };
		expect((await admin(h, "DELETE", `/settings/api-keys/${id}`)).status).toBe(200);
		const revoked = await worker.fetch(publicRequest("/send", secret, message), h.env, context);
		expect(revoked.status).toBe(401);
		await expect(revoked.json()).resolves.toMatchObject({ error: { code: "api_key_invalid" } });
	});
});

describe("Public transactional send", () => {
	beforeEach(() => smtp.send.mockReset());

	it("queues an API message with tags, metadata, attachments and a timeline", async () => {
		const h = await harness();
		const key = await createKey(h);
		const attachment = btoa("%PDF-1.4 receipt");
		const response = await worker.fetch(
			publicRequest("/send", key, {
				...message,
				attachments: [
					{ filename: "receipt.pdf", content_type: "application/pdf", content: attachment },
				],
			}),
			h.env,
			context,
		);
		expect(response.status).toBe(202);
		const receipt = (await response.json()) as { id: string; status: string };
		expect(receipt).toMatchObject({ status: "queued", recipients: 1, suppressed: [] });
		expect(h.queue.send).toHaveBeenCalledWith(
			{ type: "email.deliver", messageId: receipt.id },
			undefined,
		);
		const stored = h.sqlite
			.prepare(
				"SELECT m.from_name, m.project_id, d.source, d.tags_json FROM email_messages m JOIN email_message_dispatch d ON d.message_id = m.id",
			)
			.get() as Record<string, unknown>;
		expect(stored).toMatchObject({
			from_name: "Example Billing",
			project_id: PROJECT,
			source: "api",
			tags_json: '["receipt"]',
		});
		const chunk = h.sqlite
			.prepare("SELECT content_base64 FROM email_message_attachment_chunks")
			.get() as { content_base64: string };
		expect(chunk.content_base64).toBe(attachment);

		const detail = await admin(h, "GET", `/messages/${receipt.id}`);
		const payload = (await detail.json()) as { data: Record<string, unknown> };
		expect(payload.data).toMatchObject({
			source: "api",
			tags: ["receipt"],
			attachments: [{ filename: "receipt.pdf", content_type: "application/pdf" }],
			timeline: [{ type: "accepted" }],
		});

		smtp.send.mockResolvedValue({ messageId: "provider-1", response: "250 queued" });
		await worker.queue(
			{
				queue: "email-delivery",
				messages: [queueMessage({ type: "email.deliver", messageId: receipt.id })],
			} as never,
			h.env,
			context,
		);
		expect(smtp.send).toHaveBeenCalledTimes(1);
		expect(smtp.send.mock.calls[0][2]).toMatchObject({
			to: "customer@example.net",
			attachments: [
				{ filename: "receipt.pdf", contentType: "application/pdf", content: attachment },
			],
		});
		const status = await worker.fetch(
			publicRequest(`/messages/${receipt.id}`, key),
			h.env,
			context,
		);
		await expect(status.json()).resolves.toMatchObject({
			status: "sent",
			tags: ["receipt"],
			events: [{ type: "accepted" }, { type: "sent", recipient: "customer@example.net" }],
		});
	});

	it("replays an idempotent request and rejects key reuse with another payload", async () => {
		const h = await harness();
		const key = await createKey(h);
		const first = await worker.fetch(
			publicRequest("/send", key, message, { "Idempotency-Key": "order-A-1" }),
			h.env,
			context,
		);
		const second = await worker.fetch(
			publicRequest("/send", key, message, { "Idempotency-Key": "order-A-1" }),
			h.env,
			context,
		);
		expect(first.status).toBe(202);
		expect(second.status).toBe(200);
		const [a, b] = (await Promise.all([first.json(), second.json()])) as Array<{
			id: string;
			replayed?: boolean;
		}>;
		expect(b).toMatchObject({ id: a.id, replayed: true });
		expect(h.sqlite.prepare("SELECT COUNT(*) AS total FROM email_messages").get()).toEqual({
			total: 1,
		});
		const conflict = await worker.fetch(
			publicRequest(
				"/send",
				key,
				{ ...message, subject: "Other" },
				{ "Idempotency-Key": "order-A-1" },
			),
			h.env,
			context,
		);
		expect(conflict.status).toBe(409);
	});

	it("requires a verified project sender and excludes suppressed recipients", async () => {
		const h = await harness();
		const key = await createKey(h);
		const foreign = await worker.fetch(
			publicRequest("/send", key, { ...message, from: "other@example.org" }),
			h.env,
			context,
		);
		await expect(foreign.json()).resolves.toMatchObject({ error: { code: "sender_not_found" } });
		h.sqlite.prepare("UPDATE email_smtp_profiles SET authentication_status = 'failed'").run();
		const unverified = await worker.fetch(publicRequest("/send", key, message), h.env, context);
		await expect(unverified.json()).resolves.toMatchObject({
			error: { code: "sender_not_verified" },
		});
		h.sqlite.prepare("UPDATE email_smtp_profiles SET authentication_status = 'verified'").run();
		h.sqlite
			.prepare(
				"INSERT INTO email_suppressions (project_id, recipient, reason) VALUES (?, ?, 'hard_bounce')",
			)
			.run(PROJECT, "customer@example.net");
		const all = await worker.fetch(publicRequest("/send", key, message), h.env, context);
		expect(all.status).toBe(422);
		await expect(all.json()).resolves.toMatchObject({ error: { code: "recipients_suppressed" } });
		const partial = await worker.fetch(
			publicRequest("/send", key, {
				...message,
				to: ["customer@example.net", "other@example.net"],
			}),
			h.env,
			context,
		);
		await expect(partial.json()).resolves.toMatchObject({
			status: "queued",
			recipients: 1,
			suppressed: ["customer@example.net"],
		});
	});

	it("schedules a message, delays the queue job and cancels it before release", async () => {
		const h = await harness();
		const key = await createKey(h);
		const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
		const response = await worker.fetch(
			publicRequest("/send", key, { ...message, scheduled_at: scheduledAt }),
			h.env,
			context,
		);
		const receipt = (await response.json()) as { id: string; status: string; scheduled_at: string };
		expect(receipt).toMatchObject({ status: "scheduled", scheduled_at: scheduledAt });
		const [job, options] = h.queue.send.mock.calls.at(-1)!;
		expect(job).toEqual({ type: "email.deliver", messageId: receipt.id });
		expect(options.delaySeconds).toBeGreaterThan(3_500);
		expect(options.delaySeconds).toBeLessThanOrEqual(3_600);

		// A premature queue delivery re-delays instead of sending.
		await worker.queue(
			{ queue: "email-delivery", messages: [queueMessage(job)] } as never,
			h.env,
			context,
		);
		expect(smtp.send).not.toHaveBeenCalled();

		const cancel = await worker.fetch(
			publicRequest(`/messages/${receipt.id}/cancel`, key, {}),
			h.env,
			context,
		);
		await expect(cancel.json()).resolves.toMatchObject({ id: receipt.id, status: "canceled" });
		const again = await worker.fetch(
			publicRequest(`/messages/${receipt.id}/cancel`, key, {}),
			h.env,
			context,
		);
		expect(again.status).toBe(409);
		h.sqlite
			.prepare("UPDATE email_message_dispatch SET scheduled_at = ?")
			.run(new Date(Date.now() - 1000).toISOString());
		await worker.queue(
			{ queue: "email-delivery", messages: [queueMessage(job)] } as never,
			h.env,
			context,
		);
		expect(smtp.send).not.toHaveBeenCalled();
	});

	it("renders a published template with variables and locale", async () => {
		const h = await harness();
		const key = await createKey(h);
		vi.mocked(h.api.fetch).mockImplementation(async () =>
			Response.json({
				data: {
					revision: 3,
					document: {
						purpose: "notification",
						fallback_locale: "en",
						source_revision: 1,
						missing_translation: "fallback",
						theme: {
							background: "#ffffff",
							surface: "#ffffff",
							text: "#111111",
							accent: "#2255ff",
							font: "Arial",
							width: 600,
						},
						locales: {
							en: {
								status: "approved",
								source_revision: 1,
								subject: "Hello {{first_name}}",
								preheader: "",
								blocks: [{ id: "b1", type: "text", text: "Order {{order_id}}" }],
							},
							fr: {
								status: "approved",
								source_revision: 1,
								subject: "Bonjour {{first_name}}",
								preheader: "",
								blocks: [{ id: "b1", type: "text", text: "Commande {{order_id}}" }],
							},
						},
					},
				},
			}),
		);
		const response = await worker.fetch(
			publicRequest("/send", key, {
				to: "customer@example.net",
				from: "hello@example.com",
				template_id: "welcome",
				locale: "fr",
				variables: { first_name: "Ada", order_id: "A-1" },
			}),
			h.env,
			context,
		);
		expect(response.status).toBe(202);
		const request = h.api.fetch.mock.calls[0][0];
		expect(new URL(request.url).pathname).toBe("/internal/v1/email/template-source");
		expect(request.headers.get("x-internal-token")).toBe(INTERNAL);
		await expect(request.json()).resolves.toEqual({ project_id: PROJECT, template_id: "welcome" });
		const stored = h.sqlite
			.prepare("SELECT subject, html_body, template_key FROM email_messages")
			.get() as Record<string, string>;
		expect(stored.subject).toBe("Bonjour Ada");
		expect(stored.html_body).toContain("Commande A-1");
		expect(stored.template_key).toBe("welcome");
		const missing = await worker.fetch(
			publicRequest("/send", key, {
				to: "customer@example.net",
				from: "hello@example.com",
				template_id: "welcome",
				variables: {},
			}),
			h.env,
			context,
		);
		await expect(missing.json()).resolves.toMatchObject({
			error: { code: "template_variables_missing" },
		});
	});
});

describe("Public send validation", () => {
	it("rejects header injection, reserved headers, dangerous attachments and far schedules", () => {
		const base = { to: "a@example.net", from: "hello@example.com", subject: "S", text: "T" };
		expect(() =>
			parsePublicSendRequest({ ...base, headers: { "X-Note": "a\r\nBcc: x@example.net" } }),
		).toThrowError(expect.objectContaining({ code: "headers_invalid" }));
		expect(() =>
			parsePublicSendRequest({ ...base, headers: { Bcc: "x@example.net" } }),
		).toThrowError(expect.objectContaining({ code: "headers_invalid" }));
		expect(() =>
			parsePublicSendRequest({ ...base, headers: { "X-SES-CONFIGURATION-SET": "other" } }),
		).toThrowError(expect.objectContaining({ code: "headers_invalid" }));
		expect(() =>
			parsePublicSendRequest({ ...base, subject: "Hi\r\nBcc: x@example.net" }),
		).toThrowError(expect.objectContaining({ code: "subject_invalid" }));
		expect(() =>
			parsePublicSendRequest({ ...base, from: "Evil\r\n <hello@example.com>" }),
		).toThrowError(expect.objectContaining({ code: "from_invalid" }));
		expect(() =>
			parsePublicSendRequest({
				...base,
				attachments: [{ filename: "invoice.exe", content: btoa("MZ") }],
			}),
		).toThrowError(expect.objectContaining({ code: "attachment_type_forbidden" }));
		expect(() =>
			parsePublicSendRequest({
				...base,
				scheduled_at: new Date(Date.now() + 8 * 86_400_000).toISOString(),
			}),
		).toThrowError(expect.objectContaining({ code: "scheduled_at_too_far" }));
		expect(() => parsePublicSendRequest({ ...base, template_id: "welcome" })).toThrowError(
			expect.objectContaining({ code: "content_conflict" }),
		);
		expect(() =>
			parsePublicSendRequest({
				...base,
				to: Array.from({ length: 51 }, (_, i) => `u${i}@example.net`),
			}),
		).toThrowError(expect.objectContaining({ code: "recipients_invalid" }));
	});

	it("limits each project per minute", async () => {
		const { db } = emailDatabase();
		const now = Date.parse("2026-10-31T10:00:10.000Z");
		expect(await consumeRateLimit({ DB: db }, PROJECT, 2, now)).toBeNull();
		expect(await consumeRateLimit({ DB: db }, PROJECT, 2, now)).toBeNull();
		const limited = await consumeRateLimit({ DB: db }, PROJECT, 2, now);
		expect(limited?.status).toBe(429);
		expect(limited?.headers.get("Retry-After")).toBe("50");
		expect(await consumeRateLimit({ DB: db }, PROJECT + 1, 2, now)).toBeNull();
		expect(await consumeRateLimit({ DB: db }, PROJECT, 2, now + 60_000)).toBeNull();
	});
});

describe("Outbound event webhooks", () => {
	beforeEach(() => smtp.send.mockReset());

	it("signs events with HMAC-SHA256, retries with backoff and logs deliveries", async () => {
		const h = await harness();
		const created = await admin(h, "POST", "/settings/event-webhooks", {
			url: "https://hooks.customer.dev/superboard",
			events: ["sent", "bounced"],
		});
		expect(created.status).toBe(201);
		const webhook = ((await created.json()) as { data: { id: string; secret: string } }).data;
		expect(webhook.secret).toMatch(/^whsec_[a-f0-9]{64}$/);
		expect(
			JSON.stringify(h.sqlite.prepare("SELECT * FROM email_event_webhooks").get()),
		).not.toContain(webhook.secret);
		expect(
			(await admin(h, "POST", "/settings/event-webhooks", { url: "https://127.0.0.1/hook" }))
				.status,
		).toBe(422);
		expect(
			(
				await admin(h, "POST", "/settings/event-webhooks", {
					url: "http://hooks.customer.dev/hook",
				})
			).status,
		).toBe(422);

		const key = await createKey(h);
		const receipt = (await (
			await worker.fetch(publicRequest("/send", key, message), h.env, context)
		).json()) as { id: string };
		smtp.send.mockResolvedValue({ messageId: "provider-1", response: "250 queued" });
		await worker.queue(
			{
				queue: "email-delivery",
				messages: [queueMessage({ type: "email.deliver", messageId: receipt.id })],
			} as never,
			h.env,
			context,
		);
		const job = h.queue.send.mock.calls
			.map(([value]) => value)
			.find((value) => value.type === "email.webhook");
		expect(job).toBeDefined();

		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response("nope", { status: 500 }))
			.mockResolvedValueOnce(new Response("ok"));
		const first = await deliverWebhook(h.env, job.deliveryId, { fetcher: fetcher as typeof fetch });
		expect(first).toMatchObject({ status: "retrying", responseStatus: 500 });
		expect(h.queue.send).toHaveBeenLastCalledWith(job, { delaySeconds: 60 });
		h.sqlite.prepare("UPDATE email_event_webhook_deliveries SET next_attempt_at = NULL").run();
		const second = await deliverWebhook(h.env, job.deliveryId, {
			fetcher: fetcher as typeof fetch,
		});
		expect(second).toMatchObject({ status: "delivered", responseStatus: 200 });

		const [url, init] = fetcher.mock.calls[1];
		expect(url).toBe("https://hooks.customer.dev/superboard");
		const body = String(init.body);
		const timestamp = init.headers["x-superboard-timestamp"];
		expect(init.headers["x-superboard-signature"]).toBe(
			`v1=${await signWebhookPayload(webhook.secret, timestamp, body)}`,
		);
		expect(JSON.parse(body)).toMatchObject({
			type: "email.sent",
			project_id: PROJECT,
			data: {
				message_id: receipt.id,
				recipient: "customer@example.net",
				tags: ["receipt"],
				metadata: { order_id: "A-1" },
			},
		});
		const log = (await (
			await admin(h, "GET", `/settings/event-webhooks/${webhook.id}/deliveries`)
		).json()) as { data: Array<Record<string, unknown>> };
		expect(log.data[0]).toMatchObject({
			event_type: "sent",
			status: "delivered",
			attempt_count: 2,
		});
	});

	it("records provider bounces, suppresses the recipient and stops after the retry budget", async () => {
		const h = await harness();
		const created = await admin(h, "POST", "/settings/event-webhooks", {
			url: "https://hooks.customer.dev/x",
			events: ["bounced"],
		});
		const webhook = ((await created.json()) as { data: { id: string } }).data;
		const key = await createKey(h);
		const receipt = (await (
			await worker.fetch(publicRequest("/send", key, message), h.env, context)
		).json()) as { id: string };
		const endpoint = (await (
			await admin(h, "POST", "/settings/provider-webhooks", {
				provider: "custom",
				secret: "provider-secret",
			})
		).json()) as { data: { id: string } };
		const delivery = h.sqlite.prepare("SELECT id FROM email_deliveries").get() as { id: string };
		const response = await worker.fetch(
			new Request(`https://email.internal/public/v1/provider-webhooks/${endpoint.data.id}`, {
				method: "POST",
				headers: { "content-type": "application/json", "x-webhook-secret": "provider-secret" },
				body: JSON.stringify({
					event_type: "hard_bounce",
					delivery_id: delivery.id,
					provider_event_id: "evt-1",
				}),
			}),
			h.env,
			context,
		);
		expect(response.status).toBe(202);
		expect(h.sqlite.prepare("SELECT recipient, reason FROM email_suppressions").get()).toEqual({
			recipient: "customer@example.net",
			reason: "hard_bounce",
		});
		const job = h.queue.send.mock.calls
			.map(([value]) => value)
			.find((value) => value.type === "email.webhook");
		const failing = vi.fn().mockRejectedValue(new Error("connection refused"));
		for (let attempt = 0; attempt < 7; attempt += 1) {
			h.sqlite.prepare("UPDATE email_event_webhook_deliveries SET next_attempt_at = NULL").run();
			await deliverWebhook(h.env, job.deliveryId, { fetcher: failing as typeof fetch });
		}
		expect(failing).toHaveBeenCalledTimes(7);
		expect(
			h.sqlite
				.prepare(
					"SELECT status, attempt_count FROM email_event_webhook_deliveries WHERE webhook_id = ?",
				)
				.get(webhook.id),
		).toEqual({
			status: "failed",
			attempt_count: 7,
		});
		const timeline = h.sqlite
			.prepare(
				"SELECT event_type FROM email_message_events WHERE message_id = ? ORDER BY occurred_at",
			)
			.all(receipt.id);
		expect(timeline.map((row) => (row as { event_type: string }).event_type)).toContain(
			"hard_bounce",
		);
	});
});

describe("Domain authentication settings", () => {
	it("stores wizard inputs per sender and returns the exact records to publish", async () => {
		const h = await harness();
		const saved = await admin(h, "PUT", "/settings/smtp/profile-1/authentication", {
			config: {
				spf_include: "_spf.mailer.net",
				dkim_selector: "s1",
				dkim_type: "cname",
				dkim_value: "s1.dkim.mailer.net",
			},
		});
		expect(saved.status).toBe(200);
		const view = (await (
			await admin(h, "GET", "/settings/smtp/profile-1/authentication")
		).json()) as {
			data: { domain: string; records: Array<{ host: string; value: string; type: string }> };
		};
		expect(view.data.domain).toBe("example.com");
		expect(view.data.records.map(({ type, host, value }) => `${type} ${host} ${value}`)).toEqual([
			"TXT example.com v=spf1 include:_spf.mailer.net ~all",
			"CNAME s1._domainkey.example.com s1.dkim.mailer.net",
			"TXT _dmarc.example.com v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com",
		]);
		expect(
			h.sqlite
				.prepare("SELECT dkim_selector, authentication_status FROM email_smtp_profiles")
				.get(),
		).toEqual({
			dkim_selector: "s1",
			authentication_status: "unverified",
		});
		const invalid = await admin(h, "PUT", "/settings/smtp/profile-1/authentication", {
			config: { spf_include: "evil\r\ninclude:x" },
		});
		expect(invalid.status).toBe(422);
		expect((await admin(h, "GET", "/settings/smtp/unknown/authentication")).status).toBe(404);
	});
});

function queueMessage(body: unknown) {
	return { id: crypto.randomUUID(), body, attempts: 1, ack: vi.fn(), retry: vi.fn() };
}

const emailMigrations = fileURLToPath(
	new URL(
		"../../../../../../packages/plugins/superboard-communication/email/migrations/",
		import.meta.url,
	),
);

/** In-memory SQLite database with every Email Worker migration applied, exposed as a D1 binding. */
function emailDatabase() {
	const sqlite = new DatabaseSync(":memory:");
	for (const file of readdirSync(emailMigrations)
		.filter((name) => name.endsWith(".sql"))
		.sort())
		sqlite.exec(readFileSync(`${emailMigrations}${file}`, "utf8"));
	class Statement {
		values: SQLInputValue[] = [];
		constructor(readonly query: string) {}
		bind(...values: unknown[]) {
			this.values = values.map((value) => (value === undefined ? null : (value as SQLInputValue)));
			return this;
		}
		async first<T>() {
			return (sqlite.prepare(this.query).get(...this.values) ?? null) as T | null;
		}
		async all<T>() {
			return { results: sqlite.prepare(this.query).all(...this.values) as T[] };
		}
		async run() {
			return { meta: sqlite.prepare(this.query).run(...this.values) };
		}
	}
	const db = {
		prepare: (query: string) => new Statement(query),
		batch: async (statements: Statement[]) => {
			sqlite.exec("BEGIN");
			try {
				const results = [];
				for (const statement of statements) results.push(await statement.run());
				sqlite.exec("COMMIT");
				return results;
			} catch (error) {
				sqlite.exec("ROLLBACK");
				throw error;
			}
		},
	};
	return { sqlite, db: db as unknown as D1Database };
}
