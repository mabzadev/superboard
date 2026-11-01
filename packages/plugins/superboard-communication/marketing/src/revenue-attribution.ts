import type { MarketingSignalV1 } from "@superboard/contracts/analytics";

import { isRecord } from "./audience-shared.js";
import { readGrowthSettings } from "./brand-kit.js";
import type { InsightScope } from "./link-analytics.js";

const REVENUE_EVENT_TYPES = new Set(["initial_purchase", "renewal", "trial_converted"]);
const REFUND_EVENTS = new Set(["customer.refund"]);

function positiveInteger(value: unknown) {
	const number =
		typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function currencyOf(properties: Record<string, unknown>) {
	const metadata = isRecord(properties.metadata) ? properties.metadata : {};
	const value = properties.currency ?? metadata.currency;
	return typeof value === "string" && /^[A-Za-z]{3}$/u.test(value) ? value.toUpperCase() : null;
}

/**
 * Revenue carried by an incoming signal, in cents. SDK customer events report
 * `reported_revenue_cents`; verified store purchases report `amount_micros`.
 * Refunds, chargebacks and cancellations never count as attributed revenue.
 */
export function signalRevenue(
	signal: Pick<MarketingSignalV1, "event_name" | "properties">,
): { cents: number; currency: string | null } | null {
	if (REFUND_EVENTS.has(signal.event_name)) return null;
	const properties = signal.properties ?? {};
	const eventType = typeof properties.event_type === "string" ? properties.event_type : null;
	if (eventType && !REVENUE_EVENT_TYPES.has(eventType)) return null;
	const cents =
		positiveInteger(properties.reported_revenue_cents) ??
		positiveInteger(properties.revenue_cents) ??
		(() => {
			const micros = positiveInteger(properties.amount_micros);
			return micros ? Math.round(micros / 10_000) || null : null;
		})();
	return cents ? { cents, currency: currencyOf(properties) } : null;
}

/** Attributes a purchase to the contact's last email click inside the attribution window. */
export async function attributeSignalRevenue(
	db: D1Database,
	projectId: number,
	subscriberId: string,
	signal: Pick<MarketingSignalV1, "event_id" | "event_name" | "properties" | "occurred_at">,
): Promise<{ attributed: boolean; source_type?: "campaign" | "journey"; source_id?: string }> {
	const revenue = signalRevenue(signal);
	if (!revenue) return { attributed: false };
	const { attribution_window_days: days } = await readGrowthSettings(db, projectId);
	const click = await db
		.prepare(
			`SELECT e.campaign_id, e.delivery_id, strftime('%Y-%m-%dT%H:%M:%fZ', e.occurred_at) AS occurred_at,
         EXISTS (SELECT 1 FROM campaigns c WHERE c.project_id = ? AND c.id = e.campaign_id) AS is_campaign,
         EXISTS (SELECT 1 FROM marketing_journeys j WHERE j.project_id = ? AND j.id = e.campaign_id) AS is_journey
       FROM email_events e
       WHERE e.project_id = ? AND e.subscriber_id = ? AND e.event_type = 'click'
         AND julianday(e.occurred_at) <= julianday(?)
         AND julianday(e.occurred_at) >= julianday(?) - ?
       ORDER BY julianday(e.occurred_at) DESC LIMIT 1`,
		)
		.bind(
			projectId,
			projectId,
			projectId,
			subscriberId,
			signal.occurred_at,
			signal.occurred_at,
			days,
		)
		.first<{
			campaign_id: string;
			delivery_id: string | null;
			occurred_at: string;
			is_campaign: number;
			is_journey: number;
		}>();
	if (!click || (!click.is_campaign && !click.is_journey)) return { attributed: false };
	const sourceType = click.is_campaign ? "campaign" : "journey";
	await db
		.prepare(
			`INSERT INTO marketing_revenue_attributions
        (project_id, event_id, event_name, subscriber_id, source_type, source_id, delivery_id,
         revenue_cents, currency, clicked_at, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, event_id) DO NOTHING`,
		)
		.bind(
			projectId,
			signal.event_id,
			signal.event_name,
			subscriberId,
			sourceType,
			click.campaign_id,
			click.delivery_id,
			revenue.cents,
			revenue.currency,
			click.occurred_at,
			signal.occurred_at,
		)
		.run();
	return { attributed: true, source_type: sourceType, source_id: click.campaign_id };
}

type RevenueRow = {
	source_type: "campaign" | "journey";
	source_id: string;
	name: string | null;
	currency: string | null;
	conversions: number;
	revenue_cents: number;
};

export async function revenueBySource(
	db: D1Database,
	projectId: number,
	scope: InsightScope & { journey_id?: string | null } = {},
): Promise<RevenueRow[]> {
	const clauses = ["r.project_id = ?"];
	const values: Array<string | number> = [projectId];
	const source = scope.campaign_id ?? scope.journey_id;
	if (source) {
		clauses.push("r.source_id = ?");
		values.push(source);
	}
	if (scope.template_id) {
		clauses.push(`r.delivery_id IN (
      SELECT delivery.id FROM email_deliveries delivery
        JOIN campaigns campaign ON campaign.project_id = delivery.project_id AND campaign.id = delivery.campaign_id
        WHERE delivery.project_id = ? AND campaign.template_id = ?
      UNION ALL
      SELECT journey.id FROM marketing_journey_deliveries journey
        WHERE journey.project_id = ? AND json_extract(journey.metadata_json, '$.template_id') = ?)`);
		values.push(projectId, scope.template_id, projectId, scope.template_id);
	}
	if (scope.from) {
		clauses.push("julianday(r.occurred_at) >= julianday(?)");
		values.push(scope.from);
	}
	if (scope.to) {
		clauses.push("julianday(r.occurred_at) <= julianday(?)");
		values.push(scope.to);
	}
	const rows = await db
		.prepare(
			`SELECT r.source_type, r.source_id, COALESCE(c.name, j.name) AS name, r.currency,
         COUNT(*) AS conversions, SUM(r.revenue_cents) AS revenue_cents
       FROM marketing_revenue_attributions r
       LEFT JOIN campaigns c ON r.source_type = 'campaign' AND c.project_id = r.project_id AND c.id = r.source_id
       LEFT JOIN marketing_journeys j ON r.source_type = 'journey' AND j.project_id = r.project_id AND j.id = r.source_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY r.source_type, r.source_id, r.currency
       ORDER BY revenue_cents DESC LIMIT 100`,
		)
		.bind(...values)
		.all<RevenueRow>();
	return rows.results.map((row) => ({
		...row,
		conversions: Number(row.conversions),
		revenue_cents: Number(row.revenue_cents),
	}));
}
