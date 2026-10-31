import type { ProjectContext } from "@superboard/contracts/project-context";
import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import { isRecord } from "./audience-shared.js";
import { failure } from "./auth.js";
import { getPublishedEmailTemplate } from "./email-studio.js";
import { rate } from "./link-analytics.js";
import type { Env, MarketingQueueJob } from "./types.js";
import { parseStoredJson, readJsonObject } from "./validation.js";

export type AbVariant = { id: string; subject: string; template_id: string | null };
type AbWinnerMetric = "open_rate" | "click_rate";
type AbTestRow = {
	project_id: number;
	campaign_id: string;
	variants_json: string;
	test_percent: number;
	winner_metric: AbWinnerMetric;
	test_duration_minutes: number;
	status: "pending" | "testing" | "winner_selected" | "completed";
	winner_variant_id: string | null;
	test_started_at: string | null;
	test_ends_at: string | null;
	winner_selected_at: string | null;
};
export type EligibleAudience = { sql: string; bindings: unknown[] };

const VARIANT_IDS = ["a", "b", "c"] as const;
const EDITABLE_CAMPAIGN = ["draft", "scheduled", "paused"];

async function abTestRow(db: D1Database, projectId: number, campaignId: string) {
	return db
		.prepare("SELECT * FROM marketing_campaign_ab_tests WHERE project_id=? AND campaign_id=?")
		.bind(projectId, campaignId)
		.first<AbTestRow>();
}

function serializeAbTest(row: AbTestRow) {
	return {
		campaign_id: row.campaign_id,
		variants: parseStoredJson<AbVariant[]>(row.variants_json, []),
		test_percent: row.test_percent,
		winner_metric: row.winner_metric,
		test_duration_minutes: row.test_duration_minutes,
		status: row.status,
		winner_variant_id: row.winner_variant_id,
		test_started_at: row.test_started_at,
		test_ends_at: row.test_ends_at,
		winner_selected_at: row.winner_selected_at,
	};
}

type VariantResult = {
	variant_id: string;
	recipients: number;
	sent: number;
	opens: number;
	clicks: number;
	open_rate: number;
	click_rate: number;
};

/** Test-phase results per variant; rollout deliveries of the winner are excluded. */
async function variantResults(
	db: D1Database,
	projectId: number,
	campaignId: string,
): Promise<VariantResult[]> {
	const rows = await db
		.prepare(
			`SELECT delivery.variant_id,
         COUNT(DISTINCT delivery.id) AS recipients,
         COUNT(DISTINCT CASE WHEN delivery.status IN ('sent', 'delivered') THEN delivery.id END) AS sent,
         COUNT(DISTINCT CASE WHEN event.event_type = 'open' THEN delivery.id END) AS opens,
         COUNT(DISTINCT CASE WHEN event.event_type = 'click' THEN delivery.id END) AS clicks
       FROM email_deliveries delivery
       LEFT JOIN email_events event ON event.project_id = ? AND event.delivery_id = delivery.id
         AND event.event_type IN ('open', 'click')
       WHERE delivery.project_id = ? AND delivery.campaign_id = ?
         AND delivery.variant_id IS NOT NULL AND delivery.variant_phase = 'test'
       GROUP BY delivery.variant_id ORDER BY delivery.variant_id`,
		)
		.bind(projectId, projectId, campaignId)
		.all<{ variant_id: string; recipients: number; sent: number; opens: number; clicks: number }>();
	return rows.results.map((row) => ({
		variant_id: row.variant_id,
		recipients: Number(row.recipients),
		sent: Number(row.sent),
		opens: Number(row.opens),
		clicks: Number(row.clicks),
		open_rate: rate(Number(row.opens), Number(row.sent)),
		click_rate: rate(Number(row.clicks), Number(row.sent)),
	}));
}

/** Picks the best variant; ties keep the earliest variant so the result is stable. */
export function pickWinner(
	variants: AbVariant[],
	results: VariantResult[],
	metric: AbWinnerMetric,
): string {
	let winner = variants[0]?.id ?? "a";
	let best = -1;
	for (const variant of variants) {
		const score = results.find((item) => item.variant_id === variant.id)?.[metric] ?? 0;
		if (score > best) {
			best = score;
			winner = variant.id;
		}
	}
	return winner;
}

