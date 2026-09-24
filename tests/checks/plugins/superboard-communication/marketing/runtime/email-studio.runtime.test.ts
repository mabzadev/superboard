import { createEmailDesign, type EmailDesign } from "@superboard/contracts/email-studio";
import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";

import { freezeDeliveryMessage } from "../../../../../../packages/plugins/superboard-communication/marketing/src/delivery-records.js";
import { advanceJourneyEnrollment } from "../../../../../../packages/plugins/superboard-communication/marketing/src/journeys.js";
import type { Env } from "../../../../../../packages/plugins/superboard-communication/marketing/src/types.js";

it.each([
	["notification", "unsubscribe", "sent"],
	["campaign", "unsubscribe", "suppressed"],
	["notification", "hard_bounce", "suppressed"],
] as const)("event-triggered %s handles %s as %s", async (purpose, reason, expected) => {
	const document = createEmailDesign("en", purpose);
	const translation = document.locales.en;
	if (!translation) throw new Error("Missing English fixture");
	translation.status = "approved";
	if (purpose === "notification") {
		translation.subject = "Account update";
		translation.preheader = "";
		translation.blocks = [{ id: "body", type: "text", text: "Your account has changed." }];
	}
	const templateId = await createTemplate(document);
	expect(
		(await request(`/templates/${templateId}/publish`, "POST", { expected_revision: 1 })).status,
	).toBe(200);
	const id = crypto.randomUUID();
	const definition = JSON.stringify({
		start_node_id: "email",
		nodes: [{ id: "email", type: "email", template_id: templateId }],
		edges: [],
	});
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO subscribers (id,project_id,email,status,consent_status) VALUES (?,501,?,'unsubscribed','revoked')",
		).bind(id, id + "@example.test"),
		env.DB.prepare(
			"INSERT INTO suppressions (id,project_id,email,reason,source) VALUES (?,501,?,?,'test')",
		).bind(id, id + "@example.test", reason),
		env.DB.prepare(
			"INSERT INTO marketing_journeys (id,project_id,name,status,trigger_event_name,definition_json,created_by) VALUES (?,501,?,'active','test.event',?,'test')",
		).bind(id, id, definition),
		env.DB.prepare(
			"INSERT INTO marketing_journey_versions (project_id,journey_id,version,trigger_json,definition_json,published_by) VALUES (501,?,1,'{}',?,'test')",
		).bind(id, definition),
		env.DB.prepare(
			"INSERT INTO marketing_journey_enrollments (id,project_id,journey_id,journey_version,subscriber_id,deduplication_key,current_node_id,next_run_at) VALUES (?,501,?,1,?,?,'email','2020-01-01T00:00:00Z')",
		).bind(id, id, id, id),
	]);
	let sent = 0;
	const deliveryEnv = {
		...env,
		EMAIL_SERVICE: {
			fetch: async (url: string) => {
				if (url.includes("/senders"))
					return Response.json({
						configured: true,
						items: [
							{
								id: "test",
								publicConfig: {
									host: "smtp.example.test",
									port: 587,
									from_email: "test@example.test",
								},
							},
						],
					});
				sent++;
				return Response.json({ status: "sent", id, messageId: id, response: "250 OK" });
			},
		},
	} as unknown as Env;
	await advanceJourneyEnrollment(deliveryEnv, {
		type: "marketing.journey.advance",
		projectId: 501,
		enrollmentId: id,
	});
	expect(
		await env.DB.prepare("SELECT status FROM marketing_journey_deliveries WHERE enrollment_id=?")
			.bind(id)
			.first("status"),
	).toBe(expected);
	expect(sent).toBe(expected === "sent" ? 1 : 0);
});

