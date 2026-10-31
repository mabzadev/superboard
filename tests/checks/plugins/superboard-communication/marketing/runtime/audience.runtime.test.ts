import {
	signProjectContext,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { renderDoubleOptInMessage } from "../../../../../../packages/plugins/superboard-communication/marketing/src/optin";
import { preferencesUrl } from "../../../../../../packages/plugins/superboard-communication/marketing/src/preferences";
import { dispatchCampaign } from "../../../../../../packages/plugins/superboard-communication/marketing/src/queue";
import { trackingToken } from "../../../../../../packages/plugins/superboard-communication/marketing/src/tracking";

const secret = "marketing-runtime-secret";

async function signedRequest(path: string, projectId: number, method = "GET", body?: unknown) {
	const context: InternalProjectContext = {
		module: "marketing",
		method,
		pathname: path.split("?")[0]!,
		projectId,
		projectRef: "10-prod",
		instanceId: 10,
		environment: "production",
		actorId: 2,
		role: "owner",
		requestId: crypto.randomUUID(),
		issuedAt: Math.floor(Date.now() / 1000),
	};
	const headers = new Headers({
		"content-type": "application/json",
		"x-internal-token": secret,
		"x-project-id": String(projectId),
		"x-project-ref": context.projectRef,
		"x-instance-id": "10",
		"x-environment": context.environment,
		"x-actor-id": String(context.actorId),
		"x-role": "owner",
		"x-request-id": context.requestId,
		"x-context-issued-at": String(context.issuedAt),
		"x-context-version": "1",
		"x-context-signature": await signProjectContext(context, secret),
	});
	if (method !== "GET") headers.set("idempotency-key", crypto.randomUUID());
	return new Request(`https://marketing.internal${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function call<T>(path: string, projectId: number, method = "GET", body?: unknown) {
	const response = await SELF.fetch(await signedRequest(path, projectId, method, body));
	return {
		status: response.status,
		body: (await response.json()) as { data: T; error?: { code: string; details?: unknown } },
	};
}

async function contact(projectId: number, email: string, extra: Record<string, unknown> = {}) {
	const created = await call<{ id: string }>("/internal/v1/email/subscribers", projectId, "POST", {
		email,
		...extra,
	});
	expect(created.status).toBe(201);
	return created.body.data.id;
}

function publicForm(
	path: string,
	fields: Record<string, string | string[]>,
	headers: Record<string, string> = {},
) {
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(fields))
		for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
	return SELF.fetch(`https://marketing.internal${path}`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
		body,
		redirect: "manual",
	});
}