/** Variant content used by the delivery worker. */
export async function campaignVariant(
	db: D1Database,
	projectId: number,
	campaignId: string,
	variantId: string,
): Promise<AbVariant | null> {
	const row = await abTestRow(db, projectId, campaignId);
	if (!row) return null;
	return (
		parseStoredJson<AbVariant[]>(row.variants_json, []).find((item) => item.id === variantId) ??
		null
	);
}

/**
 * Creates the deliveries of an A/B tested campaign. The first dispatch sends
 * the test sample split across variants; once the winner is chosen the next
 * dispatch sends it to everyone else. Returns false when no test applies.
 */
export async function insertAbTestDeliveries(
	db: D1Database,
	projectId: number,
	campaignId: string,
	audience: EligibleAudience,
): Promise<boolean> {
	const test = await abTestRow(db, projectId, campaignId);
	if (!test) return false;
	if (test.status === "testing") return true;
	const variants = parseStoredJson<AbVariant[]>(test.variants_json, []);
	if (test.status === "pending") {
		const count = await db
			.prepare(`SELECT COUNT(*) AS total ${audience.sql}`)
			.bind(...audience.bindings)
			.first<{ total: number }>();
		const total = Number(count?.total ?? 0);
		const sample = Math.min(
			total,
			Math.max(variants.length, Math.ceil((total * test.test_percent) / 100)),
		);
		await db
			.prepare(
				`INSERT INTO email_deliveries
          (id, project_id, campaign_id, subscriber_id, recipient_email, recipient_name, status, variant_id, variant_phase)
         SELECT lower(hex(randomblob(16))), sample.project_id, ?, sample.id, sample.email, sample.name, 'pending',
           char(97 + ((sample.position - 1) % ?)), 'test'
         FROM (SELECT subscriber.project_id, subscriber.id, subscriber.email, subscriber.name,
             ROW_NUMBER() OVER (ORDER BY random()) AS position ${audience.sql}) sample
         WHERE sample.position <= ?
         ON CONFLICT(campaign_id, subscriber_id) DO NOTHING`,
			)
			.bind(campaignId, variants.length, ...audience.bindings, sample)
			.run();
		const now = Date.now();
		await db
			.prepare(
				`UPDATE marketing_campaign_ab_tests SET status='testing', test_started_at=?, test_ends_at=?,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE project_id=? AND campaign_id=? AND status='pending'`,
			)
			.bind(
				new Date(now).toISOString(),
				new Date(now + test.test_duration_minutes * 60_000).toISOString(),
				projectId,
				campaignId,
			)
			.run();
		return true;
	}
	const winner = test.winner_variant_id ?? variants[0]?.id ?? "a";
	await db
		.prepare(
			`INSERT INTO email_deliveries
        (id, project_id, campaign_id, subscriber_id, recipient_email, recipient_name, status, variant_id, variant_phase)
       SELECT lower(hex(randomblob(16))), subscriber.project_id, ?, subscriber.id, subscriber.email, subscriber.name,
         'pending', ?, 'winner'
       ${audience.sql}
       ON CONFLICT(campaign_id, subscriber_id) DO NOTHING`,
		)
		.bind(campaignId, winner, ...audience.bindings)
		.run();
	if (test.status === "winner_selected")
		await db
			.prepare(
				`UPDATE marketing_campaign_ab_tests SET status='completed', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE project_id=? AND campaign_id=? AND status='winner_selected'`,
			)
			.bind(projectId, campaignId)
			.run();
	return true;
}

/** While a test waits for its winner, the campaign must not be marked finished. */
export async function abTestHoldsCampaign(db: D1Database, projectId: number, campaignId: string) {
	return Boolean(
		await db
			.prepare(
				"SELECT 1 FROM marketing_campaign_ab_tests WHERE project_id=? AND campaign_id=? AND status IN ('testing','winner_selected')",
			)
			.bind(projectId, campaignId)
			.first(),
	);
}