it("scopes message statistics to the selected template across campaigns and event deliveries", async () => {
	const selected = await createTemplate(createEmailDesign("en", "campaign"));
	const other = await createTemplate(createEmailDesign("en", "campaign"));
	for (const [id, templateId, resourceId] of [
		["selected-event", selected, selected],
		["selected-campaign", selected, "campaign-selected"],
		["other-event", other, other],
	] as const) {
		if (resourceId !== templateId) {
			await env.DB.prepare(
				"INSERT INTO campaigns (id,project_id,name,subject,template_id,status) VALUES (?,501,'Campaign','Subject',?,'finished')",
			)
				.bind(resourceId, templateId)
				.run();
			await env.DB.prepare(
				"INSERT INTO subscribers (id,project_id,email,status) VALUES ('stats-contact',501,'stats@example.test','enabled')",
			).run();
			await env.DB.prepare(
				"INSERT INTO email_deliveries (id,project_id,campaign_id,subscriber_id,recipient_email,status) VALUES (?,501,?,'stats-contact','stats@example.test','sent')",
			)
				.bind(id, resourceId)
				.run();
		}
		await env.DB.prepare(
			"INSERT INTO email_studio_deliveries (project_id,delivery_id,resource_id,purpose,locale,requested_locale,reason,revision,subject,content_html,content_text) VALUES (501,?,?,'campaign','en','en','exact',1,'Subject','<p>Hello</p>','Hello')",
		)
			.bind(id, resourceId)
			.run();
	}
	const result = await request("/statistics?template_id=" + selected);
	expect(result.status).toBe(200);
	expect(await result.json()).toMatchObject({ data: { totals: { messages: 2, sent: 1 } } });
	const deliveries = await request("/deliveries?template_id=" + selected);
	const data = await deliveries.json<{ data: { items: Array<{ delivery_id: string }> } }>();
	expect(data.data.items.map((item) => item.delivery_id).sort()).toEqual([
		"selected-campaign",
		"selected-event",
	]);
	expect(
		await (await request("/statistics?template_id=" + selected, "GET", undefined, 502)).json(),
	).toMatchObject({ data: { totals: { messages: 0 } } });
});

