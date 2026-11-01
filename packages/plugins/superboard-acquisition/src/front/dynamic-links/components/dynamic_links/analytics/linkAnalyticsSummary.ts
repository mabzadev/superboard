import type {
	CampaignAnalyticsRow,
	DynamicLink,
	LinkStatistics,
} from "../../../api/dynamic-links/dynamicLinksService.js";

export type MetricTotals = {
	views: number;
	clicks: number;
	opens: number;
	installs: number;
	appOpens: number;
	referrals: number;
	revenue: number;
};

export type BreakdownRow = {
	key: string;
	label: string;
	detail?: string;
	totals: MetricTotals;
};

export type DailyTraffic = { date: string; value: number };

/** Direct links have no UTM source; they are grouped under this key. */
export const DIRECT_SOURCE = "direct";
/** Events recorded without a platform are grouped under this key. */
export const UNKNOWN_PLATFORM = "unknown";

const METRICS = [
	"views",
	"clicks",
	"opens",
	"installs",
	"appOpens",
	"referrals",
	"revenue",
] as const satisfies ReadonlyArray<keyof MetricTotals>;

const eventMetric: Record<string, keyof MetricTotals> = {
	view: "views",
	click: "clicks",
	redirect: "clicks",
	open: "opens",
	install: "installs",
	app_open: "appOpens",
	user_referred: "referrals",
};

export function emptyTotals(): MetricTotals {
	return { views: 0, clicks: 0, opens: 0, installs: 0, appOpens: 0, referrals: 0, revenue: 0 };
}

function numeric(value: unknown) {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function totalsFromStatistics(statistics: LinkStatistics): MetricTotals {
	const totals = statistics.totals;
	return {
		views: numeric(totals.views),
		clicks: numeric(totals.clicks),
		opens: numeric(totals.opens),
		installs: numeric(totals.installs),
		appOpens: numeric(totals.app_opens),
		referrals: numeric(totals.user_referred),
		revenue: numeric(totals.revenue),
	};
}

export function hasActivity(totals: MetricTotals) {
	return Object.values(totals).some((value) => value > 0);
}

/** Views and clicks per day, matching the Overview link-views chart. */
export function dailyTraffic(statistics: LinkStatistics): DailyTraffic[] {
	const days = new Map<string, number>();
	for (const point of statistics.series) {
		const metric = eventMetric[String(point.event_type)];
		if (metric !== "views" && metric !== "clicks") continue;
		const date = typeof point.date === "string" ? point.date : "";
		if (!date) continue;
		days.set(date, (days.get(date) ?? 0) + numeric(point.count));
	}
	return [...days.entries()]
		.map(([date, value]) => ({ date, value }))
		.sort((left, right) => left.date.localeCompare(right.date));
}

function byTraffic(left: BreakdownRow, right: BreakdownRow) {
	const traffic = (row: BreakdownRow) => row.totals.views + row.totals.clicks;
	return (
		traffic(right) - traffic(left) ||
		right.totals.installs - left.totals.installs ||
		left.label.localeCompare(right.label)
	);
}

export function platformBreakdown(statistics: LinkStatistics): BreakdownRow[] {
	const platforms = new Map<string, MetricTotals>();
	for (const point of statistics.series) {
		const key =
			typeof point.platform === "string" && point.platform ? point.platform : UNKNOWN_PLATFORM;
		const totals = platforms.get(key) ?? emptyTotals();
		const metric = eventMetric[String(point.event_type)];
		if (metric) totals[metric] += numeric(point.count);
		totals.revenue += numeric(point.revenue_cents);
		platforms.set(key, totals);
	}
	return [...platforms.entries()]
		.map(([key, totals]) => ({ key, label: key, totals }))
		.sort(byTraffic);
}

function linkTotals(link: DynamicLink): MetricTotals {
	return {
		views: numeric(link.total_views),
		clicks: 0,
		opens: numeric(link.total_opens),
		installs: numeric(link.total_installs),
		appOpens: numeric(link.total_app_opens),
		referrals: numeric(link.total_user_referred),
		revenue: numeric(link.total_revenue),
	};
}

export function linkBreakdown(links: DynamicLink[]): BreakdownRow[] {
	return links
		.map((link) => ({
			key: link.id,
			label: link.name || link.slug,
			detail: `/${link.slug}`,
			totals: linkTotals(link),
		}))
		.sort(byTraffic);
}

export function linkSource(link: DynamicLink) {
	const source = typeof link.utm.source === "string" ? link.utm.source.trim() : "";
	return source || DIRECT_SOURCE;
}

export function sourceBreakdown(links: DynamicLink[]): BreakdownRow[] {
	const sources = new Map<string, MetricTotals>();
	for (const link of links) {
		const key = linkSource(link);
		const totals = sources.get(key) ?? emptyTotals();
		const current = linkTotals(link);
		for (const metric of METRICS) totals[metric] += current[metric];
		sources.set(key, totals);
	}
	return [...sources.entries()]
		.map(([key, totals]) => ({ key, label: key, totals }))
		.sort(byTraffic);
}

export function campaignBreakdown(campaigns: CampaignAnalyticsRow[]): BreakdownRow[] {
	return campaigns
		.map((campaign) => ({
			key: campaign.id,
			label: campaign.name,
			detail: campaign.slug,
			totals: {
				views: numeric(campaign.total_views),
				clicks: 0,
				opens: numeric(campaign.total_opens),
				installs: numeric(campaign.total_installs),
				appOpens: numeric(campaign.total_app_opens),
				referrals: numeric(campaign.total_user_referred),
				revenue: numeric(campaign.total_revenue),
			},
		}))
		.sort(byTraffic);
}