/** Chooses winners of tests whose duration elapsed, then sends them to the rest. */
export async function selectDueAbWinners(env: Env, now = new Date()) {
	const due = await env.DB.prepare(
		`SELECT test.* FROM marketing_campaign_ab_tests test
     JOIN campaigns campaign ON campaign.project_id = test.project_id AND campaign.id = test.campaign_id
     WHERE test.status = 'testing' AND test.test_ends_at <= ? AND campaign.status = 'running'
     ORDER BY test.test_ends_at LIMIT 50`,
	)
		.bind(now.toISOString())
		.all<AbTestRow>();
	let selected = 0;
	for (const test of due.results) {
		const variants = parseStoredJson<AbVariant[]>(test.variants_json, []);
		if (!variants.length) continue;
		const results = await variantResults(env.DB, test.project_id, test.campaign_id);
		const winner = pickWinner(variants, results, test.winner_metric);
		const claimed = await env.DB.prepare(
			`UPDATE marketing_campaign_ab_tests SET status='winner_selected', winner_variant_id=?,
         winner_selected_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE project_id=? AND campaign_id=? AND status='testing' RETURNING campaign_id`,
		)
			.bind(winner, test.project_id, test.campaign_id)
			.first();
		if (!claimed) continue;
		await env.DB.prepare(
			`INSERT INTO audit_events (id, project_id, action, actor_id, request_id, payload_json)
       VALUES (?, ?, 'campaign.ab_test.winner_selected', 'system', ?, ?)`,
		)
			.bind(
				crypto.randomUUID(),
				test.project_id,
				crypto.randomUUID(),
				JSON.stringify({
					campaign_id: test.campaign_id,
					winner_variant_id: winner,
					metric: test.winner_metric,
					results,
				}),
			)
			.run();
		await env.MARKETING_QUEUE.send({
			type: "marketing.campaign.dispatch",
			projectId: test.project_id,
			campaignId: test.campaign_id,
		} satisfies MarketingQueueJob);
		selected += 1;
	}
	return selected;
}

async function editableCampaign(db: D1Database, projectId: number, campaignId: string) {
	const campaign = await db
		.prepare("SELECT id, status, subject, template_id FROM campaigns WHERE project_id=? AND id=?")
		.bind(projectId, campaignId)
		.first<{ id: string; status: string; subject: string; template_id: string | null }>();
	if (!campaign) throw failure("campaign_not_found", "Campaign not found", 404);
	return campaign;
}

async function validateAbTestInput(
	db: D1Database,
	projectId: number,
	body: Record<string, unknown>,
) {
	const raw: unknown[] = Array.isArray(body.variants) ? body.variants : [];
	if (raw.length < 2 || raw.length > 3)
		throw failure("AB_TEST_VARIANTS_INVALID", "An A/B test needs two or three variants.");
	const variants: AbVariant[] = [];
	for (const [index, item] of raw.entries()) {
		const source = isRecord(item) ? item : {};
		const subject = typeof source.subject === "string" ? source.subject.trim() : "";
		if (!subject || subject.length > 500)
			throw failure(
				"AB_TEST_VARIANTS_INVALID",
				"Each variant needs a subject of at most 500 characters.",
			);
		const templateId =
			typeof source.template_id === "string" && source.template_id.trim()
				? source.template_id.trim()
				: null;
		if (templateId && !(await getPublishedEmailTemplate(db, projectId, templateId)))
			throw failure(
				"EMAIL_TEMPLATE_NOT_PUBLISHED",
				"Publish each variant email before testing it.",
				409,
			);
		variants.push({ id: VARIANT_IDS[index] ?? "a", subject, template_id: templateId });
	}
	const percent = body.test_percent === undefined ? 20 : Number(body.test_percent);
	if (!Number.isInteger(percent) || percent < 5 || percent > 50)
		throw failure(
			"AB_TEST_PERCENT_INVALID",
			"The test group must be between 5% and 50% of the audience.",
		);
	const metric = body.winner_metric === undefined ? "open_rate" : body.winner_metric;
	if (metric !== "open_rate" && metric !== "click_rate")
		throw failure("AB_TEST_METRIC_INVALID", "Choose the open rate or the click rate.");
	const minutes =
		body.test_duration_minutes === undefined ? 240 : Number(body.test_duration_minutes);
	if (!Number.isInteger(minutes) || minutes < 30 || minutes > 10_080)
		throw failure("AB_TEST_DURATION_INVALID", "The test must last between 30 minutes and 7 days.");
	return { variants, test_percent: percent, winner_metric: metric, test_duration_minutes: minutes };
}

