import { Buffer } from "node:buffer";

import { env, SELF } from "cloudflare:test";
import { afterAll, expect, test, vi } from "vitest";

import { receiveEmailProviderWebhook } from "../../../../../packages/plugins/supbrd-plug-communication/email/src/admin.js";
import { quarantineEmailDeadLetter } from "../../../../../packages/plugins/supbrd-plug-communication/email/src/index.js";
import {
	apiHeaders,
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const smtpCapture = (env as unknown as { TEST_SMTP_CAPTURE: Pick<Fetcher, "fetch"> })
	.TEST_SMTP_CAPTURE;
afterAll(async () => {
	await smtpCapture.fetch(new Request("https://smtp-capture.test", { method: "DELETE" }));
});
const plugin = "supbrd-plugmod-email";
const file = "retirement-api-email.runtime.test.ts";

test("canonical Email APIs preserve encrypted settings, captures, verified DNS and recoverable queue operations", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/email/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("email");
	const command = (id: string, method: string, path: string, body?: unknown) =>
		apiCommand(plugin, id, { method, path: base + path, ...(body === undefined ? {} : { body }) });
	const read = (id: string, path: string) =>
		apiRead(plugin, id, { method: "GET", path: base + path });
	const smtp = await jsonResult<{ port: number; messages: string[] }>(
		await smtpCapture.fetch("https://smtp-capture.test"),
	);
	const profile = await jsonResult<{ data: { id: string } }>(
		await command("save_smtp_settings", "PUT", "/settings/smtp", {
			name: "Canonical sender",
			host: "127.0.0.1",
			port: smtp.port,
			security: "plain",
			username: "proof-user",
			password: "proof-smtp-secret",
			from_email: "sender@example.test",
			from_name: "Proof sender",
			dkim_selector: "mail",
		}),
	);
	const profileId = profile.data.id;
	const settings = await jsonResult<{ data: { id: string; host: string; from_email: string } }>(
		await read("smtp_settings", "/settings/smtp"),
	);
	expect(settings.data).toMatchObject({
		id: profileId,
		host: "127.0.0.1",
		from_email: "sender@example.test",
	});
	expect(JSON.stringify(settings)).not.toContain("proof-smtp-secret");
	const encrypted = await db
		.prepare("SELECT encrypted_config FROM email_smtp_profiles WHERE id=?")
		.bind(profileId)
		.first<{ encrypted_config: string }>();
	expect(encrypted?.encrypted_config).toBeTruthy();
	expect(encrypted?.encrypted_config).not.toContain("proof-smtp-secret");
	proveApi(plugin, "save_smtp_settings", "mutation", file, [profileId]);
	proveApi(plugin, "smtp_settings", "read", file, [profileId]);
	const tested = await jsonResult<{ data: { status: string } }>(
		await command("test_smtp_settings", "POST", "/settings/smtp/test", {
			smtp_profile_id: profileId,
			recipient: "capture@example.test",
		}),
	);
	expect(tested.data.status).toBe("sent");
	const capture = await jsonResult<{ messages: string[] }>(
		await smtpCapture.fetch("https://smtp-capture.test"),
	);
	expect(capture.messages).toHaveLength(1);
	const encodedSubject = /^Subject: =\?UTF-8\?B\?(.+)\?=$/m.exec(capture.messages[0]!);
	expect(encodedSubject).not.toBeNull();
	expect(Buffer.from(encodedSubject![1]!, "base64").toString()).toBe(
		"SuperBoard SMTP connection test",
	);
	expect(capture.messages[0]).toContain("To: capture@example.test");
	expect(
		await db
			.prepare("SELECT last_test_status FROM email_smtp_profiles WHERE id=?")
			.bind(profileId)
			.first(),
	).toEqual({ last_test_status: "sent" });
	proveApi(plugin, "test_smtp_settings", "mutation", file, [profileId]);
	const dnsFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		expect(url.origin).toBe("https://cloudflare-dns.com");
		return new Response(new Uint8Array(dnsAnswer(url.pathname + url.search)), {
			headers: { "Content-Type": "application/dns-message" },
		});
	});
	try {
		await jsonResult(
			await command("verify_smtp_domain", "POST", `/settings/smtp/${profileId}/verify-domain`, {}),
		);
		expect(
			await db
				.prepare(
					"SELECT authentication_status,spf_status,dkim_status,dmarc_status FROM email_smtp_profiles WHERE id=?",
				)
				.bind(profileId)
				.first(),
		).toEqual({
			authentication_status: "verified",
			spf_status: "verified",
			dkim_status: "verified",
			dmarc_status: "verified",
		});
		proveApi(plugin, "verify_smtp_domain", "mutation", file, [profileId]);
	} finally {
		dnsFetch.mockRestore();
	}
	const sent = await jsonResult<{ id: string; status: string }>(
		await command("send_transactional_email", "POST", "/transactional", {
			recipient: "capture@example.test",
			subject: "Canonical captured Email",
			text: "No external delivery",
			smtp_profile_id: profileId,
		}),
		202,
	);
	const messageId = sent.id;
	expect(sent.status).toBe("captured");
	const outbox = await jsonResult<{ data: Array<{ id: string; subject: string; status: string }> }>(
		await read("delivery_outbox", "/settings/delivery-outbox"),
	);
	expect(outbox.data).toContainEqual(
		expect.objectContaining({
			id: messageId,
			subject: "Canonical captured Email",
			status: "captured",
		}),
	);
	proveApi(plugin, "send_transactional_email", "mutation", file, [messageId]);
	proveApi(plugin, "delivery_outbox", "read", file, [messageId]);
	const createdEndpoint = await SELF.fetch(
		`https://site.example${base}/settings/provider-webhooks`,
		{
			method: "POST",
			headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
			body: JSON.stringify({ provider: "proof-provider", secret: "proof-provider-secret" }),
		},
	);
	const endpoint = await jsonResult<{ data: { id: string } }>(createdEndpoint, 201);
	const endpointId = endpoint.data.id;
	const webhooks = await jsonResult<{ data: Array<{ id: string; provider: string }> }>(
		await read("provider_webhooks", "/settings/provider-webhooks"),
	);
	expect(webhooks.data).toContainEqual(
		expect.objectContaining({ id: endpointId, provider: "proof-provider" }),
	);
	expect(JSON.stringify(webhooks)).not.toContain("proof-provider-secret");
	proveApi(plugin, "provider_webhooks", "read", file, [endpointId]);
	const delivery = await db
		.prepare("SELECT id FROM email_deliveries WHERE message_id=?")
		.bind(messageId)
		.first<{ id: string }>();
	expect(delivery?.id).toBeTruthy();
	const providerEvent = await receiveEmailProviderWebhook(
		new Request(`https://email.internal/public/v1/provider-webhooks/${endpointId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-webhook-secret": "proof-provider-secret" },
			body: JSON.stringify({
				provider_event_id: "proof-provider-event",
				delivery_id: delivery!.id,
				event_type: "delivery_delayed",
				occurred_at: new Date().toISOString(),
			}),
		}),
		{ DB: db, EMAIL_SMTP_ENCRYPTION_KEY: "runtime-email-encryption-key" } as Parameters<
			typeof receiveEmailProviderWebhook
		>[1],
	);
	expect(providerEvent.status).toBe(202);
	const events = await jsonResult<{
		data: Array<{ id: string; provider_message_id: string; event_type: string }>;
	}>(await read("provider_events", "/provider-events"));
	const event = events.data.find((item) => item.provider_message_id === "proof-provider-event");
	expect(event?.event_type).toBe("delivery_delayed");
	proveApi(plugin, "provider_events", "read", file, [event!.id]);
	const quarantined = await quarantineEmailDeadLetter(db, "retirement-email-dlq", {
		id: "proof-dead-replay",
		body: { type: "email.deliver", messageId },
		attempts: 4,
	});
	const discarded = await quarantineEmailDeadLetter(db, "retirement-email-dlq", {
		id: "proof-dead-discard",
		body: { type: "email.deliver", messageId },
		attempts: 4,
	});
	const dead = await jsonResult<{
		data: Array<{ id: string; resource_id: string; status: string; replayable: boolean }>;
	}>(await read("dead_letters", "/settings/dead-letters"));
	expect(dead.data).toContainEqual(
		expect.objectContaining({
			id: quarantined.id,
			resource_id: messageId,
			status: "quarantined",
			replayable: true,
		}),
	);
	proveApi(plugin, "dead_letters", "read", file, [quarantined.id, discarded.id]);
	const retried = await jsonResult<{ data: { queued: boolean } }>(
		await command(
			"retry_delivery_outbox",
			"POST",
			`/settings/delivery-outbox/${messageId}/retry`,
			{},
		),
		202,
	);
	expect(retried.data.queued).toBe(true);
	expect(
		await db
			.prepare(
				"SELECT resource_id FROM email_admin_audit_events WHERE action='delivery.retried' AND resource_id=?",
			)
			.bind(messageId)
			.first(),
	).toEqual({ resource_id: messageId });
	proveApi(plugin, "retry_delivery_outbox", "mutation", file, [messageId]);
	const replayed = await SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${plugin}/commands/${plugin}.command.replay_dead_letter`,
		{
			method: "POST",
			headers: {
				...apiHeaders,
				"X-Test-Email-Transport": "smtp",
				"Idempotency-Key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				method: "POST",
				path: `${base}/settings/dead-letters/${quarantined.id}/replay`,
				body: {},
			}),
		},
	);
	expect(await jsonResult(replayed, 202)).toMatchObject({
		id: quarantined.id,
		status: "replayed",
		messageId,
	});
	expect(
		await db
			.prepare("SELECT resolution FROM email_dead_letters WHERE id=?")
			.bind(quarantined.id)
			.first(),
	).toEqual({ resolution: "replayed" });
	proveApi(plugin, "replay_dead_letter", "mutation", file, [quarantined.id]);
	expect(
		await jsonResult(
			await command(
				"discard_dead_letter",
				"POST",
				`/settings/dead-letters/${discarded.id}/discard`,
				{},
			),
		),
	).toMatchObject({ id: discarded.id, status: "discarded" });
	expect(
		await db
			.prepare("SELECT resolution FROM email_dead_letters WHERE id=?")
			.bind(discarded.id)
			.first(),
	).toEqual({ resolution: "discarded" });
	proveApi(plugin, "discard_dead_letter", "mutation", file, [discarded.id]);
	await jsonResult(await command("delete_smtp_settings", "DELETE", `/settings/smtp/${profileId}`));
	expect(
		await db.prepare("SELECT id FROM email_smtp_profiles WHERE id=?").bind(profileId).first(),
	).toBeNull();
	proveApi(plugin, "delete_smtp_settings", "mutation", file, [profileId]);
});

function dnsAnswer(path: string): Buffer {
	const encoded = new URL(path, "https://cloudflare-dns.com").searchParams.get("dns")!;
	const query = Buffer.from(encoded, "base64url");
	let offset = 12;
	const labels: string[] = [];
	while (query[offset]) {
		const length = query[offset++]!;
		labels.push(query.subarray(offset, offset + length).toString());
		offset += length;
	}
	const name = labels.join(".");
	const text = Buffer.from(
		name.startsWith("_dmarc.")
			? "v=DMARC1; p=reject"
			: name.includes("._domainkey.")
				? "v=DKIM1; k=rsa; p=fixture-public-key"
				: "v=spf1 -all",
	);
	const answer = Buffer.alloc(13 + text.length);
	answer.set([0xc0, 0x0c, 0, 16, 0, 1, 0, 0, 1, 44]);
	answer.writeUInt16BE(text.length + 1, 10);
	answer[12] = text.length;
	text.copy(answer, 13);
	const header = Buffer.from(query.subarray(0, 12));
	header.writeUInt16BE(0x8180, 2);
	header.writeUInt16BE(1, 6);
	return Buffer.concat([header, query.subarray(12), answer]);
}
