"use client";

import AdsPlatformSelect from "@superboard/front-ui/common/ads-platform.js";
import { DateRangePicker } from "@superboard/front-ui/components/dateRangePicker/DateRangePicker.js";
import { platformsFilterList } from "@superboard/front-ui/constants/FilterOptions.js";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { useTableParams } from "@superboard/front-ui/hooks/useTableParams.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Alert, AlertDescription } from "@superboard/front-ui/ui/alert.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superboard/front-ui/ui/select.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superboard/front-ui/ui/table.js";
import { Tabs, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { formatCurrencyFromCents } from "@superboard/front-ui/utils/formatCurrency.js";
import { BarChart3, Link2, Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useFlowI18n } from "../../../../flows/features/flows/i18n.js";
import {
	getLinkCampaignAnalytics,
	getLinks,
	getLinkStatistics,
	type CampaignAnalyticsRow,
	type DynamicLink,
	type LinkStatistics,
} from "../../../api/dynamic-links/dynamicLinksService.js";
import { useUrlState } from "../../../hooks/useUrlState.js";
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
	type BreakdownRow,
	type DailyTraffic,
	type MetricTotals,
} from "./linkAnalyticsSummary.js";

type AnalyticsData = {
	statistics: LinkStatistics;
	links: DynamicLink[];
	campaigns: CampaignAnalyticsRow[];
};

const dimensions = ["link", "campaign", "source", "platform"] as const;
type Dimension = (typeof dimensions)[number];
const dimensionLabels: Record<Dimension, string> = {
	link: "By link",
	campaign: "By campaign",
	source: "By source",
	platform: "By platform",
};
const platformLabels: Record<string, string> = {
	ios: "iOS",
	android: "Android",
	web: "Web",
	desktop: "Desktop",
	[UNKNOWN_PLATFORM]: "Unknown platform",
};
const countColumns = ["views", "opens", "installs", "appOpens", "referrals"] as const;
/** The links endpoint returns at most 100 rows; the most viewed links are requested. */
const LINK_LIMIT = 100;

const isoDate = (value?: Date) => value?.toISOString().slice(0, 10);

export function LinkMetricCards({
	totals,
	loading,
}: {
	totals: MetricTotals | null;
	loading: boolean;
}) {
	const { tr, locale } = useFlowI18n();
	const metrics: Array<[string, string]> = totals
		? [
				[tr("Views"), totals.views.toLocaleString(locale)],
				[tr("Clicks"), totals.clicks.toLocaleString(locale)],
				[tr("Opens"), totals.opens.toLocaleString(locale)],
				[tr("Installs"), totals.installs.toLocaleString(locale)],
				[tr("App opens"), totals.appOpens.toLocaleString(locale)],
				[tr("Referrals"), totals.referrals.toLocaleString(locale)],
				[tr("Revenue"), formatCurrencyFromCents(totals.revenue, locale)],
			]
		: [];
	if (!totals) return loading ? <div className="h-24 animate-pulse rounded-lg bg-muted" /> : null;
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
			{metrics.map(([label, value]) => (
				<Card key={label}>
					<CardHeader className="pb-4">
						<CardDescription>{label}</CardDescription>
						<CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
					</CardHeader>
				</Card>
			))}
		</div>
	);
}