export const abTestRoutes = registerRouter(
	new Hono<{ Bindings: Env; Variables: { project: ProjectContext } }>(),
	{
		service: "marketing",
		module: "ab-tests.abTestRoutes",
		pluginId: "superboard-marketing",
		surface: "internal",
		access: "internal",
	},
);

abTestRoutes.get("/ab-tests", async (c) => {
	const rows = await c.env.DB.prepare(
		"SELECT * FROM marketing_campaign_ab_tests WHERE project_id=? ORDER BY updated_at DESC LIMIT 500",
	)
		.bind(c.get("project").projectId)
		.all<AbTestRow>();
	return c.json({ data: rows.results.map(serializeAbTest) });
});

abTestRoutes.get("/campaigns/:campaignId/ab-test", async (c) => {
	const projectId = c.get("project").projectId;
	await editableCampaign(c.env.DB, projectId, c.req.param("campaignId"));
	const row = await abTestRow(c.env.DB, projectId, c.req.param("campaignId"));
	return c.json({
		data: row
			? {
					...serializeAbTest(row),
					results: await variantResults(c.env.DB, projectId, row.campaign_id),
				}
			: null,
	});
});

abTestRoutes.put("/campaigns/:campaignId/ab-test", async (c) => {
	const projectId = c.get("project").projectId;
	const campaign = await editableCampaign(c.env.DB, projectId, c.req.param("campaignId"));
	if (!EDITABLE_CAMPAIGN.includes(campaign.status))
		throw failure(
			"campaign_locked",
			"Only draft, scheduled or paused campaigns can be edited",
			409,
		);
	const current = await abTestRow(c.env.DB, projectId, campaign.id);
	if (current && current.status !== "pending")
		throw failure("AB_TEST_LOCKED", "This A/B test has already started.", 409);
	const localSchedule = await c.env.DB.prepare(
		"SELECT 1 FROM marketing_campaign_send_windows WHERE project_id=? AND campaign_id=?",
	)
		.bind(projectId, campaign.id)
		.first();
	if (localSchedule)
		throw failure(
			"AB_TEST_WITH_LOCAL_TIME",
			"A/B tests cannot be combined with sending in each contact's time zone.",
			409,
		);
	const input = await validateAbTestInput(
		c.env.DB,
		projectId,
		await readJsonObject(c.req.raw, 64_000),
	);
	await c.env.DB.prepare(
		`INSERT INTO marketing_campaign_ab_tests
      (project_id, campaign_id, variants_json, test_percent, winner_metric, test_duration_minutes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, campaign_id) DO UPDATE SET variants_json=excluded.variants_json,
       test_percent=excluded.test_percent, winner_metric=excluded.winner_metric,
       test_duration_minutes=excluded.test_duration_minutes, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
	)
		.bind(
			projectId,
			campaign.id,
			JSON.stringify(input.variants),
			input.test_percent,
			input.winner_metric,
			input.test_duration_minutes,
		)
		.run();
	const row = await abTestRow(c.env.DB, projectId, campaign.id);
	if (!row) throw failure("AB_TEST_NOT_FOUND", "The A/B test could not be saved.", 500);
	return c.json({ data: { ...serializeAbTest(row), results: [] } });
});

abTestRoutes.delete("/campaigns/:campaignId/ab-test", async (c) => {
	const projectId = c.get("project").projectId;
	const campaign = await editableCampaign(c.env.DB, projectId, c.req.param("campaignId"));
	const removed = await c.env.DB.prepare(
		"DELETE FROM marketing_campaign_ab_tests WHERE project_id=? AND campaign_id=? AND status='pending' RETURNING campaign_id",
	)
		.bind(projectId, campaign.id)
		.first();
	if (!removed)
		throw failure("AB_TEST_LOCKED", "Only an A/B test that has not started can be removed.", 409);
	return c.json({ data: { deleted: true } });
});