async function request(path: string, method = "GET", body?: unknown, projectId = 501) {
	const url = new URL("/internal/v1/studio" + path, "https://marketing.internal");
	const headers = await createProjectContextHeaders(
		{
			module: "marketing",
			method,
			pathname: url.pathname,
			projectId,
			projectRef: "10-test",
			instanceId: 10,
			environment: "test",
			actorId: 2,
			role: "owner",
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		"marketing-runtime-secret",
	);
	headers.set("content-type", "application/json");
	headers.set("Idempotency-Key", crypto.randomUUID());
	return SELF.fetch(
		new Request(url, {
			method,
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}),
	);
}
async function createTemplate(document: EmailDesign) {
	const url = new URL("/internal/v1/templates", "https://marketing.internal");
	const headers = await createProjectContextHeaders(
		{
			module: "marketing",
			method: "POST",
			pathname: url.pathname,
			projectId: 501,
			projectRef: "10-test",
			instanceId: 10,
			environment: "test",
			actorId: 2,
			role: "owner",
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		"marketing-runtime-secret",
	);
	headers.set("content-type", "application/json");
	headers.set("Idempotency-Key", crypto.randomUUID());
	const response = await SELF.fetch(
		new Request(url, {
			method: "POST",
			headers,
			body: JSON.stringify({
				name: crypto.randomUUID(),
				studio_document: document,
				expected_revision: 0,
			}),
		}),
	);
	expect(response.status).toBe(201);
	return (await response.json<{ data: { id: string } }>()).data.id;
}

it("updates shared content in drafts while retaining the published message", async () => {
	const created = await request("/blocks", "POST", {
		name: "Footer",
		locale: "en",
		block: { id: "footer", type: "text", text: "Original footer" },
	});
	expect(created.status).toBe(201);
	const shared = (
		await created.json<{ data: { id: string; revision: number; document: EmailDesign } }>()
	).data;
	const template = createEmailDesign("en", "notification");
	template.locales.en!.blocks = [
		{ id: "footer", type: "text", text: "Original footer", shared_id: shared.id },
	];
	template.locales.en!.status = "approved";
	const id = await createTemplate(template);
	expect(
		(await request("/templates/" + id + "/publish", "POST", { expected_revision: 1 })).status,
	).toBe(200);
	shared.document.locales.en!.blocks[0]!.text = "New footer";
	expect(
		(
			await request("/blocks/" + shared.id, "PUT", {
				document: shared.document,
				expected_revision: 1,
			})
		).status,
	).toBe(200);
	const usage = await request("/blocks/" + shared.id + "/usage");
	expect(
		(await usage.json<{ data: Array<{ id: string }> }>()).data.map((item) => item.id),
	).toContain(id);
	const applied = await request("/blocks/" + shared.id + "/apply", "POST", { template_ids: [id] });
	expect(await applied.json()).toMatchObject({ data: { updated: [id], conflicts: [] } });
	const history = await request("/templates/" + id + "/history");
	const versions = (await history.json<{ data: Array<{ document: EmailDesign }> }>()).data;
	expect(versions[0]!.document.locales.en!.blocks[0]!.text).toBe("New footer");
	const published = await request("/templates/" + id + "/published");
	expect(
		(await published.json<{ data: { document: EmailDesign } }>()).data.document.locales.en!
			.blocks[0]!.text,
	).toBe("Original footer");
});

it("retains the translation key without returning it or accepting an implicit provider change", async () => {
	const settings = {
		locales: ["en", "fr"],
		fallback_locale: "en",
		marketing_frequency_hours: 24,
		glossary: [],
		ai_provider: {
			url: "https://provider.example/v1/responses",
			model: "configured-model",
			api_key: "private-test-key",
		},
	};
	const saved = await request("/settings", "PUT", settings);
	expect(saved.status).toBe(200);
	expect(await saved.text()).not.toContain("private-test-key");
	const read = await request("/settings");
	const body = await read.json<{ data: Record<string, unknown> }>();
	expect(body.data.ai_provider).toEqual({
		url: settings.ai_provider.url,
		model: "configured-model",
		configured: true,
	});
	expect(JSON.stringify(body)).not.toContain("encrypted");
	const changed = await request("/settings", "PUT", {
		...settings,
		ai_provider: { url: "https://another.example/v1/responses", model: "configured-model" },
	});
	expect(changed.status).toBe(422);
	const other = await request("/settings", "GET", undefined, 502);
	expect(await other.json()).toMatchObject({ data: { ai_provider: null } });
});

it("freezes the actual transport body and keeps list responses small and scoped", async () => {
	const id = crypto.randomUUID();
	let renders = 0;
	const first = await freezeDeliveryMessage(
		env.DB,
		501,
		id,
		async () => {
			renders++;
			return {
				to: "alex@example.test",
				subject: "Bonjour",
				html: "<p>Version originale</p>",
				text: "Version originale",
			};
		},
		"notification",
		"fr",
	);
	const replay = await freezeDeliveryMessage(
		env.DB,
		501,
		id,
		async () => {
			renders++;
			return { to: "other@example.test", subject: "Changed", html: null, text: "Changed" };
		},
		"notification",
		"en",
	);
	expect(replay).toEqual(first);
	expect(renders).toBe(1);
	const listed = await request("/deliveries?locale=fr");
	const items = (await listed.json<{ data: { items: Array<Record<string, unknown>> } }>()).data
		.items;
	expect(items.find((item) => item.delivery_id === id)).toMatchObject({
		locale: "fr",
		subject: "Bonjour",
		recipient_email: "alex@example.test",
	});
	expect(items[0]).not.toHaveProperty("content_html");
	const detail = await request("/deliveries/" + id);
	expect(await detail.json()).toMatchObject({
		data: { content_html: "<p>Version originale</p>", render_available: true },
	});
	expect((await request("/deliveries/" + id, "GET", undefined, 502)).status).toBe(404);
	const statistics = await request("/statistics?locale=fr");
	expect(await statistics.json()).toMatchObject({ data: { totals: { messages: 1, sent: 0 } } });
});
