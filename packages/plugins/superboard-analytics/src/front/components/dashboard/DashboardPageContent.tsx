"use client";

import AdsPlatformSelect from "@superboard/front-ui/common/ads-platform.js";
import { DateRangePicker } from "@superboard/front-ui/components/dateRangePicker/DateRangePicker.js";
import { platformsFilterList } from "@superboard/front-ui/constants/FilterOptions.js";
import { usePluginEnabled } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { useTableParams } from "@superboard/front-ui/hooks/useTableParams.js";
import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "@superboard/front-ui/modules/ModulePage.js";
import Link from "@superboard/front-ui/next-link";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superboard/front-ui/ui/table.js";
import {
	ArrowRight,
	Check,
	Circle,
	KeyRound,
	Link2,
	PackageCheck,
	RefreshCw,
	Rocket,
	Route,
	Smartphone,
	TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	getAnalyticsOverview,
	type AnalyticsOverview,
} from "../../api/analytics/analyticsService.js";
import {
	getAccessKey,
	getAppOverview,
	type AccessKeyInfo,
	type AppOverview,
} from "../../api/app/appService.js";
import {
	getDomains,
	getLinkCampaigns,
	getLinks,
	getLinkStatistics,
	getRedirectRules,
	type DynamicLink,
	type LinkDomain,
	type LinkStatistics,
	type RedirectRule,
} from "../../api/dynamic-links/dynamicLinksService.js";
import {
	getProducts,
	getProductStatistics,
	type ProductStatistics,
} from "../../api/products/productsService.js";
import { useAnalyticsI18n } from "../analytics/analytics-i18n.js";
import { SectionCards, type DashBoardCardType } from "../layout/section-cards.js";

/** Canonical destinations; legacy /app, /dynamic-links and /products routes are not used. */
const hrefs = {
	apiKeys: "/auth/settings?tab=security&section=keys",
	libraries: "/core/libraries",
	linkRouting: "/acquisition/dynamic-links?tab=settings&section=routing",
	links: "/acquisition/dynamic-links",
	linkAnalytics: "/acquisition/dynamic-links?tab=analytics",
	products: "/monetization/products",
} as const;

type Translate = ReturnType<typeof useAnalyticsI18n>["t"];

type Snapshot = {
	analytics?: AnalyticsOverview;
	app?: AppOverview;
	accessKey?: AccessKeyInfo | null;
	links?: DynamicLink[];
	campaigns?: number;
	domains?: LinkDomain[];
	rules?: RedirectRule[];
	linkStatistics?: LinkStatistics;
	products?: number;
	productStatistics?: ProductStatistics;
};

type Integrations = { user: boolean; settings: boolean; links: boolean; products: boolean };

type DailyViews = { date: string; value: number };

const sourceNames = [
	"Analytics",
	"App overview",
	"Access key",
	"Links",
	"Campaigns",
	"Domains",
	"Redirect rules",
	"Link analytics",
	"Product catalog",
	"Purchase analytics",
] as const;

function viewsSeries(statistics: LinkStatistics): DailyViews[] {
	const values = new Map<string, number>();
	for (const point of statistics.series) {
		const type = typeof point.event_type === "string" ? point.event_type : "";
		if (!["view", "click", "redirect"].includes(type)) continue;
		const date = typeof point.date === "string" ? point.date : "Unknown";
		const count = typeof point.count === "number" ? point.count : Number(point.count) || 0;
		values.set(date, (values.get(date) ?? 0) + count);
	}
	return [...values.entries()]
		.map(([date, value]) => ({ date, value }))
		.sort((left, right) => left.date.localeCompare(right.date));
}

