import type { ProjectContext } from "@superboard/contracts/project-context";
import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import type { EligibleAudience } from "./ab-tests.js";
import { plainText } from "./audience-shared.js";
import { failure } from "./auth.js";
import { isTimeZone, readGrowthSettings } from "./brand-kit.js";
import { snapshotEmailCampaign } from "./email-studio.js";
import type { Env, MarketingQueueJob } from "./types.js";
import { readJsonObject } from "./validation.js";

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;
/** Contact time zone, read from the `time_zone` custom field (or `timezone`). */
const CONTACT_TIME_ZONE_SQL =
	"COALESCE(json_extract(subscriber.attributes_json, '$.time_zone'), json_extract(subscriber.attributes_json, '$.timezone'), '')";
// The earliest and latest UTC offsets in use (Kiribati and Baker Island).
const EARLIEST_OFFSET_MINUTES = 14 * 60;
const LATEST_OFFSET_MINUTES = -12 * 60;

type WindowRow = {
	project_id: number;
	campaign_id: string;
	local_send_at: string;
	fallback_time_zone: string;
	completed_at: string | null;
};

function parseLocal(value: string) {
	const match = LOCAL_TIME.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const utc = Date.UTC(year, month - 1, day, hour, minute);
	const check = new Date(utc);
	if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59)
		return null;
	return utc;
}

function zoneOffsetMinutes(zone: string, instant: number) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		})
			.formatToParts(new Date(instant))
			.map((part) => [part.type, part.value]),
	);
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second),
	);
	return Math.round((asUtc - instant) / 60_000);
}

/** UTC instant of a wall-clock time (`YYYY-MM-DDTHH:MM`) in an IANA time zone. */
export function zonedLocalTimeToUtc(local: string, zone: string): Date {
	const wall = parseLocal(local);
	if (wall === null) throw failure("LOCAL_SEND_AT_INVALID", "Choose a valid local date and time.");
	let instant = wall - zoneOffsetMinutes(zone, wall) * 60_000;
	// A second pass settles daylight-saving transitions.
	instant = wall - zoneOffsetMinutes(zone, instant) * 60_000;
	return new Date(instant);
}

/** Local calendar date (`YYYY-MM-DD`) and hour of an instant in a time zone. */
export function zonedDateParts(zone: string, instant: Date) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
		})
			.formatToParts(instant)
			.map((part) => [part.type, part.value]),
	);
	return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function sendWindow(db: D1Database, projectId: number, campaignId: string) {
	return db
		.prepare("SELECT * FROM marketing_campaign_send_windows WHERE project_id=? AND campaign_id=?")
		.bind(projectId, campaignId)
		.first<WindowRow>();
}

/**
 * Creates deliveries for the time-zone buckets whose local send time arrived.
 * Returns false when the campaign does not send in recipient time zones.
 */
export async function insertLocalTimeDeliveries(
	db: D1Database,
	projectId: number,
	campaignId: string,
	audience: EligibleAudience,
	now = new Date(),
): Promise<boolean> {
	const schedule = await sendWindow(db, projectId, campaignId);
	if (!schedule || schedule.completed_at) return false;
	const buckets = await db
		.prepare(
			`SELECT ${CONTACT_TIME_ZONE_SQL} AS zone, COUNT(*) AS total ${audience.sql} GROUP BY zone`,
		)
		.bind(...audience.bindings)
		.all<{ zone: unknown; total: number }>();
	let waiting = 0;
	for (const bucket of buckets.results) {
		const raw = plainText(bucket.zone);
		const zone = isTimeZone(raw) ? raw : schedule.fallback_time_zone;
		if (zonedLocalTimeToUtc(schedule.local_send_at, zone).getTime() > now.getTime()) {
			waiting += 1;
			continue;
		}
		await db
			.prepare(
				`INSERT INTO email_deliveries
          (id, project_id, campaign_id, subscriber_id, recipient_email, recipient_name, status)
         SELECT lower(hex(randomblob(16))), subscriber.project_id, ?, subscriber.id, subscriber.email, subscriber.name, 'pending'
         ${audience.sql} AND ${CONTACT_TIME_ZONE_SQL} = ?
         ON CONFLICT(campaign_id, subscriber_id) DO NOTHING`,
			)
			.bind(campaignId, ...audience.bindings, raw)
			.run();
	}
	if (!waiting)
		await db
			.prepare(
				"UPDATE marketing_campaign_send_windows SET completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=? AND campaign_id=? AND completed_at IS NULL",
			)
			.bind(projectId, campaignId)
			.run();
	return true;
}

export async function sendWindowHoldsCampaign(
	db: D1Database,
	projectId: number,
	campaignId: string,
) {
	return Boolean(
		await db
			.prepare(
				"SELECT 1 FROM marketing_campaign_send_windows WHERE project_id=? AND campaign_id=? AND completed_at IS NULL",
			)
			.bind(projectId, campaignId)
			.first(),
	);
}

