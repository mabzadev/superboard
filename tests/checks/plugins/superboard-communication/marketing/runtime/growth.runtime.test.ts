import {
	signProjectContext,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import {
	createExecutionContext,
	createMessageBatch,
	env,
	getQueueResult,
	SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { selectDueAbWinners } from "../../../../../../packages/plugins/superboard-communication/marketing/src/ab-tests.js";
import {
	readBrandKit,
	readGrowthSettings,
} from "../../../../../../packages/plugins/superboard-communication/marketing/src/brand-kit.js";
import {
	processNativeEventOutbox,
	runDateTriggers,
} from "../../../../../../packages/plugins/superboard-communication/marketing/src/growth.js";
import {
	acceptMarketingSignal,
	advanceJourneyEnrollment,
} from "../../../../../../packages/plugins/superboard-communication/marketing/src/journeys.js";
import {
	dispatchCampaign,
	handleMarketingQueue,
} from "../../../../../../packages/plugins/superboard-communication/marketing/src/queue.js";
import {
	insertLocalTimeDeliveries,
	zonedLocalTimeToUtc,
} from "../../../../../../packages/plugins/superboard-communication/marketing/src/send-time.js";
import { trackingToken } from "../../../../../../packages/plugins/superboard-communication/marketing/src/tracking.js";

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
	return { status: response.status, body: (await response.json()) as { data: T } };
}

function systemProject(projectId: number) {
	return {
		projectId,
		projectRef: "10-prod",
		instanceId: 10,
		environment: "production" as const,
		actorId: 0,
		role: "system",
		requestId: crypto.randomUUID(),
		issuedAt: Math.floor(Date.now() / 1000),
	};
}

async function subscriber(
	projectId: number,
	email: string,
	attributes: Record<string, unknown> = {},
) {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO subscribers (id, project_id, email, name, status, attributes_json, consent_status, consent_source)
     VALUES (?, ?, ?, ?, 'enabled', ?, 'confirmed', 'test')`,
	)
		.bind(id, projectId, email, email.split("@")[0], JSON.stringify(attributes))
		.run();
	return id;
}

async function campaign(projectId: number, subject = "Hello") {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO campaigns (id, project_id, name, subject, content_text, status, tracking_enabled, updated_at)
     VALUES (?, ?, 'Growth', ?, 'Body', 'draft', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
	)
		.bind(id, projectId, subject)
		.run();
	return id;
}

async function delivery(
	projectId: number,
	campaignId: string,
	subscriberId: string,
	status = "sent",
) {
	const id = crypto.randomUUID();
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO email_deliveries (id, project_id, campaign_id, subscriber_id, recipient_email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
		).bind(id, projectId, campaignId, subscriberId, `${subscriberId}@example.com`, status),
		env.DB.prepare(
			`INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, delivery_id, event_type, occurred_at)
       VALUES (?, ?, ?, ?, ?, 'sent', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
		).bind(crypto.randomUUID(), projectId, campaignId, subscriberId, id),
	]);
	return id;
}

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean) {
	let value = await read();
	for (let attempt = 0; attempt < 40 && !accept(value); attempt++) {
		await new Promise((resolve) => {
			setTimeout(resolve, 50);
		});
		value = await read();
	}
	return value;
}

describe("Marketing brand kit and growth settings", () => {
	it("stores a validated brand kit with Studio defaults and exposes a read helper", async () => {
		const project = 8101;
		const initial = await call<{ font: string; colors: { accent: string } }>(
			"/internal/v1/brand-kit",
			project,
		);
		expect(initial.body.data).toMatchObject({
			font: "Arial, sans-serif",
			colors: { accent: "#2563eb" },
		});
		const saved = await call("/internal/v1/brand-kit", project, "PUT", {
			company_name: "Acme",
			logo_url: "https://cdn.example.com/logo.png",
			colors: { accent: "#FF5500" },
			font: "Helvetica, sans-serif",
			company_address: "1 Main Street, Paris",
			social_links: [{ network: "instagram", url: "https://instagram.com/acme" }],
		});
		expect(saved.status).toBe(200);
		await expect(readBrandKit(env.DB, project)).resolves.toMatchObject({
			company_name: "Acme",
			colors: { accent: "#ff5500", background: "#f4f4f5" },
			social_links: [{ network: "instagram" }],
		});
		expect(
			(
				await call("/internal/v1/brand-kit", project, "PUT", {
					logo_url: "http://cdn.example.com/x.png",
				})
			).status,
		).toBe(422);
		expect(
			(await call("/internal/v1/brand-kit", project, "PUT", { colors: { accent: "red" } })).status,
		).toBe(422);
		const settings = await call("/internal/v1/growth-settings", project, "PUT", {
			attribution_window_days: 14,
			default_time_zone: "Europe/Paris",
		});
		expect(settings.body.data).toEqual({
			attribution_window_days: 14,
			default_time_zone: "Europe/Paris",
		});
		expect(
			(
				await call("/internal/v1/growth-settings", project, "PUT", {
					default_time_zone: "Mars/Base",
				})
			).status,
		).toBe(422);
		await expect(readGrowthSettings(env.DB, 8199)).resolves.toEqual({
			attribution_window_days: 7,
			default_time_zone: "UTC",
		});
	});
});