export default function DashboardPageContent() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const integrations: Integrations = {
		user: usePluginEnabled("superboard-user"),
		settings: usePluginEnabled("superboard-settings"),
		links: usePluginEnabled("superboard-dynamic-links"),
		products: usePluginEnabled("superboard-products"),
	};
	const { user: userEnabled, links: linksEnabled, products: productsEnabled } = integrations;
	const generation = useRef(0);
	const { dateRange, setDateRange, platform, setPlatform } = useTableParams();
	const [snapshot, setSnapshot] = useState<Snapshot>({});
	const [failures, setFailures] = useState<Array<{ source: number; message: string }>>([]);
	const [loading, setLoading] = useState(false);

	const load = useCallback(async () => {
		const currentGeneration = ++generation.current;
		setSnapshot({});
		setFailures([]);
		if (!selectedProject) {
			setLoading(false);
			return;
		}
		setLoading(true);
		const project = selectedProject.id;
		const filters = {
			from: dateRange?.from?.toISOString().slice(0, 10),
			to: dateRange?.to?.toISOString().slice(0, 10),
			platform: platform || undefined,
		};
		const to = dateRange?.to ?? new Date();
		const from = dateRange?.from ?? new Date(to.getTime() - 29 * 86_400_000);
		const skip = Promise.resolve(undefined);
		// Analytics' own overview always loads; optional providers are only called when enabled.
		const results = await Promise.allSettled([
			getAnalyticsOverview(project, { from: from.toISOString(), to: to.toISOString() }),
			userEnabled ? getAppOverview(project) : skip,
			userEnabled ? getAccessKey(project) : skip,
			linksEnabled ? getLinks(project, "", true, filters) : skip,
			linksEnabled ? getLinkCampaigns(project) : skip,
			linksEnabled ? getDomains(project) : skip,
			linksEnabled ? getRedirectRules(project) : skip,
			linksEnabled
				? getLinkStatistics(project, {
						...filters,
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
						interval: "day",
					})
				: skip,
			productsEnabled ? getProducts(project) : skip,
			productsEnabled ? getProductStatistics(project, filters) : skip,
		] as const);
		if (currentGeneration !== generation.current) return;
		setFailures(
			results.flatMap((result, source) =>
				result.status === "rejected"
					? [{ source, message: moduleErrorMessage(result.reason) }]
					: [],
			),
		);
		setSnapshot({
			analytics: value(results[0]),
			app: value(results[1]),
			accessKey: value(results[2]),
			links: value(results[3]),
			campaigns: value(results[4])?.length,
			domains: value(results[5]),
			rules: value(results[6]),
			linkStatistics: value(results[7]),
			products: value(results[8])?.length,
			productStatistics: value(results[9]),
		});
		setLoading(false);
	}, [
		dateRange?.from,
		dateRange?.to,
		platform,
		selectedProject,
		userEnabled,
		linksEnabled,
		productsEnabled,
	]);

	useEffect(() => {
		void load();
		return () => {
			generation.current += 1;
		};
	}, [load]);

	const cards = useMemo<DashBoardCardType[]>(() => {
		const linkTotals = snapshot.linkStatistics?.totals;
		const productTotals = snapshot.productStatistics?.totals;
		const card = (
			title: string,
			metric: number | undefined,
			tooltip: string,
			valueType?: string,
		): DashBoardCardType => ({
			title: t(title),
			value: metric ?? "—",
			valueType,
			secondaryValue: "0",
			tooltip: t(tooltip),
		});
		const analytics = snapshot.analytics;
		return [
			card("Events", analytics?.events, "Accepted events in the selected period."),
			card(
				"Unique people",
				analytics?.unique_subjects,
				"Distinct people seen in the selected period.",
			),
			card(
				"Installations",
				analytics?.installations,
				"Application installations recorded by Analytics.",
			),
			card(
				"Verified purchases",
				analytics?.successful_purchases,
				"Successful purchases verified by the server.",
			),
			...(linksEnabled
				? [
						card(
							"Link views",
							linkTotals?.views,
							"Browser views, clicks and redirects in the selected period.",
						),
					]
				: []),
			...(productsEnabled
				? [
						card(
							"Net revenue",
							typeof productTotals?.net_revenue_micros === "number"
								? productTotals.net_revenue_micros / 10_000
								: undefined,
							"Gross purchase revenue after recorded refunds.",
							"money",
						),
					]
				: []),
		];
	}, [snapshot, linksEnabled, productsEnabled, t]);

	const series = useMemo(
		() => (snapshot.linkStatistics ? viewsSeries(snapshot.linkStatistics) : []),
		[snapshot.linkStatistics],
	);
	const topLinks = useMemo(
		() =>
			[...(snapshot.links ?? [])]
				.sort((left, right) => (right.total_views ?? 0) - (left.total_views ?? 0))
				.slice(0, 8),
		[snapshot.links],
	);

	return (
		<ModulePage
			title={t("Overview")}
			description={t("Quick start, key metrics and link performance for the selected project.")}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex flex-wrap gap-2">
							<DateRangePicker date={dateRange} setDate={setDateRange} />
							<AdsPlatformSelect
								platformAdsOptions={platformsFilterList}
								selectedAdsPlatform={platform}
								setSelectedAdsPlatforms={setPlatform}
								title={t("Platforms")}
								selectListTitle={t("Platforms")}
							/>
						</div>
						<Button variant="outline" disabled={loading} onClick={() => void load()}>
							<RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
							{loading ? t("Refreshing…") : t("Refresh")}
						</Button>
					</div>

					{failures.length ? (
						<Alert>
							<TrendingUp className="size-4" />
							<AlertTitle>{t("Some module data is temporarily unavailable")}</AlertTitle>
							<AlertDescription>
								{t("Available modules are still shown.")}{" "}
								{failures
									.map(({ source, message }) => `${t(sourceNames[source] ?? "")}: ${message}`)
									.join(" · ")}
							</AlertDescription>
						</Alert>
					) : null}

					<QuickStart snapshot={snapshot} integrations={integrations} t={t} />
					<SectionCards cards={cards} />

					{linksEnabled ? (
						<div className="grid gap-6 2xl:grid-cols-[1fr_1.2fr]">
							<ViewsChart series={series} loading={loading} t={t} locale={locale} />
							<TopLinks links={topLinks} loading={loading} t={t} locale={locale} />
						</div>
					) : null}
				</div>
			)}
		</ModulePage>
	);
}

