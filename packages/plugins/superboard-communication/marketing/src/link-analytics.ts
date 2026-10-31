import { failure } from "./auth.js";
import { sha256 } from "./secrets.js";

type ClickPayload = {
	projectId: number;
	campaignId: string;
	subscriberId: string;
	deliveryId: string;
};

export function rate(value: number, total: number) {
	return total > 0 ? Math.round((value / total) * 10_000) / 100 : 0;
}

/**
 * Counts every click on a tracked link. The first click of a recipient on a
 * link shares its id with the email_events row, so unique clicks keep coming
 * from email_events and the total comes from this counter.
 */
export async function recordLinkClick(db: D1Database, payload: ClickPayload, target: string) {
	const eventId = `click:${payload.deliveryId}:${await sha256(target)}`;
	await db
		.prepare(
			`INSERT INTO email_link_clicks
        (project_id, event_id, campaign_id, delivery_id, subscriber_id, target_url)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, event_id) DO UPDATE SET clicks = clicks + 1,
         last_clicked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		)
		.bind(
			payload.projectId,
			eventId,
			payload.campaignId,
			payload.deliveryId,
			payload.subscriberId,
			target.slice(0, 4096),
		)
		.run();
}

/** Rates for the project statistics totals, computed from email event counts. */
export function deliverabilityRates(totals: Record<string, number>) {
	const sent = totals.sent || 0;
	const base = totals.delivered || sent;
	const bounces = (totals.hard_bounce || 0) + (totals.soft_bounce || 0);
	return {
		bounces,
		bounce_rate: rate(bounces, sent),
		unsubscribe_rate: rate(totals.unsubscribe || 0, base),
		complaint_rate: rate(totals.complaint || 0, base),
	};
}

export type InsightScope = {
	campaign_id?: string | null;
	template_id?: string | null;
	from?: string | null;
	to?: string | null;
};

export function insightScope(params: URLSearchParams): InsightScope {
	const scope: InsightScope = {};
	for (const key of ["campaign_id", "template_id"] as const) {
		const value = params.get(key);
		if (value) {
			if (value.length > 255) throw failure(`${key}_invalid`, `${key} is invalid`);
			scope[key] = value;
		}
	}
	for (const key of ["from", "to"] as const) {
		const value = params.get(key);
		if (value) {
			if (!Number.isFinite(Date.parse(value)))
				throw failure("EMAIL_DATE_INVALID", "Choose valid dates.");
			scope[key] = new Date(value).toISOString();
		}
	}
	return scope;
}

/** SQL restricting `alias` email_events rows to a campaign, journey or template. */
function eventScopeSql(projectId: number, scope: InsightScope, alias = "e") {
	const clauses = [`${alias}.project_id = ?`];
	const values: Array<string | number> = [projectId];
	if (scope.campaign_id) {
		clauses.push(`${alias}.campaign_id = ?`);
		values.push(scope.campaign_id);
	}
	if (scope.template_id) {
		clauses.push(`${alias}.delivery_id IN (
      SELECT delivery.id FROM email_deliveries delivery
        JOIN campaigns campaign ON campaign.project_id = delivery.project_id AND campaign.id = delivery.campaign_id
        WHERE delivery.project_id = ? AND campaign.template_id = ?
      UNION ALL
      SELECT journey.id FROM marketing_journey_deliveries journey
        WHERE journey.project_id = ? AND json_extract(journey.metadata_json, '$.template_id') = ?)`);
		values.push(projectId, scope.template_id, projectId, scope.template_id);
	}
	if (scope.from) {
		clauses.push(`julianday(${alias}.occurred_at) >= julianday(?)`);
		values.push(scope.from);
	}
	if (scope.to) {
		clauses.push(`julianday(${alias}.occurred_at) <= julianday(?)`);
		values.push(scope.to);
	}
	return { sql: clauses.join(" AND "), values };
}

export async function emailEngagement(db: D1Database, projectId: number, scope: InsightScope) {
	const where = eventScopeSql(projectId, scope);
	const row = await db
		.prepare(
			`SELECT
        COUNT(DISTINCT CASE WHEN e.event_type = 'sent' THEN e.delivery_id END) AS sent,
        COUNT(DISTINCT CASE WHEN e.event_type = 'delivered' THEN e.delivery_id END) AS delivered,
        COUNT(DISTINCT CASE WHEN e.event_type = 'open' THEN e.delivery_id END) AS unique_opens,
        COUNT(DISTINCT CASE WHEN e.event_type = 'click' THEN e.delivery_id END) AS unique_clicks,
        COUNT(DISTINCT CASE WHEN e.event_type = 'unsubscribe' THEN e.delivery_id END) AS unsubscribes,
        COUNT(DISTINCT CASE WHEN e.event_type IN ('hard_bounce', 'soft_bounce') THEN e.delivery_id END) AS bounces,
        COUNT(DISTINCT CASE WHEN e.event_type = 'complaint' THEN e.delivery_id END) AS complaints
       FROM email_events e WHERE ${where.sql}`,
		)
		.bind(...where.values)
		.first<Record<string, number>>();
	const value = (key: string) => Number(row?.[key] ?? 0);
	const sent = value("sent");
	const base = value("delivered") || sent;
	return {
		sent,
		delivered: value("delivered"),
		unique_opens: value("unique_opens"),
		unique_clicks: value("unique_clicks"),
		unsubscribes: value("unsubscribes"),
		bounces: value("bounces"),
		complaints: value("complaints"),
		open_rate: rate(value("unique_opens"), base),
		click_rate: rate(value("unique_clicks"), base),
		click_to_open_rate: rate(value("unique_clicks"), value("unique_opens")),
		unsubscribe_rate: rate(value("unsubscribes"), base),
		bounce_rate: rate(value("bounces"), sent),
		complaint_rate: rate(value("complaints"), base),
	};
}

type LinkReportRow = {
	url: string;
	unique_clicks: number;
	total_clicks: number;
	click_rate: number;
};

/** Per-link clicks for a campaign, journey or email; CTR is unique clicks per recipient. */
export async function linkReport(
	db: D1Database,
	projectId: number,
	scope: InsightScope,
	recipients: number,
): Promise<LinkReportRow[]> {
	const where = eventScopeSql(projectId, scope);
	const rows = await db
		.prepare(
			`SELECT json_extract(e.metadata_json, '$.target') AS url,
        COUNT(DISTINCT e.delivery_id) AS unique_clicks,
        SUM(COALESCE(link.clicks, 1)) AS total_clicks
       FROM email_events e
       LEFT JOIN email_link_clicks link ON link.project_id = ? AND link.event_id = e.id
       WHERE ${where.sql} AND e.event_type = 'click'
         AND json_extract(e.metadata_json, '$.target') IS NOT NULL
       GROUP BY url ORDER BY unique_clicks DESC, total_clicks DESC, url LIMIT 100`,
		)
		.bind(projectId, ...where.values)
		.all<{ url: string; unique_clicks: number; total_clicks: number }>();
	return rows.results.map((row) => ({
		url: String(row.url),
		unique_clicks: Number(row.unique_clicks),
		total_clicks: Number(row.total_clicks),
		click_rate: rate(Number(row.unique_clicks), recipients),
	}));
}