describe("Marketing link analytics and deliverability rates", () => {
	it("reports unique and total clicks per link with CTR and engagement rates", async () => {
		const project = 8102;
		const campaignId = await campaign(project);
		const ids = await Promise.all(
			["a", "b", "c", "d"].map((name) => subscriber(project, `${name}@links.example.com`)),
		);
		const deliveries: string[] = [];
		for (const id of ids) deliveries.push(await delivery(project, campaignId, id));
		const click = async (index: number, target: string) => {
			const token = await trackingToken(env, {
				projectId: project,
				deliveryId: deliveries[index]!,
				subscriberId: ids[index]!,
				campaignId,
				action: "click",
				target,
			});
			const response = await SELF.fetch(
				`https://marketing.internal/public/v1/tracking/click/${token}`,
				{ redirect: "manual" },
			);
			expect(response.status).toBe(302);
		};
		await click(0, "https://example.com/pricing");
		await click(0, "https://example.com/pricing");
		await click(1, "https://example.com/pricing");
		await click(1, "https://example.com/blog");
		const unsubscribe = await trackingToken(env, {
			projectId: project,
			deliveryId: deliveries[2]!,
			subscriberId: ids[2]!,
			campaignId,
			action: "unsubscribe",
		});
		await SELF.fetch(`https://marketing.internal/public/v1/tracking/unsubscribe/${unsubscribe}`, {
			method: "POST",
		});
		expect(
			(
				await call("/internal/v1/provider-events", project, "POST", {
					event_type: "hard_bounce",
					delivery_id: deliveries[3],
				})
			).status,
		).toBe(202);

		const insights = await call<{
			engagement: Record<string, number>;
			links: Array<{
				url: string;
				unique_clicks: number;
				total_clicks: number;
				click_rate: number;
			}>;
		}>(`/internal/v1/insights/email?campaign_id=${campaignId}`, project);
		expect(insights.body.data.links).toEqual([
			{ url: "https://example.com/pricing", unique_clicks: 2, total_clicks: 3, click_rate: 50 },
			{ url: "https://example.com/blog", unique_clicks: 1, total_clicks: 1, click_rate: 25 },
		]);
		expect(insights.body.data.engagement).toMatchObject({
			sent: 4,
			unique_clicks: 2,
			click_rate: 50,
			unsubscribes: 1,
			unsubscribe_rate: 25,
			bounces: 1,
			bounce_rate: 25,
			complaint_rate: 0,
		});

		const statistics = await call<{ totals: Record<string, number> }>(
			`/internal/v1/statistics?campaign_id=${campaignId}`,
			project,
		);
		expect(statistics.body.data.totals).toMatchObject({
			unsubscribe_rate: 25,
			bounce_rate: 25,
			complaint_rate: 0,
			bounces: 1,
		});
	});
});

