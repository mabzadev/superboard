import { describe, expect, it } from "vitest";

import type {
	CampaignAnalyticsRow,
	DynamicLink,
	LinkStatistics,
} from "../../../../../../../../../packages/plugins/superboard-acquisition/src/front/dynamic-links/api/dynamic-links/dynamicLinksService.js";
import {
	campaignBreakdown,
	dailyTraffic,
	DIRECT_SOURCE,
	hasActivity,
	linkBreakdown,
	platformBreakdown,
	sourceBreakdown,
	totalsFromStatistics,
	UNKNOWN_PLATFORM,
} from "../../../../../../../../../packages/plugins/superboard-acquisition/src/front/dynamic-links/components/dynamic_links/analytics/linkAnalyticsSummary.js";

const statistics: LinkStatistics = {
	totals: {
		views: 7,
		clicks: 3,
		opens: 2,
		installs: 4,
		app_opens: 1,
		user_referred: 2,
		revenue: 1500,
	},
	series: [
		{ date: "2026-10-02", event_type: "view", platform: "ios", count: 5, revenue_cents: 0 },
		{ date: "2026-10-01", event_type: "click", platform: "android", count: 3, revenue_cents: 0 },
		{ date: "2026-10-02", event_type: "redirect", platform: null, count: "2", revenue_cents: 0 },
		{ date: "2026-10-02", event_type: "install", platform: "ios", count: 4, revenue_cents: 0 },
		{
			date: "2026-10-02",
			event_type: "conversion",
			platform: "ios",
			count: 1,
			revenue_cents: 1500,
		},
	],
};

function link(overrides: Partial<DynamicLink>): DynamicLink {
	return {
		id: "link",
		slug: "link",
		name: "Link",
		destination_url: "https://example.test",
		destinations: {},
		utm: {},
		active: true,
		created_at: "2026-10-01",
		...overrides,
	};
}

describe("link analytics summary", () => {
	it("maps the statistics totals used by the Overview dashboard", () => {
		const totals = totalsFromStatistics(statistics);
		expect(totals).toEqual({
			views: 7,
			clicks: 3,
			opens: 2,
			installs: 4,
			appOpens: 1,
			referrals: 2,
			revenue: 1500,
		});
		expect(hasActivity(totals)).toBe(true);
		expect(hasActivity(totalsFromStatistics({ totals: {}, series: [] }))).toBe(false);
	});

	it("counts views, clicks and redirects per day in date order", () => {
		expect(dailyTraffic(statistics)).toEqual([
			{ date: "2026-10-01", value: 3 },
			{ date: "2026-10-02", value: 7 },
		]);
	});

	it("groups events by platform and keeps unattributed platforms visible", () => {
		const rows = platformBreakdown(statistics);
		expect(rows.map((row) => row.key)).toEqual(["ios", "android", UNKNOWN_PLATFORM]);
		expect(rows[0]!.totals).toMatchObject({ views: 5, installs: 4, revenue: 1500 });
		expect(rows[2]!.totals.clicks).toBe(2);
	});

	it("ranks links and aggregates them by acquisition source", () => {
		const links = [
			link({ id: "a", slug: "a", name: "A", utm: { source: "tiktok" }, total_views: 2 }),
			link({ id: "b", slug: "b", name: "B", utm: { source: "tiktok" }, total_views: 5 }),
			link({ id: "c", slug: "c", name: "", total_views: 9, total_revenue: 300 }),
		];
		expect(linkBreakdown(links).map((row) => [row.label, row.detail])).toEqual([
			["c", "/c"],
			["B", "/b"],
			["A", "/a"],
		]);
		expect(
			sourceBreakdown(links).map((row) => [row.key, row.totals.views, row.totals.revenue]),
		).toEqual([
			[DIRECT_SOURCE, 9, 300],
			["tiktok", 7, 0],
		]);
	});

	it("maps campaign analytics rows", () => {
		const campaign: CampaignAnalyticsRow = {
			id: "campaign-1",
			name: "Launch",
			slug: "launch",
			status: "active",
			metadata: {},
			created_at: "2026-10-01",
			total_views: 4,
			total_opens: 3,
			total_installs: 2,
			total_reinstalls: 0,
			total_reactivations: 0,
			total_app_opens: 1,
			total_user_referred: 1,
			total_revenue: 990,
		};
		expect(campaignBreakdown([campaign])[0]).toMatchObject({
			key: "campaign-1",
			label: "Launch",
			totals: { views: 4, opens: 3, installs: 2, referrals: 1, revenue: 990 },
		});
	});
});
