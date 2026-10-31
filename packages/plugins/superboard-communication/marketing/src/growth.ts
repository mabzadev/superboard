import type { ProjectContext } from "@superboard/contracts/project-context";
import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import {
	abTestHoldsCampaign,
	abTestRoutes,
	insertAbTestDeliveries,
	selectDueAbWinners,
} from "./ab-tests.js";
import type { EligibleAudience } from "./ab-tests.js";
import { brandKitRoutes, readGrowthSettings } from "./brand-kit.js";
import { acceptMarketingSignal, enrollSubscriber, type JourneyRow } from "./journeys.js";
import { emailEngagement, insightScope, linkReport } from "./link-analytics.js";
import {
	DATE_TRIGGER,
	NATIVE_PREFIX,
	NATIVE_TRIGGERS,
	UNAVAILABLE_NATIVE_TRIGGERS,
	type DateTriggerSettings,
} from "./native-triggers.js";
import { revenueBySource } from "./revenue-attribution.js";
import {
	dispatchOpenSendWindows,
	insertLocalTimeDeliveries,
	sendTimeRoutes,
	sendWindowHoldsCampaign,
	zonedDateParts,
} from "./send-time.js";
import type { Env } from "./types.js";
import { parseStoredJson } from "./validation.js";

type GrowthBindings = { Bindings: Env; Variables: { project: ProjectContext } };

export const growthRoutes = registerRouter(new Hono<GrowthBindings>(), {
	service: "marketing",
	module: "growth.growthRoutes",
	pluginId: "superboard-marketing",
	surface: "internal",
	access: "internal",
});

growthRoutes.route("/", brandKitRoutes);
growthRoutes.route("/", abTestRoutes);
growthRoutes.route("/", sendTimeRoutes);

/** Engagement, deliverability rates, per-link clicks and attributed revenue for one scope. */
growthRoutes.get("/insights/email", async (c) => {
	const projectId = c.get("project").projectId;
	const scope = insightScope(new URL(c.req.url).searchParams);
	const engagement = await emailEngagement(c.env.DB, projectId, scope);
	const [links, revenue] = await Promise.all([
		linkReport(c.env.DB, projectId, scope, engagement.delivered || engagement.sent),
		revenueBySource(c.env.DB, projectId, scope),
	]);
	return c.json({ data: { engagement, links, revenue } });
});

growthRoutes.get("/insights/revenue", async (c) => {
	const projectId = c.get("project").projectId;
	const scope = insightScope(new URL(c.req.url).searchParams);
	const items = await revenueBySource(c.env.DB, projectId, scope);
	const totals: Record<string, { revenue_cents: number; conversions: number }> = {};
	for (const item of items) {
		const key = item.currency ?? "unknown";
		const total = (totals[key] ??= { revenue_cents: 0, conversions: 0 });
		total.revenue_cents += item.revenue_cents;
		total.conversions += item.conversions;
	}
	return c.json({
		data: {
			items,
			totals,
			attribution_window_days: (await readGrowthSettings(c.env.DB, projectId))
				.attribution_window_days,
		},
	});
});

/** Native triggers available to automations, and business moments not emitted yet. */
growthRoutes.get("/journey-triggers", (c) =>
	c.json({
		data: {
			triggers: NATIVE_TRIGGERS.map((trigger) => ({
				key: trigger.key,
				event_name: NATIVE_PREFIX + trigger.key,
				group: trigger.group,
				label: trigger.label,
				events: trigger.events,
			})),
			unavailable: UNAVAILABLE_NATIVE_TRIGGERS,
		},
	}),
);

/**
 * Delivery planning hook for campaign dispatch: A/B tests and recipient
 * time-zone sending create their own deliveries. Returns false otherwise.
 */
export async function insertPlannedDeliveries(
	db: D1Database,
	projectId: number,
	campaignId: string,
	audience: EligibleAudience,
) {
	return (
		(await insertAbTestDeliveries(db, projectId, campaignId, audience)) ||
		(await insertLocalTimeDeliveries(db, projectId, campaignId, audience))
	);
}

/** A campaign waiting for its A/B winner or for later time zones stays running. */
export async function campaignCompletionHeld(
	db: D1Database,
	projectId: number,
	campaignId: string,
) {
	return (
		(await abTestHoldsCampaign(db, projectId, campaignId)) ||
		(await sendWindowHoldsCampaign(db, projectId, campaignId))
	);
}

function systemProject(projectId: number, requestId: string): ProjectContext {
	return {
		projectId,
		projectRef: String(projectId),
		instanceId: 0,
		environment: "production",
		actorId: 0,
		role: "system",
		requestId,
		issuedAt: Math.floor(Date.now() / 1000),
	};
}