describe("Audience tags", () => {
	it("creates tags, bulk-assigns them by name, filters contacts and removes them", async () => {
		const project = 701;
		const first = await contact(project, "tag-a@example.com");
		const second = await contact(project, "tag-b@example.com");
		await contact(project, "tag-c@example.com");

		const vip = await call<{ id: string; name: string }>(
			"/internal/v1/audience/tags",
			project,
			"POST",
			{
				name: "VIP",
				color: "#16a34a",
			},
		);
		expect(vip.status).toBe(201);
		expect(
			(await call("/internal/v1/audience/tags", project, "POST", { name: "vip" })).status,
		).toBe(409);

		const assigned = await call<{ tag_ids: string[]; subscribers: number }>(
			"/internal/v1/audience/tags/assign",
			project,
			"POST",
			{
				subscriber_ids: [first, second, "foreign-id"],
				tag_ids: [vip.body.data.id],
				tag_names: ["Beta"],
			},
		);
		expect(assigned.status).toBe(200);
		expect(assigned.body.data.subscribers).toBe(2);
		expect(assigned.body.data.tag_ids).toHaveLength(2);

		const tags = await call<Array<{ name: string; subscriber_count: number }>>(
			"/internal/v1/audience/tags",
			project,
		);
		expect(tags.body.data.map((tag) => [tag.name, tag.subscriber_count])).toEqual([
			["Beta", 2],
			["VIP", 2],
		]);

		const filtered = await call<Array<{ email: string; tag_ids: string[] }>>(
			`/internal/v1/email/subscribers?tag_id=${vip.body.data.id}`,
			project,
		);
		expect(filtered.body.data.map((row) => row.email).sort()).toEqual([
			"tag-a@example.com",
			"tag-b@example.com",
		]);
		expect(filtered.body.data[0]!.tag_ids).toContain(vip.body.data.id);

		await call("/internal/v1/audience/tags/assign", project, "POST", {
			subscriber_ids: [first],
			tag_ids: [vip.body.data.id],
			action: "remove",
		});
		const single = await call<{ tag_ids: string[]; list_ids: string[] }>(
			`/internal/v1/email/subscribers/${first}`,
			project,
		);
		expect(single.body.data.tag_ids).not.toContain(vip.body.data.id);
		expect(single.body.data.tag_ids).toHaveLength(1);

		// Another project never sees these tags.
		expect((await call<unknown[]>("/internal/v1/audience/tags", project + 1)).body.data).toEqual(
			[],
		);
		expect(
			(await call(`/internal/v1/audience/tags/${vip.body.data.id}`, project + 1, "DELETE")).status,
		).toBe(404);
		expect(
			(await call(`/internal/v1/audience/tags/${vip.body.data.id}`, project, "DELETE")).status,
		).toBe(200);
	});
});

describe("Custom fields", () => {
	it("validates and coerces contact attributes against project definitions", async () => {
		const project = 702;
		const plan = await call<{ id: string; key: string }>(
			"/internal/v1/audience/fields",
			project,
			"POST",
			{
				key: "plan",
				label: "Plan",
				field_type: "select",
				options: ["Free", "Pro"],
			},
		);
		expect(plan.status).toBe(201);
		await call("/internal/v1/audience/fields", project, "POST", {
			key: "seats",
			label: "Seats",
			field_type: "number",
		});
		expect(
			(
				await call("/internal/v1/audience/fields", project, "POST", {
					key: "email",
					label: "Email",
				})
			).body.error?.code,
		).toBe("key_reserved");

		const invalid = await call("/internal/v1/email/subscribers", project, "POST", {
			email: "fields@example.com",
			attributes: { plan: "Enterprise" },
		});
		expect(invalid.status).toBe(422);
		expect(invalid.body.error?.code).toBe("attributes_invalid");

		const created = await call<{ id: string; attributes: Record<string, unknown> }>(
			"/internal/v1/email/subscribers",
			project,
			"POST",
			{ email: "fields@example.com", attributes: { plan: "pro", seats: "12", locale: "fr" } },
		);
		expect(created.status).toBe(201);
		expect(created.body.data.attributes).toEqual({ plan: "Pro", seats: 12, locale: "fr" });

		const patched = await call(
			`/internal/v1/email/subscribers/${created.body.data.id}`,
			project,
			"PATCH",
			{
				attributes: { seats: "many" },
			},
		);
		expect(patched.status).toBe(422);

		const fields = await call<Array<{ key: string; field_type: string }>>(
			"/internal/v1/audience/fields",
			project,
		);
		expect(fields.body.data.map((field) => field.key)).toEqual(["plan", "seats"]);
		expect(
			(await call(`/internal/v1/audience/fields/${plan.body.data.id}`, project, "DELETE")).status,
		).toBe(200);
	});
});