describe("Marketing A/B tests", () => {
	it("tests variants on a sample, picks the winner and sends it to everyone else", async () => {
		const project = 8103;
		const campaignId = await campaign(project, "Original subject");
		for (let index = 0; index < 10; index++) await subscriber(project, `ab${index}@example.com`);
		const invalid = await call(`/internal/v1/campaigns/${campaignId}/ab-test`, project, "PUT", {
			variants: [{ subject: "Only one" }],
		});
		expect(invalid.status).toBe(422);
		const configured = await call<{ status: string; variants: Array<{ id: string }> }>(
			`/internal/v1/campaigns/${campaignId}/ab-test`,
			project,
			"PUT",
			{
				variants: [{ subject: "Variant A" }, { subject: "Variant B" }],
				test_percent: 50,
				winner_metric: "open_rate",
				test_duration_minutes: 30,
			},
		);
		expect(configured.status).toBe(200);
		expect(configured.body.data).toMatchObject({
			status: "pending",
			variants: [{ id: "a" }, { id: "b" }],
		});
		expect(
			(
				await call(`/internal/v1/campaigns/${campaignId}/local-schedule`, project, "POST", {
					local_send_at: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 16),
				})
			).status,
		).toBe(409);

		await env.DB.prepare("UPDATE campaigns SET status='running' WHERE id=?").bind(campaignId).run();
		await dispatchCampaign(env, {
			type: "marketing.campaign.dispatch",
			projectId: project,
			campaignId,
		});
		const test = await env.DB.prepare(
			"SELECT id, variant_id, variant_phase, subscriber_id FROM email_deliveries WHERE campaign_id=? ORDER BY variant_id",
		)
			.bind(campaignId)
			.all<{ id: string; variant_id: string; variant_phase: string; subscriber_id: string }>();
		expect(test.results).toHaveLength(5);
		expect(test.results.filter((row) => row.variant_id === "a")).toHaveLength(3);
		expect(test.results.filter((row) => row.variant_id === "b")).toHaveLength(2);
		expect(new Set(test.results.map((row) => row.variant_phase))).toEqual(new Set(["test"]));
		await expect(
			env.DB.prepare("SELECT status FROM marketing_campaign_ab_tests WHERE campaign_id=?")
				.bind(campaignId)
				.first(),
		).resolves.toMatchObject({ status: "testing" });

		await env.DB.prepare("UPDATE email_deliveries SET status='sent' WHERE campaign_id=?")
			.bind(campaignId)
			.run();
		for (const row of test.results.filter((item) => item.variant_id === "b"))
			await env.DB.prepare(
				"INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, delivery_id, event_type) VALUES (?, ?, ?, ?, ?, 'open')",
			)
				.bind(`open:${row.id}`, project, campaignId, row.subscriber_id, row.id)
				.run();
		// Still testing: the campaign must not finish.
		await dispatchCampaign(env, {
			type: "marketing.campaign.dispatch",
			projectId: project,
			campaignId,
		});
		await expect(
			env.DB.prepare("SELECT status FROM campaigns WHERE id=?").bind(campaignId).first(),
		).resolves.toMatchObject({ status: "running" });

		await env.DB.prepare(
			"UPDATE marketing_campaign_ab_tests SET test_ends_at = ? WHERE campaign_id = ?",
		)
			.bind(new Date(Date.now() - 1000).toISOString(), campaignId)
			.run();
		expect(await selectDueAbWinners(env)).toBe(1);
		await dispatchCampaign(env, {
			type: "marketing.campaign.dispatch",
			projectId: project,
			campaignId,
		});
		const all = await env.DB.prepare(
			"SELECT variant_id, variant_phase FROM email_deliveries WHERE campaign_id=?",
		)
			.bind(campaignId)
			.all<{ variant_id: string; variant_phase: string }>();
		expect(all.results).toHaveLength(10);
		expect(
			all.results.filter((row) => row.variant_phase === "winner").map((row) => row.variant_id),
		).toEqual(["b", "b", "b", "b", "b"]);
		const result = await call<{
			status: string;
			winner_variant_id: string;
			results: Array<{ variant_id: string; open_rate: number }>;
		}>(`/internal/v1/campaigns/${campaignId}/ab-test`, project);
		expect(result.body.data).toMatchObject({
			status: "completed",
			winner_variant_id: "b",
			results: [
				{ variant_id: "a", open_rate: 0 },
				{ variant_id: "b", open_rate: 100 },
			],
		});
		const variantStatistics = await call<{ totals: Record<string, number> }>(
			`/internal/v1/statistics?campaign_id=${campaignId}&variant_id=b`,
			project,
		);
		expect(variantStatistics.body.data.totals.open).toBe(2);
	});

	it("sends a variant delivery with the variant subject", async () => {
		const project = 8104;
		const campaignId = await campaign(project, "Default");
		await env.DB.prepare("UPDATE campaigns SET status='running', tracking_enabled=0 WHERE id=?")
			.bind(campaignId)
			.run();
		await env.DB.prepare(
			`INSERT INTO marketing_campaign_ab_tests (project_id, campaign_id, variants_json, test_percent, winner_metric, test_duration_minutes, status)
       VALUES (?, ?, ?, 20, 'open_rate', 60, 'testing')`,
		)
			.bind(
				project,
				campaignId,
				JSON.stringify([
					{ id: "a", subject: "Variant A", template_id: null },
					{ id: "b", subject: "Variant B for {{name}}", template_id: null },
				]),
			)
			.run();
		const subscriberId = await subscriber(project, "ada@variant.example.com");
		const deliveryId = crypto.randomUUID();
		await env.DB.prepare(
			`INSERT INTO email_deliveries (id, project_id, campaign_id, subscriber_id, recipient_email, recipient_name, status, variant_id, variant_phase)
       VALUES (?, ?, ?, ?, 'ada@variant.example.com', 'Ada', 'sending', 'b', 'test')`,
		)
			.bind(deliveryId, project, campaignId, subscriberId)
			.run();
		const subjects: string[] = [];
		const emailService = {
			fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
				);
				if (url.pathname === "/internal/v1/senders")
					return Response.json({
						configured: true,
						items: [{ id: "managed-variant", publicConfig: { from_email: "hello@example.com" } }],
					});
				subjects.push(
					(
						JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
							message: { subject: string };
						}
					).message.subject,
				);
				return Response.json({
					status: "sent",
					id: crypto.randomUUID(),
					messageId: "<variant@example.com>",
					response: "250 OK",
				});
			},
		};
		const batch = createMessageBatch("marketing-test-delivery", [
			{
				id: "variant-delivery",
				timestamp: new Date(),
				attempts: 1,
				body: { type: "marketing.email.deliver", projectId: project, deliveryId },
			},
		]);
		await handleMarketingQueue(batch, { ...env, EMAIL_SERVICE: emailService } as typeof env);
		expect((await getQueueResult(batch, createExecutionContext())).explicitAcks).toEqual([
			"variant-delivery",
		]);
		expect(subjects).toEqual(["Variant B for Ada"]);
		// A test in progress keeps the campaign running.
		await expect(
			env.DB.prepare("SELECT status FROM campaigns WHERE id=?").bind(campaignId).first(),
		).resolves.toMatchObject({ status: "running" });
	});
});

