import { createExecutionContext, env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import { deliverMarketingSignal } from "../../../../../packages/plugins/supbrd-plug-analytics/worker/src/marketing-signals.js";
import email from "../../../../../packages/plugins/supbrd-plug-communication/email/src/index.js";
import marketing from "../../../../../packages/plugins/supbrd-plug-communication/marketing/src/index.js";
import { dispatchLifecycleApi, pluginTaskContext } from "./lifecycle-health-services.js";

const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};
test("an internal Email integration cannot write while Email is disabled and resumes idempotently after activation", async () => {
	const execution = pluginTaskContext(createExecutionContext(), "supbrd-plugmod-email");
	const db = (env as unknown as { HEALTH_EMAIL_DB: D1Database }).HEALTH_EMAIL_DB;
	const bindings = {
		DB: db,
		ENVIRONMENT: "development",
		MAIL_PROVIDER: "smtp",
		MAIL_TRANSPORT: "capture",
		MAIL_FROM_NAME: "SuperBoard",
		MAIL_FROM_ADDRESS: "sender@example.test",
		EMAIL_INTERNAL_TOKEN: "runtime-email-secret",
		EMAIL_SMTP_ENCRYPTION_KEY: "email-integration-key",
		SUPERBOARD_INSTANCE_ID: "reference-production",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		API_SERVICE: {
			fetch: (request: Request) =>
				dispatchLifecycleApi(request, env as unknown as Record<string, unknown>, execution),
		},
	};
	const call = () =>
		email.fetch!(
			new Request("https://email.internal/internal/v1/messages", {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Internal-Token": "runtime-email-secret" },
				body: JSON.stringify({
					kind: "transactional",
					to: "integration@example.test",
					subject: "Optional integration",
					text: "Provider activation controls delivery",
					idempotencyKey: "optional-provider-message",
				}),
			}),
			bindings as never,
			execution,
		);
	const blocked = await call();
	expect(blocked.status, await blocked.clone().text()).toBe(404);
	expect(await db.prepare("SELECT COUNT(*) AS count FROM email_messages").first()).toEqual({
		count: 0,
	});
	const activated = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-email/enable",
		{ method: "POST", headers },
	);
	expect(activated.status).toBe(201);
	const sent = await call();
	expect(sent.status, await sent.clone().text()).toBe(202);
	expect((await call()).status).toBe(202);
	expect(await db.prepare("SELECT COUNT(*) AS count FROM email_messages").first()).toEqual({
		count: 1,
	});
	const disabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-email/disable",
		{ method: "POST", headers },
	);
	expect(disabled.status).toBe(201);
	expect((await call()).status).toBe(404);
	expect(await db.prepare("SELECT COUNT(*) AS count FROM email_messages").first()).toEqual({
		count: 1,
	});
});

test("Analytics keeps a signal pending while Marketing is disabled and delivers it after activation", async () => {
	const stores = env as unknown as {
		HEALTH_ANALYTICS_DB: D1Database;
		HEALTH_MARKETING_DB: D1Database;
	};
	const execution = pluginTaskContext(createExecutionContext(), "supbrd-plugmod-marketing");
	const bindings = {
		DB: stores.HEALTH_MARKETING_DB,
		ENVIRONMENT: "local",
		SUPERBOARD_INSTANCE_ID: "reference-production",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		INTERNAL_API_TOKEN: "runtime-module-secret",
		API_SERVICE: {
			fetch: (request: Request) =>
				dispatchLifecycleApi(request, env as unknown as Record<string, unknown>, execution),
		},
	};
	const client = {
		DB: stores.HEALTH_ANALYTICS_DB,
		INTERNAL_API_TOKEN: "runtime-module-secret",
		MARKETING_MODULE: {
			fetch: (request: Request) => marketing.fetch!(request as never, bindings as never, execution),
		},
	};
	const eventId = "marketing-optional-event";
	await client.DB.prepare(
		"INSERT INTO analytics_marketing_signal_outbox(id,project_id,project_ref,instance_id,environment,event_id,payload_json) VALUES ('optional-signal','81','42-prod',42,'production',?,?)",
	)
		.bind(
			eventId,
			JSON.stringify({
				schema_version: 1,
				event_id: eventId,
				event_name: "superboard.analytics.installation.created.v1",
				application_id: "optional-app",
				subject_hash: "a".repeat(64),
				properties: {},
				occurred_at: new Date().toISOString(),
			}),
		)
		.run();
	expect(
		await deliverMarketingSignal(
			{ ...client, MARKETING_MODULE: undefined } as never,
			"81",
			eventId,
		),
	).toBe(false);
	expect(await deliverMarketingSignal(client as never, "81", eventId)).toBe(false);
	expect(
		await client.DB.prepare(
			"SELECT status,attempt_count FROM analytics_marketing_signal_outbox WHERE id='optional-signal'",
		).first(),
	).toEqual({ status: "pending", attempt_count: 0 });
	expect(
		await stores.HEALTH_MARKETING_DB.prepare(
			"SELECT COUNT(*) AS count FROM marketing_signal_receipts",
		).first(),
	).toEqual({ count: 0 });
	const activated = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-marketing/enable",
		{ method: "POST", headers },
	);
	expect(activated.status).toBe(201);
	const delivered = await deliverMarketingSignal(client as never, "81", eventId);
	expect(
		delivered,
		JSON.stringify(
			await client.DB.prepare(
				"SELECT status,last_error FROM analytics_marketing_signal_outbox WHERE id='optional-signal'",
			).first(),
		),
	).toBe(true);
	expect(
		await client.DB.prepare(
			"SELECT status,attempt_count FROM analytics_marketing_signal_outbox WHERE id='optional-signal'",
		).first(),
	).toEqual({ status: "delivered", attempt_count: 0 });
	expect(
		await stores.HEALTH_MARKETING_DB.prepare(
			"SELECT COUNT(*) AS count FROM marketing_signal_receipts",
		).first(),
	).toEqual({ count: 1 });
});
