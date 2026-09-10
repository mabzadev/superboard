"use client";

import { usePluginEnabled } from "@superboard/front-ui/context";
import Link from "@superboard/front-ui/next-link";
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

import AdsPlatformSelect from "../../../../../../supbrd-front-ui/src/shared/components/common/ads-platform.js";
import { DateRangePicker } from "../../../../../../supbrd-front-ui/src/shared/components/dateRangePicker/DateRangePicker.js";
import {
	ModulePage,
	moduleErrorMessage,
} from "../../../../../../supbrd-front-ui/src/shared/components/modules/ModulePage.js";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "../../../../../../supbrd-front-ui/src/shared/components/ui/alert.js";
import { Badge } from "../../../../../../supbrd-front-ui/src/shared/components/ui/badge.js";
import { Button } from "../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../../../../supbrd-front-ui/src/shared/components/ui/card.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../../supbrd-front-ui/src/shared/components/ui/table.js";
import { platformsFilterList } from "../../../../../../supbrd-front-ui/src/shared/constants/FilterOptions.js";
import { useProjectSelection } from "../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
import { useTableParams } from "../../../../../../supbrd-front-ui/src/shared/hooks/useTableParams.js";
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
import { AnalyticsPage } from "../analytics/AnalyticsPages.js";
import { SectionCards, type DashBoardCardType } from "../layout/section-cards.js";

type Snapshot = {
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

const emptySnapshot: Snapshot = {};

type Integrations = { user: boolean; settings: boolean; links: boolean; products: boolean };

type DailyViews = { date: string; value: number };

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
	const { selectedProject } = useProjectSelection();
	const userEnabled = usePluginEnabled("supbrd-plug-user");
	const settingsEnabled = usePluginEnabled("supbrd-plug-settings");
	const linksEnabled = usePluginEnabled("supbrd-plugmod-dynamic-links");
	const productsEnabled = usePluginEnabled("supbrd-plug-products");
	const hasIntegrations = userEnabled || linksEnabled || productsEnabled;
	const generation = useRef(0);
	const { dateRange, setDateRange, platform, setPlatform } = useTableParams();
	const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
	const [failures, setFailures] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);

	const load = useCallback(async () => {
		const currentGeneration = ++generation.current;
		setSnapshot(emptySnapshot);
		setFailures([]);
		if (!selectedProject || !hasIntegrations) {
			setLoading(false);
			return;
		}
		setLoading(true);
		const filters = {
			from: dateRange?.from?.toISOString().slice(0, 10),
			to: dateRange?.to?.toISOString().slice(0, 10),
			platform: platform || undefined,
		};
		const results = await Promise.allSettled([
			userEnabled ? getAppOverview(selectedProject.id) : Promise.resolve(undefined),
			userEnabled ? getAccessKey(selectedProject.id) : Promise.resolve(undefined),
			linksEnabled ? getLinks(selectedProject.id, "", true, filters) : Promise.resolve(undefined),
			linksEnabled ? getLinkCampaigns(selectedProject.id) : Promise.resolve(undefined),
			linksEnabled ? getDomains(selectedProject.id) : Promise.resolve(undefined),
			linksEnabled ? getRedirectRules(selectedProject.id) : Promise.resolve(undefined),
			linksEnabled
				? getLinkStatistics(selectedProject.id, {
						...filters,
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
						interval: "day",
					})
				: Promise.resolve(undefined),
			productsEnabled ? getProducts(selectedProject.id) : Promise.resolve(undefined),
			productsEnabled
				? getProductStatistics(selectedProject.id, filters)
				: Promise.resolve(undefined),
		] as const);
		if (currentGeneration !== generation.current) return;
		const names = [
			"App overview",
			"Access Key",
			"links",
			"campaigns",
			"domains",
			"redirect rules",
			"link analytics",
			"product catalog",
			"purchase analytics",
		];
		setFailures(
			results.flatMap((result, index) =>
				result.status === "rejected"
					? [`${names[index]}: ${moduleErrorMessage(result.reason)}`]
					: [],
			),
		);
		setSnapshot({
			app: value(results[0]),
			accessKey: value(results[1]),
			links: value(results[2]),
			campaigns: value(results[3])?.length,
			domains: value(results[4]),
			rules: value(results[5]),
			linkStatistics: value(results[6]),
			products: value(results[7])?.length,
			productStatistics: value(results[8]),
		});
		setLoading(false);
	}, [
		dateRange?.from,
		dateRange?.to,
		platform,
		selectedProject,
		hasIntegrations,
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
		return [
			...(userEnabled
				? [card("Customers", snapshot.app?.customers, "Acquisition identities recorded by App.")]
				: []),
			...(linksEnabled
				? [
						card(
							"Link views",
							linkTotals?.views,
							"Browser views, clicks and redirects in the selected period.",
						),
						card("App installs", linkTotals?.installs, "Installs attributed to dynamic links."),
						card(
							"App opens",
							linkTotals?.app_opens,
							"Application opens attributed to dynamic links.",
						),
						card(
							"Referred users",
							linkTotals?.user_referred,
							"Customers referred through tracked links.",
						),
					]
				: []),
			...(productsEnabled
				? [
						card(
							"Purchases",
							productTotals?.purchases,
							"Completed and recorded product purchases.",
						),
						card(
							"Net revenue",
							typeof productTotals?.net_revenue_micros === "number"
								? productTotals.net_revenue_micros / 10_000
								: undefined,
							"Gross purchase revenue after recorded refunds.",
							"money",
						),
						card(
							"Active subscriptions",
							productTotals?.active_subscriptions,
							"Subscriptions currently active in Products.",
						),
					]
				: []),
		];
	}, [snapshot, userEnabled, linksEnabled, productsEnabled]);

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
		<>
			<AnalyticsPage kind="overview" />
			{selectedProject && hasIntegrations ? (
				<ModulePage
					title="Dashboard"
					description="A cross-module view of acquisition, engagement and product performance."
				>
					<div className="space-y-6">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="flex flex-wrap gap-2">
								<DateRangePicker date={dateRange} setDate={setDateRange} />
								<AdsPlatformSelect
									platformAdsOptions={platformsFilterList}
									selectedAdsPlatform={platform}
									setSelectedAdsPlatforms={setPlatform}
									title="Platforms"
									selectListTitle="Platforms"
								/>
							</div>
							<Button variant="outline" disabled={loading} onClick={() => void load()}>
								<RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
								{loading ? "Refreshing…" : "Refresh dashboard"}
							</Button>
						</div>

						{failures.length ? (
							<Alert>
								<TrendingUp className="size-4" />
								<AlertTitle>Some module data is temporarily unavailable</AlertTitle>
								<AlertDescription>
									Available modules are still shown. {failures.join(" · ")}
								</AlertDescription>
							</Alert>
						) : null}

						<QuickStart
							snapshot={snapshot}
							integrations={{
								user: userEnabled,
								settings: settingsEnabled,
								links: linksEnabled,
								products: productsEnabled,
							}}
						/>
						<SectionCards cards={cards} />

						{linksEnabled ? (
							<div className="grid gap-6 2xl:grid-cols-[1fr_1.2fr]">
								{loading || snapshot.linkStatistics ? (
									<ViewsChart series={series} loading={loading} />
								) : null}
								{loading || snapshot.links ? <TopLinks links={topLinks} loading={loading} /> : null}
							</div>
						) : null}
					</div>
				</ModulePage>
			) : null}
		</>
	);
}