describe("Marketing recipient time-zone sending", () => {
	it("converts local wall-clock times across daylight saving", () => {
		expect(zonedLocalTimeToUtc("2026-07-01T09:00", "Europe/Paris").toISOString()).toBe(
			"2026-07-01T07:00:00.000Z",
		);
		expect(zonedLocalTimeToUtc("2026-12-01T09:00", "Europe/Paris").toISOString()).toBe(
			"2026-12-01T08:00:00.000Z",
		);
		expect(zonedLocalTimeToUtc("2026-12-01T09:00", "Pacific/Kiritimati").toISOString()).toBe(
			"2026-11-30T19:00:00.000Z",
		);
	});

	it("schedules at the earliest zone and releases each time-zone bucket when due", async () => {
		const project = 8105;
		await call("/internal/v1/growth-settings", project, "PUT", {
			default_time_zone: "Europe/Paris",
		});
		const campaignId = await campaign(project);
		const east = await subscriber(project, "east@tz.example.com", {
			time_zone: "Pacific/Kiritimati",
		});
		const west = await subscriber(project, "west@tz.example.com", {
			time_zone: "America/Los_Angeles",
		});
		const unknown = await subscriber(project, "unknown@tz.example.com", { time_zone: "Not/AZone" });
		const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
		const local = `${day}T09:00`;
		const scheduled = await call<{ first_send_at: string; fallback_time_zone: string }>(
			`/internal/v1/campaigns/${campaignId}/local-schedule`,
			project,
			"POST",
			{ local_send_at: local },
		);
		expect(scheduled.status).toBe(200);
		expect(scheduled.body.data.fallback_time_zone).toBe("Europe/Paris");
		expect(scheduled.body.data.first_send_at).toBe(
			new Date(Date.parse(`${local}:00Z`) - 14 * 3_600_000).toISOString(),
		);
		await expect(
			env.DB.prepare("SELECT status, scheduled_at FROM campaigns WHERE id=?")
				.bind(campaignId)
				.first(),
		).resolves.toMatchObject({
			status: "scheduled",
			scheduled_at: scheduled.body.data.first_send_at,
		});

		const audience = {
			sql: "FROM subscribers subscriber WHERE subscriber.project_id = ?",
			bindings: [project],
		};
		const recipients = async () =>
			(
				await env.DB.prepare("SELECT subscriber_id FROM email_deliveries WHERE campaign_id=?")
					.bind(campaignId)
					.all<{ subscriber_id: string }>()
			).results.map((row) => row.subscriber_id);
		const at = (zone: string) => new Date(zonedLocalTimeToUtc(local, zone).getTime() + 60_000);
		await insertLocalTimeDeliveries(
			env.DB,
			project,
			campaignId,
			audience,
			at("Pacific/Kiritimati"),
		);
		expect(await recipients()).toEqual([east]);
		await insertLocalTimeDeliveries(env.DB, project, campaignId, audience, at("Europe/Paris"));
		expect((await recipients()).sort()).toEqual([east, unknown].sort());
		await insertLocalTimeDeliveries(
			env.DB,
			project,
			campaignId,
			audience,
			at("America/Los_Angeles"),
		);
		expect((await recipients()).sort()).toEqual([east, west, unknown].sort());
		await expect(
			env.DB.prepare("SELECT completed_at FROM marketing_campaign_send_windows WHERE campaign_id=?")
				.bind(campaignId)
				.first<{ completed_at: string | null }>(),
		).resolves.toMatchObject({ completed_at: expect.any(String) });

		const removed = await call(
			`/internal/v1/campaigns/${campaignId}/local-schedule`,
			project,
			"DELETE",
		);
		expect(removed.status).toBe(200);
	});
});