/** Turns audience changes (contact created, list joined, tag added) into journey signals. */
export async function processNativeEventOutbox(env: Env, limit = 200) {
	const rows = await env.DB.prepare(
		"SELECT id, project_id, subscriber_id, event_name, properties_json, created_at FROM marketing_native_event_outbox ORDER BY id LIMIT ?",
	)
		.bind(limit)
		.all<{
			id: number;
			project_id: number;
			subscriber_id: string;
			event_name: string;
			properties_json: string;
			created_at: string;
		}>();
	for (const row of rows.results) {
		const eventId = `marketing-${row.event_name.replaceAll(".", "-")}-${row.id}`;
		await acceptMarketingSignal(
			env,
			systemProject(row.project_id, eventId),
			{
				schema_version: 1,
				event_id: eventId,
				event_name: row.event_name,
				application_id: "marketing",
				subject_hash: null,
				properties: parseStoredJson<Record<string, unknown>>(row.properties_json, {}),
				occurred_at: row.created_at,
			},
			"marketing",
			{ subscriberId: row.subscriber_id },
		);
		await env.DB.prepare("DELETE FROM marketing_native_event_outbox WHERE id = ?")
			.bind(row.id)
			.run();
	}
	return rows.results.length;
}

function addDays(date: string, days: number) {
	const value = new Date(`${date}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

/**
 * Date-based triggers: once per local day and journey, enrolls contacts whose
 * date field matches today (plus the offset), yearly when `anniversary` is set.
 */
export async function runDateTriggers(env: Env, now = new Date()) {
	const journeys = await env.DB.prepare(
		"SELECT * FROM marketing_journeys WHERE status = 'active' AND trigger_event_name = ? ORDER BY id LIMIT 100",
	)
		.bind(DATE_TRIGGER)
		.all<JourneyRow>();
	let enrolled = 0;
	for (const journey of journeys.results) {
		const settings = parseStoredJson<{ date?: DateTriggerSettings }>(journey.trigger_json, {}).date;
		if (!settings) continue;
		const zone = (await readGrowthSettings(env.DB, journey.project_id)).default_time_zone;
		const local = zonedDateParts(zone, now);
		if (local.hour < settings.hour) continue;
		const claimed = await env.DB.prepare(
			`INSERT INTO marketing_date_trigger_runs (project_id, journey_id, run_date) VALUES (?, ?, ?)
       ON CONFLICT(project_id, journey_id, run_date) DO NOTHING RETURNING run_date`,
		)
			.bind(journey.project_id, journey.id, local.date)
			.first();
		if (!claimed) continue;
		// "3 days before the date" means the date is three days from today.
		const target = addDays(local.date, settings.offset_days);
		const path = `$."${settings.attribute}"`;
		const match = settings.anniversary
			? "substr(json_extract(subscriber.attributes_json, ?), 6, 5) = ?"
			: "substr(json_extract(subscriber.attributes_json, ?), 1, 10) = ?";
		const segment = journey.entry_segment_id
			? "AND EXISTS (SELECT 1 FROM segment_memberships m WHERE m.project_id = subscriber.project_id AND m.subscriber_id = subscriber.id AND m.segment_id = ?)"
			: "";
		let cursor = "";
		let count = 0;
		while (true) {
			const page = await env.DB.prepare(
				`SELECT subscriber.id, json_extract(subscriber.attributes_json, ?) AS value FROM subscribers subscriber
         WHERE subscriber.project_id = ? AND subscriber.status = 'enabled' AND ${match} ${segment}
           AND subscriber.id > ? ORDER BY subscriber.id LIMIT 250`,
			)
				.bind(
					path,
					journey.project_id,
					path,
					settings.anniversary ? target.slice(5) : target,
					...(journey.entry_segment_id ? [journey.entry_segment_id] : []),
					cursor,
				)
				.all<{ id: string; value: unknown }>();
			for (const subscriber of page.results) {
				const result = await enrollSubscriber(
					env,
					journey,
					subscriber.id,
					`date:${journey.id}:${local.date}:${subscriber.id}`,
					{
						source: "date_trigger",
						signal: {
							event_name: DATE_TRIGGER,
							properties: {
								attribute: settings.attribute,
								date: subscriber.value,
								run_date: local.date,
							},
						},
					},
				);
				if (result.enrolled) count += 1;
			}
			const last = page.results.at(-1);
			if (!last || page.results.length < 250) break;
			cursor = last.id;
		}
		await env.DB.prepare(
			"UPDATE marketing_date_trigger_runs SET enrolled = ? WHERE project_id = ? AND journey_id = ? AND run_date = ?",
		)
			.bind(count, journey.project_id, journey.id, local.date)
			.run();
		enrolled += count;
	}
	return enrolled;
}

async function guarded(event: string, task: () => Promise<unknown>) {
	try {
		await task();
	} catch (error) {
		console.error(
			JSON.stringify({ event, error: error instanceof Error ? error.message : String(error) }),
		);
	}
}

/** Minute cron work for A/B winners, local-time sends and native triggers. */
export async function runGrowthSchedules(env: Env) {
	await guarded("marketing_ab_winner_failed", () => selectDueAbWinners(env));
	await guarded("marketing_local_send_failed", () => dispatchOpenSendWindows(env));
	await guarded("marketing_native_outbox_failed", () => processNativeEventOutbox(env));
	await guarded("marketing_date_trigger_failed", () => runDateTriggers(env));
}