function value<T>(result: PromiseSettledResult<T>): T | undefined {
	return result.status === "fulfilled" ? result.value : undefined;
}

function QuickStart({
	snapshot,
	integrations,
	t,
}: {
	snapshot: Snapshot;
	integrations: Integrations;
	t: Translate;
}) {
	const items = [
		{
			label: "Create an API key",
			visible: integrations.user && snapshot.accessKey !== undefined,
			description: "Authenticate the SDK in the selected project.",
			href: hrefs.apiKeys,
			done: Boolean(snapshot.accessKey),
			icon: KeyRound,
		},
		{
			label: "Install an SDK",
			visible: integrations.settings && integrations.user && snapshot.app !== undefined,
			description: "Complete the iOS, Android or Web integration guide.",
			href: hrefs.libraries,
			done: (snapshot.app?.configured_platforms ?? 0) > 0,
			icon: Smartphone,
		},
		{
			label: "Configure link routing",
			visible: integrations.links && snapshot.rules !== undefined && snapshot.domains !== undefined,
			description: "Add redirect rules or verify a branded domain.",
			href: hrefs.linkRouting,
			done:
				snapshot.rules?.some((rule) => rule.active) ||
				snapshot.domains?.some((domain) => domain.status === "verified"),
			icon: Route,
		},
		{
			label: "Publish the first link",
			visible:
				integrations.links && snapshot.links !== undefined && snapshot.campaigns !== undefined,
			description: "Create a link and optionally group it into a campaign.",
			href: hrefs.links,
			done: (snapshot.links?.length ?? 0) > 0 || (snapshot.campaigns ?? 0) > 0,
			icon: Link2,
		},
		{
			label: "Build the product catalog",
			visible: integrations.products && snapshot.products !== undefined,
			description: "Register products before resolving offerings.",
			href: hrefs.products,
			done: (snapshot.products ?? 0) > 0,
			icon: PackageCheck,
		},
	].filter((item) => item.visible);
	if (!items.length) return null;
	const complete = items.filter((item) => item.done).length;
	return (
		<Card className="overflow-hidden border-sidebar-border bg-gradient-to-br from-blue-50/70 via-background to-orange-50/50 dark:from-blue-950/20 dark:to-orange-950/10">
			<CardHeader className="flex-row items-start gap-3">
				<div className="rounded-xl bg-foreground p-3 text-background">
					<Rocket className="size-5" />
				</div>
				<div className="flex-1">
					<CardTitle>{t("Quick start")}</CardTitle>
					<CardDescription>
						{t("Quick start progress", { complete, total: items.length })}
					</CardDescription>
				</div>
				<Badge variant={complete === items.length ? "default" : "secondary"}>
					{Math.round((complete / items.length) * 100)}%
				</Badge>
			</CardHeader>
			<CardContent>
				<div className="grid gap-3 lg:grid-cols-5">
					{items.map(({ label, description, href, done, icon: Icon }) => (
						<Link
							key={label}
							href={href}
							className="group flex min-h-36 flex-col rounded-xl border bg-background/80 p-4 transition-colors hover:border-foreground/30"
						>
							<div className="mb-4 flex items-center justify-between">
								<Icon className="size-5 text-muted-foreground" />
								{done ? (
									<span className="rounded-full bg-foreground p-1 text-background">
										<Check className="size-3" />
									</span>
								) : (
									<Circle className="size-5 text-muted-foreground/40" />
								)}
							</div>
							<span className="font-medium">{t(label)}</span>
							<span className="mt-1 text-xs text-muted-foreground">{t(description)}</span>
							<ArrowRight className="mt-auto size-4 self-end text-muted-foreground transition-transform group-hover:translate-x-1" />
						</Link>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

function ViewsChart({
	series,
	loading,
	t,
	locale,
}: {
	series: DailyViews[];
	loading: boolean;
	t: Translate;
	locale: string;
}) {
	const maximum = Math.max(1, ...series.map((point) => point.value));
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("Link views")}</CardTitle>
				<CardDescription>{t("Daily browser activity for the selected period.")}</CardDescription>
			</CardHeader>
			<CardContent>
				{loading && !series.length ? (
					<div className="h-72 animate-pulse rounded-lg bg-muted" />
				) : series.length ? (
					<div className="flex h-72 items-end gap-1 overflow-x-auto rounded-lg border bg-muted/20 p-4">
						{series.map((point) => (
							<div
								key={point.date}
								className="group flex h-full min-w-5 flex-1 items-end"
								title={t("Daily link views", {
									date: point.date,
									count: point.value.toLocaleString(locale),
								})}
							>
								<div
									className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
									style={{ height: `${Math.max(2, (point.value / maximum) * 100)}%` }}
								/>
							</div>
						))}
					</div>
				) : (
					<div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed text-center">
						<Link2 className="mb-3 size-8 text-muted-foreground" />
						<p className="font-medium">{t("No link views yet")}</p>
						<p className="text-sm text-muted-foreground">
							{t("Create and share a dynamic link to populate this chart.")}
						</p>
						<Button asChild className="mt-4" size="sm">
							<Link href={hrefs.links}>{t("Create a link")}</Link>
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function TopLinks({
	links,
	loading,
	t,
	locale,
}: {
	links: DynamicLink[];
	loading: boolean;
	t: Translate;
	locale: string;
}) {
	const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between gap-3">
				<div>
					<CardTitle>{t("Top links")}</CardTitle>
					<CardDescription>
						{t("Ranked by attributed views in the selected period.")}
					</CardDescription>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link href={hrefs.linkAnalytics}>
						{t("See Dynamic links analytics")}
						<ArrowRight className="size-4" />
					</Link>
				</Button>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("Link")}</TableHead>
								<TableHead>{t("Link views column")}</TableHead>
								<TableHead>{t("Opens")}</TableHead>
								<TableHead>{t("Installs")}</TableHead>
								<TableHead>{t("Revenue")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{loading && !links.length ? (
								Array.from({ length: 4 }, (_, index) => (
									<TableRow key={index}>
										<TableCell colSpan={5}>
											<div className="h-5 animate-pulse rounded bg-muted" />
										</TableCell>
									</TableRow>
								))
							) : links.length ? (
								links.map((link) => (
									<TableRow key={link.id}>
										<TableCell>
											<Link
												className="font-medium hover:underline"
												href={`${hrefs.links}?q=${encodeURIComponent(link.slug)}`}
											>
												{link.name}
											</Link>
											<code className="ml-2 text-xs text-muted-foreground">/{link.slug}</code>
										</TableCell>
										<TableCell>{(link.total_views ?? 0).toLocaleString(locale)}</TableCell>
										<TableCell>{(link.total_opens ?? 0).toLocaleString(locale)}</TableCell>
										<TableCell>{(link.total_installs ?? 0).toLocaleString(locale)}</TableCell>
										<TableCell>{currency.format((link.total_revenue ?? 0) / 100)}</TableCell>
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
										{t("No links are available for this period.")}
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	);
}