describe("Marketing native triggers, waits, goals and revenue attribution", () => {
	it("lists native triggers and the business moments not emitted yet", async () => {
		const catalog = await call<{
			triggers: Array<{ event_name: string }>;
			unavailable: Array<{ key: string }>;
		}>("/internal/v1/journey-triggers", 8106);
		expect(catalog.body.data.triggers.map((item) => item.event_name)).toContain(
			"native:purchase_completed",
		);
		expect(catalog.body.data.unavailable.map((item) => item.key)).toContain("paywall_viewed");
		expect(
			(
				await call("/internal/v1/journeys", 8106, "POST", {
					name: "Unknown",
					trigger: { event_name: "native:not_real", conditions: [] },
					definition: { start_node_id: "exit", nodes: [{ id: "exit", type: "exit" }], edges: [] },
				})
			).status,
		).toBe(422);
	});

	it("enrolls on purchases, attributes revenue to the last click and exits on the goal", async () => {
		const project = 8107;
		const subscriberId = await subscriber(project, "buyer@native.example.com");
		const campaignId = await campaign(project);
		const deliveryId = await delivery(project, campaignId, subscriberId);
		await env.DB.prepare(
			"INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, delivery_id, event_type, metadata_json) VALUES (?, ?, ?, ?, ?, 'click', ?)",
		)
			.bind(
				`click:${deliveryId}:x`,
				project,
				campaignId,
				subscriberId,
				deliveryId,
				JSON.stringify({ target: "https://example.com" }),
			)
			.run();
		const journey = await call<{ id: string }>("/internal/v1/journeys", project, "POST", {
			name: "Thank buyers",
			trigger: { event_name: "native:purchase_completed", conditions: [] },
			reentry_policy: "every_event",
			definition: {
				start_node_id: "tag",
				nodes: [
					{ id: "tag", type: "update_attribute", attributes: { buyer: true } },
					{ id: "exit", type: "exit" },
				],
				edges: [{ from: "tag", to: "exit", outcome: "default" }],
			},
		});
		expect(journey.status).toBe(201);
		await call(`/internal/v1/journeys/${journey.body.data.id}/activate`, project, "POST", {});
		const goalJourney = await call<{ id: string }>("/internal/v1/journeys", project, "POST", {
			name: "Nurture until purchase",
			trigger: { event_name: "manual.nurture", conditions: [] },
			definition: {
				start_node_id: "wait",
				goal: { event_name: "native:purchase_completed" },
				nodes: [
					{ id: "wait", type: "delay", delay_seconds: 86_400 },
					{ id: "exit", type: "exit" },
				],
				edges: [{ from: "wait", to: "exit", outcome: "default" }],
			},
		});
		expect(goalJourney.status).toBe(201);
		await call(`/internal/v1/journeys/${goalJourney.body.data.id}/activate`, project, "POST", {});
		await call(`/internal/v1/journeys/${goalJourney.body.data.id}/enrollments`, project, "POST", {
			subscriber_ids: [subscriberId],
		});

		const result = await acceptMarketingSignal(
			env,
			systemProject(project),
			{
				schema_version: 1,
				event_id: "purchase-1",
				event_name: "customer.purchase",
				application_id: "app",
				subject_hash: null,
				properties: { reported_revenue_cents: 4999, metadata: { currency: "eur" } },
				occurred_at: new Date(Date.now() + 1000).toISOString(),
			},
			"core_collection",
			{ subscriberId },
		);
		expect(result.matched_journeys).toBe(1);
		await expect(
			env.DB.prepare(
				"SELECT source_type, source_id, revenue_cents, currency FROM marketing_revenue_attributions WHERE project_id=? AND event_id='purchase-1'",
			)
				.bind(project)
				.first(),
		).resolves.toEqual({
			source_type: "campaign",
			source_id: campaignId,
			revenue_cents: 4999,
			currency: "EUR",
		});
		await expect(
			env.DB.prepare(
				"SELECT status FROM marketing_journey_enrollments WHERE project_id=? AND journey_id=?",
			)
				.bind(project, goalJourney.body.data.id)
				.first(),
		).resolves.toMatchObject({ status: "exited" });
		const statistics = await call<Record<string, number>>(
			`/internal/v1/journeys/${goalJourney.body.data.id}/statistics`,
			project,
		);
		expect(statistics.body.data.goals_reached).toBe(1);

		// Outside the attribution window nothing is attributed.
		await acceptMarketingSignal(
			env,
			systemProject(project),
			{
				schema_version: 1,
				event_id: "purchase-late",
				event_name: "customer.purchase",
				application_id: "app",
				subject_hash: null,
				properties: { reported_revenue_cents: 1000 },
				occurred_at: new Date(Date.now() + 9 * 86_400_000).toISOString(),
			},
			"core_collection",
			{ subscriberId },
		);
		const revenue = await call<{
			totals: Record<string, { revenue_cents: number; conversions: number }>;
		}>("/internal/v1/insights/revenue", project);
		expect(revenue.body.data.totals).toEqual({ EUR: { revenue_cents: 4999, conversions: 1 } });
		const emailInsights = await call<{
			revenue: Array<{ source_id: string; revenue_cents: number }>;
		}>(`/internal/v1/insights/email?campaign_id=${campaignId}`, project);
		expect(emailInsights.body.data.revenue).toMatchObject([
			{ source_id: campaignId, revenue_cents: 4999 },
		]);
	});

	it("waits for an event, then continues on the matching outcome", async () => {
		const project = 8108;
		const subscriberId = await subscriber(project, "waiter@native.example.com");
		const journey = await call<{ id: string }>("/internal/v1/journeys", project, "POST", {
			name: "Wait for install",
			trigger: { event_name: "manual.wait", conditions: [] },
			definition: {
				start_node_id: "wait",
				nodes: [
					{
						id: "wait",
						type: "wait_event",
						event_name: "native:app_installed",
						timeout_seconds: 3600,
					},
					{ id: "installed", type: "update_attribute", attributes: { installed: "yes" } },
					{ id: "exit", type: "exit" },
				],
				edges: [
					{ from: "wait", to: "installed", outcome: "true" },
					{ from: "wait", to: "exit", outcome: "false" },
					{ from: "installed", to: "exit", outcome: "default" },
				],
			},
		});
		expect(journey.status).toBe(201);
		await call(`/internal/v1/journeys/${journey.body.data.id}/activate`, project, "POST", {});
		await call(`/internal/v1/journeys/${journey.body.data.id}/enrollments`, project, "POST", {
			subscriber_ids: [subscriberId],
		});
		const enrollment = (await env.DB.prepare(
			"SELECT id FROM marketing_journey_enrollments WHERE project_id=? AND journey_id=?",
		)
			.bind(project, journey.body.data.id)
			.first<{ id: string }>())!;
		await advanceJourneyEnrollment(env, {
			type: "marketing.journey.advance",
			projectId: project,
			enrollmentId: enrollment.id,
		});
		const waiting = await eventually(
			() =>
				env.DB.prepare(
					"SELECT status FROM marketing_journey_waits WHERE project_id=? AND enrollment_id=?",
				)
					.bind(project, enrollment.id)
					.first<{ status: string }>(),
			(row) => row?.status === "waiting",
		);
		expect(waiting).toMatchObject({ status: "waiting" });
		await expect(
			env.DB.prepare("SELECT status FROM marketing_journey_enrollments WHERE id=?")
				.bind(enrollment.id)
				.first(),
		).resolves.toMatchObject({ status: "waiting" });

		await acceptMarketingSignal(
			env,
			systemProject(project),
			{
				schema_version: 1,
				event_id: "install-1",
				event_name: "customer.install",
				application_id: "app",
				subject_hash: null,
				properties: {},
				occurred_at: new Date().toISOString(),
			},
			"core_collection",
			{ subscriberId },
		);
		for (let step = 0; step < 3; step++)
			await advanceJourneyEnrollment(env, {
				type: "marketing.journey.advance",
				projectId: project,
				enrollmentId: enrollment.id,
			});
		const finished = await eventually(
			() =>
				env.DB.prepare("SELECT status FROM marketing_journey_enrollments WHERE id=?")
					.bind(enrollment.id)
					.first<{ status: string }>(),
			(row) => row?.status === "completed",
		);
		expect(finished).toMatchObject({ status: "completed" });
		await expect(
			env.DB.prepare(
				"SELECT json_extract(attributes_json, '$.installed') AS installed FROM subscribers WHERE id=?",
			)
				.bind(subscriberId)
				.first(),
		).resolves.toEqual({ installed: "yes" });
	});

	it("turns list joins and tags into journey entries and runs date triggers once a day", async () => {
		const project = 8109;
		const subscriberId = await subscriber(project, "audience@native.example.com", {
			birthday: "1990-11-05",
		});
		const create = async (name: string, trigger: Record<string, unknown>) => {
			const created = await call<{ id: string }>("/internal/v1/journeys", project, "POST", {
				name,
				trigger: { conditions: [], ...trigger },
				reentry_policy: "every_event",
				definition: { start_node_id: "exit", nodes: [{ id: "exit", type: "exit" }], edges: [] },
			});
			expect(created.status).toBe(201);
			await call(`/internal/v1/journeys/${created.body.data.id}/activate`, project, "POST", {});
			return created.body.data.id;
		};
		const listJourney = await create("Welcome to the list", {
			event_name: "native:contact_joined_list",
		});
		const tagJourney = await create("Tagged VIP", {
			event_name: "native:tag_added",
			conditions: [{ field: "properties.tag_name", operator: "equals", value: "vip" }],
		});
		const birthdayJourney = await create("Birthday", {
			event_name: "native:date_attribute",
			date: { attribute: "birthday", anniversary: true, offset_days: 0, hour: 0 },
		});
		const listId = crypto.randomUUID();
		const tagId = crypto.randomUUID();
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO subscriber_lists (id, project_id, name) VALUES (?, ?, 'Newsletter')",
			).bind(listId, project),
			env.DB.prepare(
				"INSERT INTO subscriber_tags (id, project_id, name) VALUES (?, ?, 'vip')",
			).bind(tagId, project),
		]);
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO subscriber_list_memberships (project_id, subscriber_id, list_id) VALUES (?, ?, ?)",
			).bind(project, subscriberId, listId),
			env.DB.prepare(
				"INSERT INTO subscriber_tag_assignments (project_id, tag_id, subscriber_id) VALUES (?, ?, ?)",
			).bind(project, tagId, subscriberId),
		]);
		await expect(
			env.DB.prepare(
				"SELECT COUNT(*) AS total FROM marketing_native_event_outbox WHERE project_id=?",
			)
				.bind(project)
				.first(),
		).resolves.toEqual({ total: 2 });
		expect(await processNativeEventOutbox(env)).toBeGreaterThanOrEqual(2);
		const enrolled = async (journeyId: string) =>
			Number(
				(
					await env.DB.prepare(
						"SELECT COUNT(*) AS total FROM marketing_journey_enrollments WHERE project_id=? AND journey_id=?",
					)
						.bind(project, journeyId)
						.first<{ total: number }>()
				)?.total,
			);
		expect(await enrolled(listJourney)).toBe(1);
		expect(await enrolled(tagJourney)).toBe(1);

		const birthday = new Date(Date.UTC(2026, 10, 5, 12));
		await runDateTriggers(env, birthday);
		await runDateTriggers(env, birthday);
		expect(await enrolled(birthdayJourney)).toBe(1);
		await runDateTriggers(env, new Date(Date.UTC(2026, 10, 6, 12)));
		expect(await enrolled(birthdayJourney)).toBe(1);
	});
});
