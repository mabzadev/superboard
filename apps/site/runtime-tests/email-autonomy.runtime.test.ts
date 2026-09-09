import { PROJECT_CONTEXT_HEADERS, signProjectContext } from "@superboard/contracts/project-context";
import { signSiteOperatorRequest } from "@superboard/contracts/site-operator";
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

import api from "../../../workers/api/src/index.js";
import type { Env as ApiEnv } from "../../../workers/api/src/types.js";
import { decryptJson as decryptEmail } from "../../../workers/email/src/admin-secrets.js";
import { handleEmailAdmin } from "../../../workers/email/src/admin.js";
import email from "../../../workers/email/src/index.js";
import marketing from "../../../workers/marketing/src/index.js";
import { deliverySenders } from "../../../workers/marketing/src/sender-profiles.js";
import { encryptJson as encryptLegacy } from "../../../workers/marketing/src/secrets.js";
import { dispatchPluginApiAdapter } from "../src/lib/plugin-api-adapter.js";
import {
	synchronizeSuperBoardPluginCatalog,
	superBoardRuntimePluginCatalog,
} from "../src/lib/superboard-plugin-catalog.js";

const stores = env as typeof env & {
	HEALTH_EMAIL_DB: D1Database;
	HEALTH_MARKETING_DB: D1Database;
	HEALTH_API_DB: D1Database;
};
const emailDb = stores.HEALTH_EMAIL_DB;
const legacyDb = stores.HEALTH_MARKETING_DB;

const secret = "email-autonomy-internal-secret";
const emailEnv = {
	DB: emailDb,
	ENVIRONMENT: "development",
	MAIL_PROVIDER: "smtp",
	MAIL_TRANSPORT: "capture",
	MAIL_FROM_NAME: "SuperBoard",
	MAIL_FROM_ADDRESS: "sender@example.test",
	EMAIL_INTERNAL_TOKEN: secret,
	EMAIL_SMTP_ENCRYPTION_KEY: "email-autonomy-encryption-key",
} as Parameters<typeof email.fetch>[1];