function value<T>(result: PromiseSettledResult<T>): T | undefined {
	return result.status === "fulfilled" ? result.value : undefined;
}

function card(
	title: string,
	metric: number | string | undefined,
	tooltip: string,
	valueType?: string,
): DashBoardCardType {
	return { title, value: metric ?? "—", valueType, secondaryValue: "0", tooltip };
}

function QuickStart({
	snapshot,
	integrations,
}: {
	snapshot: Snapshot;
	integrations: Integrations;
}) {
	const items = [
		{
			label: "Create an Access Key",
			visible: integrations.user && snapshot.accessKey !== undefined,
			description: "Authenticate the SDK in the selected project.",
			href: "/app/access-key",
			done: Boolean(snapshot.accessKey),
			icon: KeyRound,
		},
		{
			label: "Configure an SDK",
			visible: integrations.settings && integrations.user && snapshot.app !== undefined,
			description: "Complete the iOS, Android or Web integration guide.",
			href: "/app/ios-setup",
			done: (snapshot.app?.configured_platforms ?? 0) > 0,
			icon: Smartphone,
		},
		{
			label: "Configure link routing",
			visible: integrations.links && snapshot.rules !== undefined && snapshot.domains !== undefined,
			description: "Add redirect rules or verify a branded domain.",
			href: "/dynamic-links/redirect-rules",
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
			href: "/dynamic-links/links",
			done: (snapshot.links?.length ?? 0) > 0 || (snapshot.campaigns ?? 0) > 0,
			icon: Link2,
		},
		{
			label: "Build the product catalog",
			visible: integrations.products && snapshot.products !== undefined,
			description: "Register products before resolving offerings.",
			href: "/products/offerings",
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
					<CardTitle>Quick start</CardTitle>
					<CardDescription>
						{complete} of {items.length} project foundations completed.
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
							<span className="font-medium">{label}</span>
							<span className="mt-1 text-xs text-muted-foreground">{description}</span>
							<ArrowRight className="mt-auto size-4 self-end text-muted-foreground transition-transform group-hover:translate-x-1" />
						</Link>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

function ViewsChart({ series, loading }: { series: DailyViews[]; loading: boolean }) {
	const maximum = Math.max(1, ...series.map((point) => point.value));
	return (
		<Card>
			<CardHeader>
				<CardTitle>Link views</CardTitle>
				<CardDescription>Daily browser activity for the selected period.</CardDescription>
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
								title={`${point.date}: ${point.value.toLocaleString()} views`}
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
						<p className="font-medium">No link views yet</p>
						<p className="text-sm text-muted-foreground">
							Create and share a dynamic link to populate this chart.
						</p>
						<Button asChild className="mt-4" size="sm">
							<Link href="/dynamic-links/links">Create a link</Link>
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function TopLinks({ links, loading }: { links: DynamicLink[]; loading: boolean }) {
	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between gap-3">
				<div>
					<CardTitle>Top performing links</CardTitle>
					<CardDescription>Ranked by attributed views in the selected period.</CardDescription>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link href="/dynamic-links/links">View all</Link>
				</Button>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Link</TableHead>
								<TableHead>Views</TableHead>
								<TableHead>Opens</TableHead>
								<TableHead>Installs</TableHead>
								<TableHead>Revenue</TableHead>
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
												href={`/dynamic-links/links?q=${encodeURIComponent(link.slug)}`}
											>
												{link.name}
											</Link>
											<code className="ml-2 text-xs text-muted-foreground">/{link.slug}</code>
										</TableCell>
										<TableCell>{(link.total_views ?? 0).toLocaleString()}</TableCell>
										<TableCell>{(link.total_opens ?? 0).toLocaleString()}</TableCell>
										<TableCell>{(link.total_installs ?? 0).toLocaleString()}</TableCell>
										<TableCell>
											{new Intl.NumberFormat(undefined, {
												style: "currency",
												currency: "USD",
											}).format((link.total_revenue ?? 0) / 100)}
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
										No links are available for this period.
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