describe("Dynamic segments", () => {
	it("evaluates engagement, tag and list conditions and recomputes before a send", async () => {
		const project = 703;
		const opener = await contact(project, "opener@example.com");
		const sleeper = await contact(project, "sleeper@example.com");
		const campaignId = crypto.randomUUID();
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO campaigns (id, project_id, name, subject, status, tracking_enabled) VALUES (?, ?, 'Past', 'Past', 'finished', 1)",
			).bind(campaignId, project),
			env.DB.prepare(
				`INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, event_type, occurred_at)
         VALUES (?, ?, ?, ?, 'open', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'))`,
			).bind(crypto.randomUUID(), project, campaignId, opener),
			// SQLite-format timestamps from older rows are compared correctly too.
			env.DB.prepare(
				`INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, event_type, occurred_at)
         VALUES (?, ?, ?, ?, 'open', datetime('now', '-90 days'))`,
			).bind(crypto.randomUUID(), project, campaignId, sleeper),
		]);

		const engaged = await call<{ id: string; subscriber_count: number }>(
			"/internal/v1/segments",
			project,
			"POST",
			{
				name: "Engaged",
				rules: {
					mode: "all",
					conditions: [{ field: "activity.opened", operator: "within_days", value: 30 }],
				},
			},
		);
		expect(engaged.status).toBe(201);
		expect(engaged.body.data.subscriber_count).toBe(1);

		const inactive = await call<{ subscriber_count: number }>(
			"/internal/v1/audience/segments/preview",
			project,
			"POST",
			{
				rules: {
					mode: "all",
					conditions: [
						{
							field: "activity.opened",
							operator: "not_within_days",
							value: 30,
							campaign_id: campaignId,
						},
					],
				},
			},
		);
		expect(inactive.body.data.subscriber_count).toBe(1);

		const tag = await call<{ id: string }>("/internal/v1/audience/tags", project, "POST", {
			name: "Customer",
		});
		const list = await call<{ id: string }>("/internal/v1/lists", project, "POST", {
			name: "News",
		});
		await call("/internal/v1/audience/tags/assign", project, "POST", {
			subscriber_ids: [sleeper],
			tag_ids: [tag.body.data.id],
		});
		await call(`/internal/v1/lists/${list.body.data.id}/subscribers/${opener}`, project, "PUT", {});
		const combined = await call<{ subscriber_count: number }>(
			"/internal/v1/audience/segments/preview",
			project,
			"POST",
			{
				rules: {
					mode: "any",
					conditions: [
						{ field: "tag", operator: "has", value: tag.body.data.id },
						{ field: "list", operator: "member", value: list.body.data.id },
					],
				},
			},
		);
		expect(combined.body.data.subscriber_count).toBe(2);
		expect(
			(
				await call("/internal/v1/audience/segments/preview", project, "POST", {
					rules: { conditions: [{ field: "tag", operator: "has", value: "missing" }] },
				})
			).status,
		).toBe(404);

		// A contact who starts engaging after the segment was saved still receives the campaign.
		const late = await contact(project, "late@example.com");
		await env.DB.prepare(
			`INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, event_type)
       VALUES (?, ?, ?, ?, 'click')`,
		)
			.bind(crypto.randomUUID(), project, campaignId, late)
			.run();
		await env.DB.prepare(
			`INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, event_type)
       VALUES (?, ?, ?, ?, 'open')`,
		)
			.bind(crypto.randomUUID(), project, campaignId, late)
			.run();
		const send = crypto.randomUUID();
		await env.DB.prepare(
			`INSERT INTO campaigns (id, project_id, name, subject, status, tracking_enabled, segment_ids_json)
       VALUES (?, ?, 'Engaged send', 'Hi', 'scheduled', 0, ?)`,
		)
			.bind(send, project, JSON.stringify([engaged.body.data.id]))
			.run();
		const dispatched = await dispatchCampaign(env, {
			type: "marketing.campaign.dispatch",
			projectId: project,
			campaignId: send,
		});
		expect(dispatched).toMatchObject({ dispatched: true, queued: 2 });
		const recipients = await env.DB.prepare(
			"SELECT recipient_email FROM email_deliveries WHERE campaign_id = ? ORDER BY recipient_email",
		)
			.bind(send)
			.all<{ recipient_email: string }>();
		expect(recipients.results.map((row) => row.recipient_email)).toEqual([
			"late@example.com",
			"opener@example.com",
		]);
	});
});