async function emailRequest(
	method: string,
	path: string,
	body?: unknown,
	projectId = 81,
	operation?: string,
	role = "owner",
	runtime = emailEnv,
	operations?: Parameters<typeof handleEmailAdmin>[2],
) {
	const url = new URL(path, "https://email.internal");
	const context = {
		module: "email" as const,
		method,
		pathname: url.pathname,
		projectId,
		projectRef: "42-prod",
		instanceId: 42,
		environment: "production" as const,
		actorId: 0,
		operatorId: "emdash-email-owner",
		role,
		requestId: crypto.randomUUID(),
		issuedAt: Math.floor(Date.now() / 1000),
	};
	const headers = new Headers({
		"Content-Type": "application/json",
		"Idempotency-Key": operation ?? `email-autonomy:${method}:${url.pathname.replaceAll("/", ".")}`,
		[PROJECT_CONTEXT_HEADERS.token]: secret,
		[PROJECT_CONTEXT_HEADERS.projectId]: String(projectId),
		[PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
		[PROJECT_CONTEXT_HEADERS.instanceId]: "42",
		[PROJECT_CONTEXT_HEADERS.environment]: context.environment,
		[PROJECT_CONTEXT_HEADERS.actorId]: "0",
		[PROJECT_CONTEXT_HEADERS.operatorId]: context.operatorId,
		[PROJECT_CONTEXT_HEADERS.role]: context.role,
		[PROJECT_CONTEXT_HEADERS.requestId]: context.requestId,
		[PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
		[PROJECT_CONTEXT_HEADERS.version]: "1",
		[PROJECT_CONTEXT_HEADERS.signature]: await signProjectContext(context, secret),
	});
	const init: RequestInit = { method, headers };
	if (body !== undefined) init.body = JSON.stringify(body);
	return operations
		? handleEmailAdmin(new Request(url, init), runtime, operations)
		: email.fetch(new Request(url, init), runtime);
}

test("Email alone owns SMTP settings and captures an idempotent transactional message", async () => {
	const profile = await emailRequest("PUT", "/internal/v1/admin/settings/smtp", {
		name: "Standalone sender",
		host: "smtp.example.test",
		port: 587,
		security: "starttls",
		username: "sender",
		password: "never-in-client-responses",
		from_email: "sender@example.test",
		from_name: "Standalone sender",
	});
	expect(profile.status).toBe(200);
	const saved = (await profile.json()) as { data: { id: string } };
	expect(JSON.stringify(saved)).not.toContain("never-in-client-responses");
	const settings = await emailRequest("GET", "/internal/v1/admin/settings/smtp");
	expect(await settings.json()).toMatchObject({
		data: { id: saved.data.id, from_email: "sender@example.test" },
	});
	const body = {
		recipient: "test@example.test",
		subject: "Standalone Email",
		text: "Email works without Marketing.",
		smtp_profile_id: saved.data.id,
	};
	const first = await emailRequest("POST", "/internal/v1/admin/transactional", body);
	expect(first.status).toBe(202);
	const receipt = await first.json();
	const replay = await emailRequest("POST", "/internal/v1/admin/transactional", body);
	expect(replay.status).toBe(202);
	expect(await replay.json()).toMatchObject(receipt);
	const outbox = await emailRequest("GET", "/internal/v1/admin/settings/delivery-outbox");
	expect(await outbox.json()).toMatchObject({
		data: [{ subject: "Standalone Email", status: "captured" }],
	});
	const log=await emailRequest("GET","/internal/v1/admin/messages");
	const entries=(await log.json<{data:{items:Array<{id:string;subject:string;status:string}>}}>()).data.items;
	expect(entries).toContainEqual(expect.objectContaining({subject:"Standalone Email",status:"captured"}));
	const detail=await emailRequest("GET","/internal/v1/admin/messages/"+entries[0]!.id);
	expect(await detail.json()).toMatchObject({data:{text_body:"Email works without Marketing."}});
	expect((await emailRequest("GET","/internal/v1/admin/messages/"+entries[0]!.id,undefined,82)).status).toBe(404);
	expect(await emailDb.prepare("SELECT COUNT(*) AS count FROM email_messages").first()).toEqual({
		count: 1,
	});
	expect(
		(
			await emailRequest(
				"DELETE",
				`/internal/v1/admin/settings/smtp/${saved.data.id}`,
				undefined,
				82,
			)
		).status,
	).toBe(404);
	expect(
		(await emailRequest("DELETE", `/internal/v1/admin/settings/smtp/${saved.data.id}`)).status,
	).toBe(200);
	expect(
		await emailDb
			.prepare(
				"SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('subscribers','campaigns','marketing_outbox')",
			)
			.first(),
	).toEqual({ count: 0 });
});

test("migrates legacy SMTP profiles through real Workers and keeps later Email edits authoritative", async () => {
	const legacyKey = "legacy-marketing-smtp-key";
	const profile = {
		host: "smtp.legacy.test",
		port: 587,
		security: "starttls",
		username: "legacy-user",
		from_email: "legacy@example.test",
		from_name: "Legacy",
		reply_to: null,
	};
	const encrypted = await encryptLegacy(legacyKey, { password: "legacy-password-migrated" });
	await legacyDb
		.prepare(
			"INSERT INTO smtp_profiles (id,project_id,name,encrypted_config,public_config_json,priority,enabled,created_at,updated_at) VALUES ('legacy-profile',81,'Legacy sender',?,?,100,1,'2025-01-01T12:00:00.000Z','2025-02-01T12:00:00.000Z')",
		)
		.bind(encrypted, JSON.stringify(profile))
		.run();
	const marketingSecret = "marketing-migration-internal";
	const marketingEnv = {
		DB: legacyDb,
		ENVIRONMENT: "development",
		EMAIL_PROVIDER: "smtp",
		INTERNAL_API_TOKEN: marketingSecret,
		EMAIL_INTERNAL_TOKEN: secret,
		SMTP_ENCRYPTION_KEY: legacyKey,
		EMAIL_SERVICE: {
			fetch: (input: RequestInfo | URL, init?: RequestInit) =>
				email.fetch(new Request(input, init), emailEnv),
		},
	} as Parameters<typeof marketing.fetch>[1];
	const call = async (method: string, path: string, key: string, body?: unknown) => {
		const context = {
			module: "marketing" as const,
			method,
			pathname: path,
			projectId: 81,
			projectRef: "42-prod",
			instanceId: 42,
			environment: "production" as const,
			actorId: 0,
			operatorId: "emdash-email-owner",
			role: "owner",
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		};
		const headers = new Headers({
			"Content-Type": "application/json",
			"Idempotency-Key": key,
			[PROJECT_CONTEXT_HEADERS.token]: marketingSecret,
			[PROJECT_CONTEXT_HEADERS.projectId]: "81",
			[PROJECT_CONTEXT_HEADERS.projectRef]: "42-prod",
			[PROJECT_CONTEXT_HEADERS.instanceId]: "42",
			[PROJECT_CONTEXT_HEADERS.environment]: "production",
			[PROJECT_CONTEXT_HEADERS.actorId]: "0",
			[PROJECT_CONTEXT_HEADERS.operatorId]: context.operatorId,
			[PROJECT_CONTEXT_HEADERS.role]: "owner",
			[PROJECT_CONTEXT_HEADERS.requestId]: context.requestId,
			[PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
			[PROJECT_CONTEXT_HEADERS.version]: "1",
			[PROJECT_CONTEXT_HEADERS.signature]: await signProjectContext(context, marketingSecret),
		});
		const init: RequestInit = { method, headers };
		if (body !== undefined) init.body = JSON.stringify(body);
		return marketing.fetch(new Request(`https://marketing.internal${path}`, init), marketingEnv);
	};
	const migrated = await call(
		"POST",
		"/internal/v1/settings/smtp/migrate-to-email",
		"legacy-smtp-migration",
		{},
	);
	expect(migrated.status).toBe(200);
	expect(await migrated.json()).toMatchObject({ data: { complete: true, imported: 1 } });
	const stored = await emailDb
		.prepare(
			"SELECT encrypted_config,created_at,updated_at FROM email_smtp_profiles WHERE id='legacy-profile'",
		)
		.first<{ encrypted_config: string; created_at: string; updated_at: string }>();
	expect(stored?.created_at).toBe("2025-01-01T12:00:00.000Z");
	expect(stored?.encrypted_config).not.toBe(encrypted);
	expect(await decryptEmail("email-autonomy-encryption-key", stored!.encrypted_config)).toEqual({
		password: "legacy-password-migrated",
	});
	await expect(decryptEmail(legacyKey, stored!.encrypted_config)).rejects.toThrow();
	const updated = await emailRequest(
		"PUT",
		"/internal/v1/admin/settings/smtp",
		{ ...profile, id: "legacy-profile", name: "Email owner changed this" },
		81,
		"email-owned-profile-update",
	);
	expect(updated.status).toBe(200);
	const legacyAlias = await call("GET", "/internal/v1/settings/smtp", "legacy-smtp-read");
	expect(await legacyAlias.json()).toMatchObject({
		data: { id: "legacy-profile", name: "Email owner changed this" },
	});
	expect(
		await legacyDb.prepare("SELECT name FROM smtp_profiles WHERE id='legacy-profile'").first(),
	).toEqual({ name: "Legacy sender" });
	const again = await call(
		"POST",
		"/internal/v1/settings/smtp/migrate-to-email",
		"legacy-smtp-repeat",
		{},
	);
	expect(await again.json()).toMatchObject({ data: { complete: true, imported: 0 } });
	const newSender=await emailRequest("PUT","/internal/v1/admin/settings/smtp",{...profile,id:crypto.randomUUID(),name:"New Email sender",from_email:"new@example.test",password:"new-sender-secret"},81,"new-email-sender");
	expect(newSender.ok).toBe(true);
	const newSenderBody=await newSender.json<{data:{id:string}}>();
	try {
		expect(newSenderBody.data.id).not.toBe("legacy-profile");
		const candidates=await deliverySenders(marketingEnv,81,newSenderBody.data.id);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({id:newSenderBody.data.id,managed:true,encrypted_config:""});
		expect(JSON.stringify(candidates)).not.toContain("new-sender-secret");
		expect(JSON.parse(candidates[0]!.public_config_json)).toMatchObject({from_email:"new@example.test"});
	} finally {
		await emailRequest("DELETE","/internal/v1/admin/settings/smtp/"+newSenderBody.data.id,undefined,81,"remove-new-test-sender");
	}
});

test("Email sender quotas reject concurrent over-capacity sends before creating a second delivery", async () => {
	const profile = {
		name: "Limited sender",
		host: "smtp.quota.test",
		port: 587,
		security: "starttls",
		username: "sender",
		password: "quota-secret",
		from_email: "sender@example.test",
		hourly_quota: 1,
	};
	const savedResponse = await emailRequest(
		"PUT",
		"/internal/v1/admin/settings/smtp",
		profile,
		82,
		"quota-profile",
	);
	expect(savedResponse.status).toBe(200);
	const saved = (await savedResponse.json()) as { data: { id: string } };
	const sends = await Promise.all(
		["first", "second"].map((id) =>
			emailRequest(
				"POST",
				"/internal/v1/admin/transactional",
				{
					recipient: "test@example.test",
					subject: "Quota test",
					text: "Body",
					smtp_profile_id: saved.data.id,
				},
				82,
				`quota-send-${id}`,
			),
		),
	);
	expect(sends.map(({ status }) => status).toSorted((left, right) => left - right)).toEqual([
		202, 429,
	]);
	expect(
		await emailDb
			.prepare("SELECT COUNT(*) AS count FROM email_messages WHERE project_id=82")
			.first(),
	).toEqual({ count: 1 });
	expect(
		(
			await emailRequest(
				"PUT",
				"/internal/v1/admin/settings/smtp",
				profile,
				82,
				"forbidden-profile",
				"member",
			)
		).status,
	).toBe(403);
});

test("Email webhook events are correlated, isolated and idempotent without Marketing", async () => {
	const endpoint = await emailRequest(
		"POST",
		"/internal/v1/admin/settings/provider-webhooks",
		{ provider: "smtp-provider", secret: "signed-provider-secret" },
		81,
		"provider-endpoint",
	);
	expect(endpoint.status).toBe(201);
	const row = (await endpoint.json()) as { data: { id: string } };
	const delivery = await emailDb
		.prepare(
			"SELECT delivery.id FROM email_deliveries delivery JOIN email_messages message ON message.id=delivery.message_id WHERE message.project_id=81 LIMIT 1",
		)
		.first<{ id: string }>();
	const send = (secretValue: string, eventId = "delivery-event-1", deliveryId = delivery!.id) =>
		email.fetch(
			new Request(`https://email.internal/public/v1/provider-webhooks/${row.data.id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-webhook-secret": secretValue },
				body: JSON.stringify({
					provider_event_id: eventId,
					delivery_id: deliveryId,
					event_type: "delivered",
					occurred_at: "2026-09-05T12:00:00.000Z",
				}),
			}),
			emailEnv,
		);
	expect((await send("wrong-secret")).status).toBe(401);
	expect((await send("signed-provider-secret")).status).toBe(202);
	expect(await (await send("signed-provider-secret")).json()).toMatchObject({
		data: { accepted: true, duplicate: true },
	});
	expect(
		await emailDb.prepare("SELECT COUNT(*) AS count FROM email_webhook_events").first(),
	).toEqual({ count: 1 });
	const otherDelivery = await emailDb
		.prepare(
			"SELECT delivery.id FROM email_deliveries delivery JOIN email_messages message ON message.id=delivery.message_id WHERE message.project_id=82 LIMIT 1",
		)
		.first<{ id: string }>();
	expect(
		(await send("signed-provider-secret", "other-project-event", otherDelivery!.id)).status,
	).toBe(404);
	const events = await emailRequest("GET", "/internal/v1/admin/provider-events");
	expect(await events.json()).toMatchObject({
		data: [{ provider: "smtp-provider", event_type: "delivered" }],
	});
});

test("the canonical Email gateway reaches its own Worker with Marketing absent", async () => {
	const apiDb = stores.HEALTH_API_DB;
	await apiDb.batch([
		apiDb.prepare(
			"INSERT INTO instances (id,uri_scheme,api_key) VALUES (42,'email-only-target','email-test-api-key')",
		),
		apiDb.prepare(
			"INSERT INTO projects (id,instance_id,is_test,name,identifier) VALUES (81,42,0,'Email production','email-production'),(82,42,1,'Email test','email-test')",
		),
	]);
	const input = new Request("https://api.internal/api/v1/email/projects/42-prod/settings/smtp");
	const headers = await signSiteOperatorRequest(
		input,
		{ instance_id: "email-only-target", operator_id: "email-gateway-owner", role: 50 },
		"email-gateway-bridge",
	);
	const gatewayEnv = {
		DB: apiDb,
		SUPERBOARD_TARGET: "email-only-target",
		SITE_OPERATOR_BRIDGE_TOKEN: "email-gateway-bridge",
		EMAIL_INTERNAL_TOKEN: secret,
		EMAIL_SERVICE: { fetch: (forwarded: Request) => email.fetch(forwarded, emailEnv) },
	} as unknown as ApiEnv;
	const response = await api.fetch(new Request(input, { headers }), gatewayEnv);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		data: { id: "legacy-profile", name: "Email owner changed this" },
	});
});

test("canonical Email command and data source dispatch retain the owning plugin and operator scope", async () => {
	const instanceId = "email-only-target";
	await synchronizeSuperBoardPluginCatalog(env.DB, {
		instance_id: instanceId,
		target: "local",
		approved_by: "canonical-email-owner",
		checked_at: "2026-09-05T00:00:00.000Z",
		expires_at: "2999-09-06T00:00:00.000Z",
		target_artifact_checksum: `sha256:${"b".repeat(64)}`,
		target_plugin_ids: superBoardRuntimePluginCatalog().plugins.map(
			({ manifest }) => manifest.plugin_id,
		),
	});
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state='active' WHERE instance_id=? AND plugin_id='supbrd-plugmod-email'",
	)
		.bind(instanceId)
		.run();
	const apiEnv = {
		DB: stores.HEALTH_API_DB,
		SUPERBOARD_TARGET: instanceId,
		SITE_OPERATOR_BRIDGE_TOKEN: "canonical-email-bridge",
		EMAIL_INTERNAL_TOKEN: secret,
		EMAIL_SERVICE: { fetch: (forwarded: Request) => email.fetch(forwarded, emailEnv) },
	} as unknown as ApiEnv;
	const dispatchEnv = {
		DB: env.DB,
		SUPERBOARD_INSTANCE_ID: instanceId,
		SUPERBOARD_ENVIRONMENT: "local",
		SITE_OPERATOR_BRIDGE_TOKEN: "canonical-email-bridge",
		SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY: env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY,
		API_SERVICE: { fetch: (forwarded: Request) => api.fetch(forwarded, apiEnv) },
	};
	const pluginId = "supbrd-plugmod-email";
	const body = {
		method: "POST",
		path: "/api/v1/email/projects/42-prod/transactional",
		body: {
			recipient: "canonical@example.test",
			subject: "Canonical Email dispatch",
			text: "Sent by Email's canonical command.",
			smtp_profile_id: "legacy-profile",
		},
	};
	const url = new URL(
		`https://site.test/_emdash/api/superboard/plugins/${pluginId}/commands/${pluginId}.command.send_transactional_email`,
	);
	const request = new Request(url, {
		method: "POST",
		headers: {
			Origin: url.origin,
			"X-EmDash-Request": "1",
			"Content-Type": "application/json",
			"Idempotency-Key": "canonical-email-command",
		},
		body: JSON.stringify(body),
	});
	const context = {
		request,
		url,
		params: { pluginId, commandId: `${pluginId}.command.send_transactional_email` },
		locals: { user: { id: "canonical-email-owner", email: "operator@example.test", role: 50 } },
	} as APIContext;
	const response = await dispatchPluginApiAdapter(context, "command", dispatchEnv);
	expect(response.status).toBe(202);
	expect(
		await env.DB.prepare(
			"SELECT plugin_id,command_id,project_ref FROM superboard_plugin_command_operations WHERE operation_id='canonical-email-command'",
		).first(),
	).toEqual({
		plugin_id: pluginId,
		command_id: `${pluginId}.command.send_transactional_email`,
		project_ref: "42-prod",
	});
	const readUrl = new URL(
		`https://site.test/_emdash/api/superboard/plugins/${pluginId}/data-sources/${pluginId}.data_source.smtp_settings`,
	);
	readUrl.searchParams.set(
		"request",
		JSON.stringify({ method: "GET", path: "/api/v1/email/projects/42-prod/settings/smtp" }),
	);
	const readContext = {
		...context,
		url: readUrl,
		request: new Request(readUrl),
		params: { pluginId, dataSourceId: `${pluginId}.data_source.smtp_settings` },
	};
	const settings = await dispatchPluginApiAdapter(readContext, "data_source", dispatchEnv);
	expect(settings.status).toBe(200);
	expect(await settings.json()).toMatchObject({
		data: { id: "legacy-profile", name: "Email owner changed this" },
	});
	const stored = await emailDb
		.prepare("SELECT metadata_json FROM email_messages WHERE subject='Canonical Email dispatch'")
		.first<{ metadata_json: string }>();
	expect(JSON.parse(stored!.metadata_json)).toEqual({ operator_id: "canonical-email-owner" });
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state='disabled' WHERE instance_id=? AND plugin_id=?",
	)
		.bind(instanceId, pluginId)
		.run();
	expect((await dispatchPluginApiAdapter(readContext, "data_source", dispatchEnv)).status).toBe(
		404,
	);
});

test("Email captures and replays a local operator message using the legacy environment namespace", async () => {
	const runtime = { ...emailEnv, ENVIRONMENT: "local" };
	const body = {
		recipient: "local-operator@example.test",
		subject: "Local capture regression",
		text: "Captured without an SMTP profile.",
	};
	const send = () =>
		emailRequest(
			"POST",
			"/internal/v1/admin/transactional",
			body,
			84,
			"local-capture-regression",
			"owner",
			runtime,
		);
	const response = await send();
	expect(response.status, await response.clone().text()).toBe(202);
	const receipt = await response.json();
	expect(receipt).toMatchObject({ status: "captured" });
	expect(await (await send()).json()).toMatchObject(receipt);
	expect(
		await emailDb
			.prepare(
				"SELECT COUNT(*) AS count FROM email_messages WHERE project_id=84 AND subject='Local capture regression'",
			)
			.first(),
	).toEqual({ count: 1 });
	const outbox = await emailRequest(
		"GET",
		"/internal/v1/admin/settings/delivery-outbox",
		undefined,
		84,
		undefined,
		"owner",
		runtime,
	);
	expect(await outbox.json()).toMatchObject({
		data: [expect.objectContaining({ subject: "Local capture regression", status: "captured" })],
	});
});

test("Email rejects an oversized SMTP receipt without marking the profile tested successfully", async () => {
	const savedResponse = await emailRequest(
		"PUT",
		"/internal/v1/admin/settings/smtp",
		{
			host: "smtp.example.test",
			port: 587,
			security: "starttls",
			username: "qa",
			password: "qa-smtp-secret",
			from_email: "sender@example.test",
		},
		85,
		"bounded-smtp-profile",
	);
	expect(savedResponse.status).toBe(200);
	const saved = (await savedResponse.json()) as { data: { id: string } };
	const unused = async () => Response.json({ error: "unexpected_operation" }, { status: 599 });
	const response = await emailRequest(
		"POST",
		"/internal/v1/admin/settings/smtp/test",
		{ smtp_profile_id: saved.data.id, recipient: "qa@example.test" },
		85,
		"oversized-smtp-receipt",
		"owner",
		emailEnv,
		{
			enqueue: unused,
			replayDeadLetter: unused,
			discardDeadLetter: unused,
			smtp: async () =>
				Response.json({ id: "oversized-receipt", status: "captured", padding: "x".repeat(32768) }),
		},
	);
	expect(response.status).toBe(503);
	expect(await response.json()).toMatchObject({ error: { code: "smtp_response_invalid" } });
	expect(
		await emailDb
			.prepare("SELECT last_test_status FROM email_smtp_profiles WHERE id=?")
			.bind(saved.data.id)
			.first(),
	).not.toEqual({ last_test_status: "sent" });
});
