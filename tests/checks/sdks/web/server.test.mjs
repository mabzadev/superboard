import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
	SuperBoardEmailError,
	SuperBoardServer,
	sendEmail,
	verifyWebhookSignature,
} from "../../../../sdks/web/src/server.js";

const secretKey = `sb_email_${"a".repeat(64)}`;

test("sendEmail posts a snake_case request with the bearer key and idempotency key", async () => {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url, init });
		return Response.json(
			{ id: "m-1", status: "scheduled", scheduled_at: "2026-11-01T10:00:00.000Z" },
			{ status: 202 },
		);
	};
	const result = await sendEmail(
		{ apiUrl: "https://sdk.example.com/ignored", secretKey, fetch },
		{
			to: ["a@example.net"],
			from: "Billing <billing@example.com>",
			templateId: "receipt",
			variables: { order_id: "A-1" },
			locale: "fr",
			replyTo: "help@example.com",
			tags: ["receipt"],
			attachments: [
				{
					filename: "a.txt",
					content: new TextEncoder().encode("hello"),
					contentType: "text/plain",
				},
			],
			scheduledAt: new Date("2026-11-01T10:00:00.000Z"),
		},
		{ idempotencyKey: "order-A-1" },
	);
	assert.equal(result.id, "m-1");
	assert.equal(calls[0].url, "https://sdk.example.com/v1/email/send");
	assert.equal(calls[0].init.method, "POST");
	assert.equal(calls[0].init.headers.Authorization, `Bearer ${secretKey}`);
	assert.equal(calls[0].init.headers["Idempotency-Key"], "order-A-1");
	assert.equal(calls[0].init.redirect, "error");
	assert.equal(calls[0].init.credentials, "omit");
	assert.deepEqual(JSON.parse(calls[0].init.body), {
		to: ["a@example.net"],
		from: "Billing <billing@example.com>",
		template_id: "receipt",
		variables: { order_id: "A-1" },
		locale: "fr",
		reply_to: "help@example.com",
		tags: ["receipt"],
		attachments: [{ filename: "a.txt", content: "aGVsbG8=", content_type: "text/plain" }],
		scheduled_at: "2026-11-01T10:00:00.000Z",
	});
});

test("API errors surface the code, status and retryability", async () => {
	const server = new SuperBoardServer({
		apiUrl: "https://sdk.example.com",
		secretKey,
		fetch: async () =>
			Response.json(
				{ error: { code: "rate_limited", message: "Too many requests" } },
				{ status: 429 },
			),
	});
	await assert.rejects(
		server.sendEmail({ to: "a@example.net", from: "b@example.com", subject: "S", text: "T" }),
		(error) =>
			error instanceof SuperBoardEmailError &&
			error.code === "rate_limited" &&
			error.status === 429 &&
			error.retryable === true,
	);
});

test("getEmail and cancelEmail address the message routes", async () => {
	const urls = [];
	const server = new SuperBoardServer({
		apiUrl: "https://sdk.example.com",
		secretKey,
		fetch: async (url, init) => {
			urls.push(`${init.method} ${url}`);
			return Response.json({ id: "m 1", status: "canceled" });
		},
	});
	await server.getEmail("m 1");
	await server.cancelEmail("m 1");
	assert.deepEqual(urls, [
		"GET https://sdk.example.com/v1/email/messages/m%201",
		"POST https://sdk.example.com/v1/email/messages/m%201/cancel",
	]);
});

test("the server helper refuses browsers, client keys and insecure origins", () => {
	assert.throws(
		() => new SuperBoardServer({ apiUrl: "https://sdk.example.com", secretKey: "og_app_x" }),
		/sb_email_/,
	);
	assert.throws(
		() => new SuperBoardServer({ apiUrl: "http://sdk.example.com", secretKey }),
		/HTTPS/,
	);
	globalThis.window = {};
	globalThis.document = {};
	try {
		assert.throws(
			() => new SuperBoardServer({ apiUrl: "https://sdk.example.com", secretKey }),
			/server-only/,
		);
	} finally {
		delete globalThis.window;
		delete globalThis.document;
	}
});

test("verifyWebhookSignature accepts valid signatures and rejects tampering or replays", async () => {
	const secret = `whsec_${"b".repeat(64)}`;
	const payload = JSON.stringify({ id: "evt_1", type: "email.delivered" });
	const timestamp = "1793440000";
	const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
	const now = 1793440000 * 1000 + 10_000;
	assert.equal(await verifyWebhookSignature({ payload, signature, timestamp, secret, now }), true);
	assert.equal(
		await verifyWebhookSignature({ payload: `${payload} `, signature, timestamp, secret, now }),
		false,
	);
	assert.equal(
		await verifyWebhookSignature({ payload, signature, timestamp, secret: "other", now }),
		false,
	);
	assert.equal(
		await verifyWebhookSignature({ payload, signature, timestamp, secret, now: now + 3_600_000 }),
		false,
	);
});