describe("CSV import with mapping", () => {
	it("requires an explicit consent choice and reports created, updated and skipped rows", async () => {
		const project = 704;
		const existing = await contact(project, "existing@example.com", { name: "Before" });
		await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE id = ?")
			.bind(existing)
			.run();
		await call("/internal/v1/audience/fields", project, "POST", {
			key: "company",
			label: "Company",
			field_type: "text",
		});
		await call("/internal/v1/audience/fields", project, "POST", {
			key: "seats",
			label: "Seats",
			field_type: "number",
		});
		await call("/internal/v1/suppressions", project, "POST", { email: "blocked@example.com" });
		const list = await call<{ id: string }>("/internal/v1/lists", project, "POST", {
			name: "Imported",
		});
		const rows = [
			{
				line: 2,
				email: "new@example.com",
				name: "New",
				locale: "fr",
				tags: "Lead, Trade show",
				consent: "yes",
				attributes: { company: "Acme", seats: "4" },
			},
			{ line: 3, email: "EXISTING@example.com", name: "After", consent: "yes", attributes: {} },
			{ line: 4, email: "no-consent@example.com", consent: "no" },
			{ line: 5, email: "not-an-email", consent: "yes" },
			{ line: 6, email: "new@example.com", consent: "yes" },
			{ line: 7, email: "blocked@example.com", consent: "yes" },
			{ line: 8, email: "bad-field@example.com", consent: "yes", attributes: { seats: "lots" } },
		];
		const refused = await call("/internal/v1/audience/imports", project, "POST", {
			rows,
			consent: "column",
		});
		expect(refused.status).toBe(422);
		expect(refused.body.error?.code).toBe("consent_confirmation_required");
		expect((await call("/internal/v1/audience/imports", project, "POST", { rows })).status).toBe(
			422,
		);

		const imported = await call<{
			created: number;
			updated: number;
			skipped: number;
			skipped_by_reason: Record<string, number>;
			skipped_rows: Array<{ line: number; reason: string }>;
		}>("/internal/v1/audience/imports", project, "POST", {
			rows,
			consent: "column",
			consent_confirmed: true,
			list_ids: [list.body.data.id],
		});
		expect(imported.status).toBe(200);
		expect(imported.body.data).toMatchObject({
			created: 1,
			updated: 1,
			skipped: 5,
			skipped_by_reason: {
				no_consent: 1,
				invalid_email: 1,
				duplicate: 1,
				suppressed: 1,
				invalid_field: 1,
			},
		});
		expect(imported.body.data.skipped_rows.map((row) => [row.line, row.reason])).toEqual([
			[5, "invalid_email"],
			[6, "duplicate"],
			[8, "invalid_field"],
			[4, "no_consent"],
			[7, "suppressed"],
		]);
		const created = await env.DB.prepare(
			"SELECT id, consent_status, consent_source, attributes_json FROM subscribers WHERE project_id = ? AND email = 'new@example.com'",
		)
			.bind(project)
			.first<{
				id: string;
				consent_status: string;
				consent_source: string;
				attributes_json: string;
			}>();
		expect(created).toMatchObject({ consent_status: "confirmed", consent_source: "import" });
		expect(JSON.parse(created!.attributes_json)).toEqual({
			company: "Acme",
			seats: 4,
			locale: "fr",
		});
		const updated = await call<{ name: string; status: string; list_ids: string[] }>(
			`/internal/v1/email/subscribers/${existing}`,
			project,
		);
		// Profile data is refreshed but a previous unsubscribe is never undone by an import.
		expect(updated.body.data).toMatchObject({
			name: "After",
			status: "unsubscribed",
			list_ids: [list.body.data.id],
		});
		const tags = await call<Array<{ name: string; subscriber_count: number }>>(
			"/internal/v1/audience/tags",
			project,
		);
		expect(tags.body.data.map((tag) => tag.name)).toEqual(["Lead", "Trade show"]);
	});

	it("imports more than a thousand rows and honours double opt-in lists", async () => {
		const project = 705;
		const list = await call<{ id: string }>("/internal/v1/lists", project, "POST", {
			name: "Confirmed only",
			optin_mode: "double",
		});
		const rows = Array.from({ length: 2_500 }, (_, index) => ({
			email: `bulk-${index}@example.com`,
		}));
		const imported = await call<{ created: number; confirmation_sent: number }>(
			"/internal/v1/audience/imports",
			project,
			"POST",
			{ rows, consent: "confirmed", consent_confirmed: true, list_ids: [list.body.data.id] },
		);
		expect(imported.status).toBe(200);
		expect(imported.body.data).toMatchObject({ created: 2_500, confirmation_sent: 2_500 });
		await expect(
			env.DB.prepare(
				"SELECT COUNT(*) total, SUM(consent_status = 'pending') pending, SUM(optin_token_hash IS NOT NULL) tokens FROM subscribers WHERE project_id = ?",
			)
				.bind(project)
				.first(),
		).resolves.toMatchObject({ total: 2_500, pending: 2_500, tokens: 2_500 });
		await expect(
			env.DB.prepare(
				"SELECT COUNT(*) total FROM marketing_outbox WHERE project_id = ? AND job_type = 'double_optin'",
			)
				.bind(project)
				.first(),
		).resolves.toMatchObject({ total: 2_500 });
		await expect(
			env.DB.prepare("SELECT COUNT(*) total FROM subscriber_list_memberships WHERE project_id = ?")
				.bind(project)
				.first(),
		).resolves.toMatchObject({ total: 2_500 });
	});
});

