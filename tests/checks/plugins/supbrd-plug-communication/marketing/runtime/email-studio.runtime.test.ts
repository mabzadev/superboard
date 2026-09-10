import { createEmailDesign, type EmailDesign } from "@superboard/contracts/email-studio";
import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";

import { freezeDeliveryMessage } from "../../../../../../packages/plugins/supbrd-plug-communication/marketing/src/delivery-records.js";

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