/** Re-dispatches running local-time campaigns so later time zones are picked up. */
export async function dispatchOpenSendWindows(env: Env) {
	const rows = await env.DB.prepare(
		`SELECT send_window.project_id, send_window.campaign_id FROM marketing_campaign_send_windows send_window
     JOIN campaigns campaign ON campaign.project_id = send_window.project_id AND campaign.id = send_window.campaign_id
     WHERE send_window.completed_at IS NULL AND campaign.status = 'running' LIMIT 100`,
	).all<{ project_id: number; campaign_id: string }>();
	for (const row of rows.results)
		await env.MARKETING_QUEUE.send({
			type: "marketing.campaign.dispatch",
			projectId: row.project_id,
			campaignId: row.campaign_id,
		} satisfies MarketingQueueJob);
	return rows.results.length;
}

export const sendTimeRoutes = registerRouter(
	new Hono<{ Bindings: Env; Variables: { project: ProjectContext } }>(),
	{
		service: "marketing",
		module: "send-time.sendTimeRoutes",
		pluginId: "superboard-marketing",
		surface: "internal",
		access: "internal",
	},
);

sendTimeRoutes.get("/campaigns/:campaignId/local-schedule", async (c) =>
	c.json({
		data: await sendWindow(c.env.DB, c.get("project").projectId, c.req.param("campaignId")),
	}),
);

/** Schedules a campaign at one local time in each contact's time zone. */
sendTimeRoutes.post("/campaigns/:campaignId/local-schedule", async (c) => {
	const projectId = c.get("project").projectId;
	const campaignId = c.req.param("campaignId");
	const body = await readJsonObject(c.req.raw, 4_000);
	const local = typeof body.local_send_at === "string" ? body.local_send_at.slice(0, 16) : "";
	const wall = parseLocal(local);
	if (wall === null) throw failure("LOCAL_SEND_AT_INVALID", "Choose a valid local date and time.");
	const campaign = await c.env.DB.prepare(
		"SELECT id, status, template_id FROM campaigns WHERE project_id=? AND id=?",
	)
		.bind(projectId, campaignId)
		.first<{ id: string; status: string; template_id: string | null }>();
	if (!campaign) throw failure("campaign_not_found", "Campaign not found", 404);
	if (!["draft", "paused", "scheduled"].includes(campaign.status))
		throw failure("campaign_transition_invalid", "Campaign cannot transition to scheduled", 409);
	if (
		await c.env.DB.prepare(
			"SELECT 1 FROM marketing_campaign_ab_tests WHERE project_id=? AND campaign_id=?",
		)
			.bind(projectId, campaignId)
			.first()
	)
		throw failure(
			"AB_TEST_WITH_LOCAL_TIME",
			"A/B tests cannot be combined with sending in each contact's time zone.",
			409,
		);
	if (wall - LATEST_OFFSET_MINUTES * 60_000 <= Date.now())
		throw failure("scheduled_at_invalid", "This local time has already passed in every time zone.");
	const earliest = new Date(Math.max(wall - EARLIEST_OFFSET_MINUTES * 60_000, Date.now()));
	await snapshotEmailCampaign(c.env.DB, projectId, campaignId, campaign.template_id);
	const fallback = (await readGrowthSettings(c.env.DB, projectId)).default_time_zone;
	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO marketing_campaign_send_windows (project_id, campaign_id, local_send_at, fallback_time_zone)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, campaign_id) DO UPDATE SET local_send_at=excluded.local_send_at,
         fallback_time_zone=excluded.fallback_time_zone, completed_at=NULL`,
		).bind(projectId, campaignId, local, fallback),
		c.env.DB.prepare(
			`UPDATE campaigns SET status='scheduled', scheduled_at=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE project_id=? AND id=?`,
		).bind(earliest.toISOString(), projectId, campaignId),
	]);
	return c.json({
		data: {
			campaign_id: campaignId,
			local_send_at: local,
			fallback_time_zone: fallback,
			first_send_at: earliest.toISOString(),
		},
	});
});

sendTimeRoutes.delete("/campaigns/:campaignId/local-schedule", async (c) => {
	const projectId = c.get("project").projectId;
	const campaignId = c.req.param("campaignId");
	const campaign = await c.env.DB.prepare(
		"SELECT status FROM campaigns WHERE project_id=? AND id=?",
	)
		.bind(projectId, campaignId)
		.first<{ status: string }>();
	if (!campaign) throw failure("campaign_not_found", "Campaign not found", 404);
	if (campaign.status === "running")
		throw failure("campaign_locked", "Pause the campaign before changing its schedule.", 409);
	await c.env.DB.batch([
		c.env.DB.prepare(
			"DELETE FROM marketing_campaign_send_windows WHERE project_id=? AND campaign_id=?",
		).bind(projectId, campaignId),
		c.env.DB.prepare(
			`UPDATE campaigns SET status='draft', scheduled_at=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE project_id=? AND id=? AND status='scheduled'`,
		).bind(projectId, campaignId),
	]);
	return c.json({ data: { deleted: true } });
});