describe("Double opt-in", () => {
	it("keeps the historical email by default and applies the customized copy per language", async () => {
		const project = 706;
		const url = "https://api.example.test/v1/communication/marketing/opt-in/token";
		expect(
			await renderDoubleOptInMessage(env.DB, project, { name: "Ada", locale: "en" }, url),
		).toEqual({
			subject: "Confirm your subscription",
			text: `Confirm your subscription: ${url}`,
			html: `<p>Confirm your subscription</p><p><a href="${url}">Confirm subscription</a></p>`,
		});
		const saved = await call<{ customized: boolean; fr: { subject: string } }>(
			"/internal/v1/audience/double-opt-in",
			project,
			"PUT",
			{
				en: {},
				fr: {
					subject: "Bienvenue {{name}}",
					heading: "Un dernier clic",
					body: "Merci <3",
					button_label: "Je confirme",
				},
			},
		);
		expect(saved.body.data).toMatchObject({
			customized: true,
			fr: { subject: "Bienvenue {{name}}" },
		});
		const french = await renderDoubleOptInMessage(
			env.DB,
			project,
			{ name: "<Zoé>", locale: "fr-CA" },
			url,
		);
		expect(french.subject).toBe("Bienvenue <Zoé>");
		expect(french.html).toBe(
			`<p>Un dernier clic</p><p>Merci &lt;3</p><p><a href="${url}">Je confirme</a></p>`,
		);
		expect(
			(await renderDoubleOptInMessage(env.DB, project, { name: null, locale: "en" }, url)).subject,
		).toBe("Confirm your subscription");
	});

	it("asks new contacts added to a double opt-in list to confirm", async () => {
		const project = 707;
		const list = await call<{ id: string }>("/internal/v1/lists", project, "POST", {
			name: "Double",
			optin_mode: "double",
		});
		const created = await call<{ consent_status: string; confirmation_required: boolean }>(
			"/internal/v1/email/subscribers",
			project,
			"POST",
			{ email: "list-doi@example.com", list_ids: [list.body.data.id] },
		);
		expect(created.body.data).toMatchObject({
			consent_status: "pending",
			confirmation_required: true,
		});
	});
});

