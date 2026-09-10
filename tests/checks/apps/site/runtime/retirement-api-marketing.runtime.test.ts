import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import {
	apiHeaders,
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plugmod-marketing";
const file = "retirement-api-marketing.runtime.test.ts";

test("push notification search excludes in-app-only messages through the canonical plugin adapters", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/projects/${scope.production_project_ref}/notifications`;
	const prefix = `notification-fixture-${crypto.randomUUID()}`;
	for (const push of [false, true]) {
		await jsonResult(
			await apiCommand(plugin, "create_notification", {
				method: "POST",
				path: base,
				body: {
					title: `${prefix}-${push ? "push" : "in-app"}`,
					subtitle: "Fixture",
					send_push: push,
					new_users: true,
					existing_users: false,
					platforms: ["ios", "android"],
				},
			}),
			201,
		);
	}
	const result = await jsonResult<{ data: Array<{ title: string }>; total_entries: number }>(
		await apiRead(plugin, "notifications", {
			method: "POST",
			path: `${base}/search`,
			body: { send_push: true, term: prefix },
		}),
	);
	expect(result.total_entries).toBe(1);
	expect(result.data.map(({ title }) => title)).toEqual([`${prefix}-push`]);
	const wildcard = await jsonResult<{ data: Array<{ title: string }> }>(await apiRead(plugin, "notifications", {
		method: "POST", path: `${base}/search`, body: { send_push: true, term: "%-push" },
	}));
	expect(wildcard.data.map(({ title }) => title)).toContain(`${prefix}-push`);

});

test("canonical Marketing APIs preserve subscribers, campaign scheduling, journeys, enrollments and connectors", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/marketing/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("marketing");
	const command = (id: string, method: string, path: string, body?: unknown) =>
		apiCommand(plugin, id, {
			method,
			path: `${base}${path}`,
			...(body === undefined ? {} : { body }),
		});
	const read = async <T>(id: string, path: string): Promise<T> =>
		(
			await jsonResult<{ data: T }>(
				await apiRead(plugin, id, { method: "GET", path: `${base}${path}` }),
			)
		).data;
	const fixture = async <T>(path: string, body: unknown, status = 201) =>
		(
			await jsonResult<{ data: T }>(
				await SELF.fetch(`https://site.example${base}${path}`, {
					method: "POST",
					headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
					body: JSON.stringify(body),
				}),
				status,
			)
		).data;
	const list = await fixture<{ id: string }>("/lists", {
		name: "Retirement subscribers",
		visibility: "private",
	});
	const subscriber = await fixture<{ id: string }>("/email/subscribers", {
		email: `proof-${crypto.randomUUID()}@example.test`,
		name: "Proof subscriber",
		list_ids: [list.id],
		attributes: { country: "CH" },
	});
	const segment = await fixture<{ id: string }>("/segments", {
		name: "Swiss subscribers",
		rules: { mode: "all", conditions: [{ field: "country", operator: "equals", value: "CH" }] },
	});
	const template = await fixture<{ id: string }>("/templates", {
		name: "Proof template",
		subject: "Proof",
		content_html: "<p>Canonical template</p>",
		template_type: "campaign",
	});
	for (const [id, path, expected] of [
		["email_subscribers", "/email/subscribers", { id: subscriber.id, name: "Proof subscriber" }],
		["subscriber_lists", "/lists", { id: list.id, name: "Retirement subscribers" }],
		["subscriber_segments", "/segments", { id: segment.id, name: "Swiss subscribers" }],
		[
			"email_templates",
			"/templates",
			{ id: template.id, content_html: "<p>Canonical template</p>" },
		],
	] as const) {
		const values = await read<Array<Record<string, unknown>>>(id, path);
		expect(values).toContainEqual(expect.objectContaining(expected));
		proveApi(plugin, id, "read", file, [expected.id]);
	}
	const campaign = (
		await jsonResult<{ data: { id: string } }>(
			await command("create_email_campaign", "POST", "/campaigns", {
				name: "Proof campaign",
				subject: "Hello",
				template_id: template.id,
				list_ids: [list.id],
			}),
			201,
		)
	).data;
	expect(
		await db.prepare("SELECT name FROM campaigns WHERE id=?").bind(campaign.id).first(),
	).toEqual({ name: "Proof campaign" });
	proveApi(plugin, "create_email_campaign", "mutation", file, [campaign.id]);
	await jsonResult(
		await command("update_email_campaign", "PATCH", `/campaigns/${campaign.id}`, {
			subject: "Updated subject",
		}),
	);
	let campaigns = await read<Array<Record<string, unknown>>>("email_campaigns", "/campaigns");
	expect(campaigns).toContainEqual(
		expect.objectContaining({ id: campaign.id, subject: "Updated subject" }),
	);
	proveApi(plugin, "update_email_campaign", "mutation", file, [campaign.id]);
	proveApi(plugin, "email_campaigns", "read", file, [campaign.id]);
	const scheduledAt = new Date(Date.now() + 3600000).toISOString();
	await jsonResult(
		await command("schedule_email_campaign", "POST", `/campaigns/${campaign.id}/schedule`, {
			scheduled_at: scheduledAt,
		}),
	);
	expect(
		await db
			.prepare("SELECT status,scheduled_at FROM campaigns WHERE id=?")
			.bind(campaign.id)
			.first(),
	).toEqual({ status: "scheduled", scheduled_at: scheduledAt });
	proveApi(plugin, "schedule_email_campaign", "mutation", file, [campaign.id]);
	await jsonResult(
		await command("transition_email_campaign", "POST", `/campaigns/${campaign.id}/pause`),
	);
	campaigns = await read<Array<Record<string, unknown>>>("email_campaigns", "/campaigns");
	expect(campaigns).toContainEqual(expect.objectContaining({ id: campaign.id, status: "paused" }));
	proveApi(plugin, "transition_email_campaign", "mutation", file, [campaign.id]);
	const statistics = await read<{ totals: Record<string, number> }>(
		"marketing_statistics",
		"/statistics",
	);
	expect(statistics.totals).toMatchObject({ subscribers: 1, enabled_subscribers: 1, campaigns: 1 });
	proveApi(plugin, "marketing_statistics", "read", file, [subscriber.id, campaign.id]);
	const journey = (
		await jsonResult<{ data: { id: string } }>(
			await command("create_marketing_journey", "POST", "/journeys", {
				name: "Proof journey",
				trigger: { event_name: "customer.created" },
				definition: { start_node_id: "finish", nodes: [{ id: "finish", type: "exit" }], edges: [] },
			}),
			201,
		)
	).data;
	expect(
		await db.prepare("SELECT name FROM marketing_journeys WHERE id=?").bind(journey.id).first(),
	).toEqual({ name: "Proof journey" });
	proveApi(plugin, "create_marketing_journey", "mutation", file, [journey.id]);
	await jsonResult(
		await command("update_marketing_journey", "PATCH", `/journeys/${journey.id}`, {
			name: "Updated journey",
		}),
	);
	await jsonResult(
		await command("transition_marketing_journey", "POST", `/journeys/${journey.id}/activate`),
	);
	const journeys = await read<Array<Record<string, unknown>>>("marketing_journeys", "/journeys");
	expect(journeys).toContainEqual(
		expect.objectContaining({ id: journey.id, name: "Updated journey", status: "active" }),
	);
	proveApi(plugin, "update_marketing_journey", "mutation", file, [journey.id]);
	proveApi(plugin, "transition_marketing_journey", "mutation", file, [journey.id]);
	proveApi(plugin, "marketing_journeys", "read", file, [journey.id]);
	const enrollment = await fixture<{ enrolled: number }>(
		`/journeys/${journey.id}/enrollments`,
		{ subscriber_ids: [subscriber.id] },
		202,
	);
	expect(enrollment.enrolled).toBe(1);
	const enrollments = await read<Array<Record<string, unknown>>>(
		"journey_enrollments",
		`/journeys/${journey.id}/enrollments`,
	);
	expect(enrollments).toContainEqual(
		expect.objectContaining({
			subscriber_id: subscriber.id,
			journey_id: journey.id,
			status: "active",
		}),
	);
	proveApi(
		plugin,
		"journey_enrollments",
		"read",
		file,
		enrollments.map((row) => String(row.id)),
	);
	const journeyStats = await read<{ enrollments: number; active: number }>(
		"journey_statistics",
		`/journeys/${journey.id}/statistics`,
	);
	expect(journeyStats).toMatchObject({ enrollments: 1, active: 1 });
	proveApi(plugin, "journey_statistics", "read", file, [journey.id]);
	const connector = (
		await jsonResult<{ data: { id: string } }>(
			await command("create_marketing_channel_connector", "POST", "/channel-connectors", {
				name: "Proof webhook",
				channel: "webhook",
				endpoint_url: "https://connector.example.test/incoming",
				enabled: false,
			}),
			201,
		)
	).data;
	expect(
		await db
			.prepare("SELECT name FROM marketing_channel_connectors WHERE id=?")
			.bind(connector.id)
			.first(),
	).toEqual({ name: "Proof webhook" });
	proveApi(plugin, "create_marketing_channel_connector", "mutation", file, [connector.id]);
	await jsonResult(
		await command(
			"update_marketing_channel_connector",
			"PATCH",
			`/channel-connectors/${connector.id}`,
			{ name: "Updated webhook" },
		),
	);
	const connectors = await read<Array<Record<string, unknown>>>(
		"marketing_channel_connectors",
		"/channel-connectors",
	);
	expect(connectors).toContainEqual(
		expect.objectContaining({ id: connector.id, name: "Updated webhook", enabled: false }),
	);
	proveApi(plugin, "update_marketing_channel_connector", "mutation", file, [connector.id]);
	proveApi(plugin, "marketing_channel_connectors", "read", file, [connector.id]);
	await jsonResult(
		await command(
			"delete_marketing_channel_connector",
			"DELETE",
			`/channel-connectors/${connector.id}`,
		),
	);
	expect(
		await db
			.prepare("SELECT id FROM marketing_channel_connectors WHERE id=?")
			.bind(connector.id)
			.first(),
	).toBeNull();
	proveApi(plugin, "delete_marketing_channel_connector", "mutation", file, [connector.id]);
});