export default function DynamicLinksAnalytics({ onCreateLink }: { onCreateLink: () => void }) {
	const { tr, locale } = useFlowI18n();
	const { selectedProject } = useProjectSelection();
	const { dateRange, setDateRange, platform, setPlatform } = useTableParams();
	const [campaignId, setCampaignId] = useUrlState("campaign", "");
	const [requestedDimension, setDimension] = useUrlState("by", "link");
	const dimension = dimensions.find((value) => value === requestedDimension) ?? "link";
	const [refresh, setRefresh] = useState(0);
	const [result, setResult] = useState<{
		request: string;
		data?: AnalyticsData;
		error?: string;
	} | null>(null);
	const from = isoDate(dateRange?.from);
	const to = isoDate(dateRange?.to);
	const projectId = selectedProject?.id;
	const request = JSON.stringify([projectId, campaignId, from, to, platform, refresh]);
	const loading = Boolean(projectId) && result?.request !== request;
	const data = result?.data ?? null;
	const error = result?.request === request ? (result.error ?? null) : null;

	useEffect(() => {
		if (!projectId) return;
		let current = true;
		const filters = { from, to, platform: platform || undefined };
		Promise.all([
			getLinkStatistics(projectId, {
				...filters,
				campaign_id: campaignId || undefined,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				interval: "day",
			}),
			getLinks(projectId, "", undefined, { ...filters, limit: LINK_LIMIT, sort_by: "views" }),
			getLinkCampaignAnalytics(projectId, filters),
		]).then(
			([statistics, links, campaigns]) => {
				if (current) setResult({ request, data: { statistics, links, campaigns } });
			},
			(cause: unknown) => {
				if (current)
					setResult((previous) => ({
						request,
						data: previous?.data,
						error: moduleErrorMessage(cause, locale),
					}));
			},
		);
		return () => {
			current = false;
		};
	}, [campaignId, from, locale, platform, projectId, request, to]);

	const summary = useMemo(() => {
		if (!data) return null;
		const links = campaignId
			? data.links.filter((link) => link.campaign_id === campaignId)
			: data.links;
		const campaigns = campaignId
			? data.campaigns.filter((campaign) => campaign.id === campaignId)
			: data.campaigns;
		return {
			totals: totalsFromStatistics(data.statistics),
			daily: dailyTraffic(data.statistics),
			rows: {
				link: linkBreakdown(links),
				campaign: campaignBreakdown(campaigns),
				source: sourceBreakdown(links),
				platform: platformBreakdown(data.statistics),
			} satisfies Record<Dimension, BreakdownRow[]>,
		};
	}, [campaignId, data]);

	if (!selectedProject) return <EmptyProject />;

	const label = (row: BreakdownRow) =>
		dimension === "platform"
			? tr(platformLabels[row.key] ?? row.label)
			: dimension === "source" && row.key === DIRECT_SOURCE
				? tr("Direct (no source)")
				: row.label;
	const active = summary ? hasActivity(summary.totals) : false;

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap gap-2">
					<DateRangePicker date={dateRange} setDate={setDateRange} />
					<AdsPlatformSelect
						platformAdsOptions={platformsFilterList}
						selectedAdsPlatform={platform}
						setSelectedAdsPlatforms={setPlatform}
						title={tr("Platforms")}
						selectListTitle={tr("Platforms")}
					/>
					<Select
						value={campaignId || "all"}
						onValueChange={(value) => {
							setCampaignId(value === "all" ? "" : value);
						}}
					>
						<SelectTrigger className="w-52" aria-label={tr("Campaign")}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">{tr("All campaigns")}</SelectItem>
							{data?.campaigns.map((campaign) => (
								<SelectItem key={campaign.id} value={campaign.id}>
									{campaign.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<Button
					variant="outline"
					disabled={loading}
					onClick={() => {
						setRefresh((value) => value + 1);
					}}
				>
					<RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
					{tr(loading ? "Refreshing…" : "Refresh")}
				</Button>
			</div>

			{error ? (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			<LinkMetricCards totals={summary?.totals ?? null} loading={loading} />

			<Card>
				<CardHeader>
					<CardTitle>{tr("Daily traffic")}</CardTitle>
					<CardDescription>
						{tr("Link views and clicks per day for the selected period.")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{loading && !summary ? (
						<div className="h-56 animate-pulse rounded-lg bg-muted" />
					) : summary && active ? (
						<TrafficChart series={summary.daily} />
					) : (
						<div
							role="status"
							className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center"
						>
							<BarChart3 className="mb-3 size-8 text-muted-foreground" />
							<p className="font-medium">{tr("No link activity for this period")}</p>
							<p className="max-w-md text-sm text-muted-foreground">
								{tr(
									"Share a dynamic link or widen the date range. Views, installs, opens, referrals and revenue appear here as soon as they are attributed.",
								)}
							</p>
							{data && !data.links.length ? (
								<Button className="mt-4" size="sm" onClick={onCreateLink}>
									<Plus className="size-4" />
									{tr("Create link")}
								</Button>
							) : null}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<CardTitle>{tr("Breakdown")}</CardTitle>
						<CardDescription>
							{tr("Compare attributed results by link, campaign, source and platform.")}
						</CardDescription>
					</div>
					<Tabs value={dimension} onValueChange={setDimension}>
						<TabsList className="h-auto flex-wrap">
							{dimensions.map((value) => (
								<TabsTrigger key={value} value={value}>
									{tr(dimensionLabels[value])}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
				</CardHeader>
				<CardContent className="space-y-2">
					<div className="overflow-x-auto rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{tr(dimensionLabels[dimension])}</TableHead>
									<TableHead className="text-end">{tr("Views")}</TableHead>
									<TableHead className="text-end">{tr("Opens")}</TableHead>
									<TableHead className="text-end">{tr("Installs")}</TableHead>
									<TableHead className="text-end">{tr("App opens")}</TableHead>
									<TableHead className="text-end">{tr("Referrals")}</TableHead>
									<TableHead className="text-end">{tr("Revenue")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{summary?.rows[dimension].length ? (
									summary.rows[dimension].map((row) => (
										<TableRow key={row.key}>
											<TableCell>
												<span className="font-medium">{label(row)}</span>
												{row.detail ? (
													<code className="ms-2 text-xs text-muted-foreground">{row.detail}</code>
												) : null}
											</TableCell>
											{countColumns.map((metric) => (
												<TableCell key={metric} className="text-end tabular-nums">
													{row.totals[metric].toLocaleString(locale)}
												</TableCell>
											))}
											<TableCell className="text-end tabular-nums">
												{formatCurrencyFromCents(row.totals.revenue, locale)}
											</TableCell>
										</TableRow>
									))
								) : (
									<TableRow>
										<TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
											{loading ? (
												tr("Loading…")
											) : (
												<span className="inline-flex items-center gap-2">
													<Link2 className="size-4" />
													{tr("No results for these filters.")}
												</span>
											)}
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
					{dimension === "link" || dimension === "source" ? (
						<p className="text-xs text-muted-foreground">
							{tr("Based on the 100 most viewed links in the selected period.")}
						</p>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}

function TrafficChart({ series }: { series: DailyTraffic[] }) {
	const { tr, locale } = useFlowI18n();
	const maximum = Math.max(1, ...series.map((point) => point.value));
	return (
		<div
			role="img"
			aria-label={tr("Link views and clicks per day for the selected period.")}
			className="flex h-56 items-end gap-0.5 overflow-x-auto rounded-lg border bg-muted/20 p-4"
		>
			{series.map((point) => (
				<div
					key={point.date}
					className="group flex h-full min-w-4 flex-1 items-end"
					title={`${point.date}: ${point.value.toLocaleString(locale)}`}
				>
					<div
						className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
						style={{ height: `${Math.max(2, (point.value / maximum) * 100)}%` }}
					/>
				</div>
			))}
		</div>
	);
}