describe("Hosted preference center", () => {
	it("replaces the static unsubscribe page and lets contacts manage public lists", async () => {
		const project = 708;
		const subscriberId = await contact(project, "prefs@example.com", {
			attributes: { locale: "fr" },
		});
		const news = await call<{ id: string }>("/internal/v1/lists", project, "POST", {
			name: "Actualités",
			visibility: "public",
		});
		const tips = await call<{ id: string }>("/internal/v1/lists", project, "POST", {
			name: "Astuces",
			visibility: "public",
		});
		await call<{ id: string }>("/internal/v1/lists", project, "POST", {
			name: "Interne",
			visibility: "private",
		});
		const campaignId = crypto.randomUUID();
		const deliveryId = crypto.randomUUID();
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO campaigns (id, project_id, name, subject, status) VALUES (?, ?, 'C', 'C', 'running')",
			).bind(campaignId, project),
			env.DB.prepare(
				"INSERT INTO email_deliveries (id, project_id, campaign_id, subscriber_id, recipient_email, status) VALUES (?, ?, ?, ?, 'prefs@example.com', 'sent')",
			).bind(deliveryId, project, campaignId, subscriberId),
		]);

		const link = await preferencesUrl(env, project, subscriberId);
		const path = new URL(link).pathname.replace("/v1/communication/marketing/", "/public/v1/");
		const page = await SELF.fetch(`https://marketing.internal${path}`);
		expect(page.status).toBe(200);
		const html = await page.text();
		expect(html).toContain("Préférences e-mail");
		expect(html).toContain("Actualités");
		expect(html).not.toContain("Interne");

		expect(
			(await publicForm(path, { action: "save", list: [news.body.data.id, tips.body.data.id] }))
				.status,
		).toBe(200);
		await expect(
			env.DB.prepare(
				"SELECT COUNT(*) total FROM subscriber_list_memberships WHERE subscriber_id = ?",
			)
				.bind(subscriberId)
				.first(),
		).resolves.toMatchObject({ total: 2 });
		await publicForm(path, { action: "save", list: news.body.data.id });
		await expect(
			env.DB.prepare("SELECT list_id FROM subscriber_list_memberships WHERE subscriber_id = ?")
				.bind(subscriberId)
				.all(),
		).resolves.toMatchObject({ results: [{ list_id: news.body.data.id }] });

		// The footer unsubscribe link still unsubscribes and now lands on the preference center.
		const unsubscribe = await trackingToken(env, {
			projectId: project,
			deliveryId,
			subscriberId,
			campaignId,
			action: "unsubscribe",
		});
		const landing = await SELF.fetch(
			`https://marketing.internal/public/v1/tracking/unsubscribe/${unsubscribe}`,
		);
		expect(landing.status).toBe(200);
		const landingHtml = await landing.text();
		expect(landingHtml).toContain("Vous êtes désabonné");
		expect(landingHtml).toContain('value="resubscribe"');
		const oneClick = await SELF.fetch(
			`https://marketing.internal/public/v1/tracking/unsubscribe/${unsubscribe}`,
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: "List-Unsubscribe=One-Click",
			},
		);
		await expect(oneClick.json()).resolves.toEqual({ data: { unsubscribed: true } });

		const resubscribed = await publicForm(path, { action: "resubscribe" });
		expect(await resubscribed.text()).toContain("Bon retour");
		await expect(
			env.DB.prepare("SELECT status FROM subscribers WHERE id = ?").bind(subscriberId).first(),
		).resolves.toMatchObject({ status: "enabled" });
		await expect(
			env.DB.prepare(
				"SELECT COUNT(*) total FROM suppressions WHERE project_id = ? AND email = 'prefs@example.com'",
			)
				.bind(project)
				.first(),
		).resolves.toMatchObject({ total: 0 });

		await publicForm(path, { action: "unsubscribe" });
		await expect(
			env.DB.prepare("SELECT status FROM subscribers WHERE id = ?").bind(subscriberId).first(),
		).resolves.toMatchObject({ status: "unsubscribed" });

		const forged = `${path.slice(0, -4)}abcd`;
		expect((await SELF.fetch(`https://marketing.internal${forged}`)).status).toBe(404);
	});

	it("never resubscribes bounced or blocked addresses", async () => {
		const project = 709;
		const subscriberId = await contact(project, "bounced@example.com");
		await env.DB.batch([
			env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE id = ?").bind(
				subscriberId,
			),
			env.DB.prepare(
				"INSERT INTO suppressions (id, project_id, email, reason, source) VALUES (?, ?, 'bounced@example.com', 'hard_bounce', 'provider')",
			).bind(crypto.randomUUID(), project),
		]);
		const path = new URL(await preferencesUrl(env, project, subscriberId)).pathname.replace(
			"/v1/communication/marketing/",
			"/public/v1/",
		);
		const response = await publicForm(path, { action: "resubscribe" }, { "accept-language": "en" });
		expect(await response.text()).toContain("cannot be resubscribed");
		await expect(
			env.DB.prepare("SELECT status FROM subscribers WHERE id = ?").bind(subscriberId).first(),
		).resolves.toMatchObject({ status: "unsubscribed" });
	});
});

describe("Embeddable signup forms", () => {
	it("serves snippets, accepts submissions with double opt-in and blocks spam", async () => {
		const project = 710;
		const list = await call<{ id: string }>("/internal/v1/lists", project, "POST", {
			name: "Newsletter",
		});
		await call("/internal/v1/audience/fields", project, "POST", {
			key: "role",
			label: "Role",
			field_type: "select",
			options: ["Developer", "Marketer"],
		});
		const created = await call<{ id: string; settings: { double_opt_in: boolean } }>(
			"/internal/v1/audience/forms",
			project,
			"POST",
			{
				name: "Footer",
				list_ids: [list.body.data.id],
				fields: [
					{ key: "name", required: true },
					{ key: "role", required: false },
				],
				popup: { enabled: true, delay_seconds: 3 },
			},
		);
		expect(created.status).toBe(201);
		expect(created.body.data.settings.double_opt_in).toBe(true);
		const formId = created.body.data.id;
		expect(
			(
				await call("/internal/v1/audience/forms", project, "POST", {
					name: "Bad",
					fields: [{ key: "unknown" }],
				})
			).status,
		).toBe(422);

		const embed = await call<{ hosted_url: string; script_snippet: string; html_snippet: string }>(
			`/internal/v1/audience/forms/${formId}/embed`,
			project,
		);
		expect(embed.body.data.hosted_url).toBe(
			`https://api.example.test/v1/communication/marketing/forms/${formId}`,
		);
		expect(embed.body.data.script_snippet).toContain(`/forms/${formId}/embed.js`);
		expect(embed.body.data.html_snippet).toContain('name="f_role"');
		expect(embed.body.data.html_snippet).toContain('name="website"');

		const script = await SELF.fetch(
			`https://marketing.internal/public/v1/forms/${formId}/embed.js`,
		);
		expect(script.headers.get("content-type")).toContain("javascript");
		const source = await script.text();
		expect(source).toContain("sessionStorage");
		expect(source).not.toContain("</script>");
		const hosted = await SELF.fetch(`https://marketing.internal/public/v1/forms/${formId}`);
		expect(await hosted.text()).toContain('type="email"');

		const missingName = await publicForm(`/public/v1/forms/${formId}`, {
			email: "visitor@example.com",
		});
		expect(missingName.status).toBe(422);
		const accepted = await publicForm(
			`/public/v1/forms/${formId}`,
			{ email: "Visitor@Example.com", name: "Visitor", f_role: "developer", _embed: "1" },
			{ "cf-connecting-ip": "203.0.113.10" },
		);
		expect(accepted.status).toBe(200);
		expect(await accepted.text()).toContain("superboard-form");
		const visitor = await env.DB.prepare(
			"SELECT id, consent_status, consent_source, attributes_json FROM subscribers WHERE project_id = ? AND email = 'visitor@example.com'",
		)
			.bind(project)
			.first<{
				id: string;
				consent_status: string;
				consent_source: string;
				attributes_json: string;
			}>();
		expect(visitor).toMatchObject({ consent_status: "pending", consent_source: `form:${formId}` });
		expect(JSON.parse(visitor!.attributes_json)).toMatchObject({ role: "Developer" });
		await expect(
			env.DB.prepare("SELECT status FROM marketing_outbox WHERE project_id = ? AND resource_id = ?")
				.bind(project, visitor!.id)
				.first(),
		).resolves.toBeTruthy();
		await expect(
			env.DB.prepare("SELECT list_id FROM subscriber_list_memberships WHERE subscriber_id = ?")
				.bind(visitor!.id)
				.first(),
		).resolves.toMatchObject({ list_id: list.body.data.id });

		const bot = await publicForm(`/public/v1/forms/${formId}`, {
			email: "bot@example.com",
			name: "Bot",
			website: "https://spam.example",
		});
		expect(bot.status).toBe(200);
		await expect(
			env.DB.prepare(
				"SELECT COUNT(*) total FROM subscribers WHERE email = 'bot@example.com'",
			).first(),
		).resolves.toMatchObject({ total: 0 });

		const statuses: number[] = [];
		for (let attempt = 0; attempt < 9; attempt++)
			statuses.push(
				(
					await publicForm(
						`/public/v1/forms/${formId}`,
						{ email: `flood-${attempt}@example.com`, name: "Flood" },
						{ "cf-connecting-ip": "198.51.100.7" },
					)
				).status,
			);
		expect(statuses.slice(0, 8).every((status) => status === 200)).toBe(true);
		expect(statuses[8]).toBe(429);

		await call(`/internal/v1/audience/forms/${formId}`, project, "PATCH", { status: "disabled" });
		expect(
			(await publicForm(`/public/v1/forms/${formId}`, { email: "late@example.com", name: "Late" }))
				.status,
		).toBe(404);
	});

	it("subscribes directly with single opt-in and silently ignores blocked addresses", async () => {
		const project = 711;
		const form = await call<{ id: string }>("/internal/v1/audience/forms", project, "POST", {
			name: "Single",
			double_opt_in: false,
			fields: [],
			redirect_url: "https://example.com/thanks",
		});
		expect(form.body).toMatchObject({ data: { id: expect.any(String) } });
		const path = `/public/v1/forms/${form.body.data.id}`;
		const redirected = await publicForm(path, { email: "single@example.com" });
		expect(redirected.status).toBe(303);
		expect(redirected.headers.get("location")).toBe("https://example.com/thanks");
		await expect(
			env.DB.prepare(
				"SELECT consent_status FROM subscribers WHERE project_id = ? AND email = 'single@example.com'",
			)
				.bind(project)
				.first(),
		).resolves.toMatchObject({ consent_status: "confirmed" });

		const blocked = await contact(project, "blocked-form@example.com");
		await call(`/internal/v1/email/subscribers/${blocked}/blocklist`, project, "POST", {});
		const json = await SELF.fetch(`https://marketing.internal${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({ email: "blocked-form@example.com" }),
		});
		await expect(json.json()).resolves.toMatchObject({ data: { ok: true } });
		await expect(
			env.DB.prepare("SELECT status FROM subscribers WHERE id = ?").bind(blocked).first(),
		).resolves.toMatchObject({ status: "blocklisted" });

		// A contact who unsubscribed must confirm by email before coming back.
		const left = await contact(project, "left-form@example.com");
		await call(`/internal/v1/email/subscribers/${left}/unsubscribe`, project, "POST", {});
		await publicForm(path, { email: "left-form@example.com" });
		await expect(
			env.DB.prepare("SELECT status, consent_status FROM subscribers WHERE id = ?")
				.bind(left)
				.first(),
		).resolves.toMatchObject({ status: "unsubscribed", consent_status: "pending" });
	});
});
