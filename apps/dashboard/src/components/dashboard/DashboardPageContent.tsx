"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import {
  getAccessKey,
  getAppOverview,
  type AccessKeyInfo,
  type AppOverview,
} from "@/api/app/appService";
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
} from "@/api/dynamic-links/dynamicLinksService";
import {
  getProducts,
  getProductStatistics,
  type ProductStatistics,
} from "@/api/products/productsService";
import AdsPlatformSelect from "@/components/common/ads-platform";
import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import { SectionCards, type DashBoardCardType } from "@/components/layout/section-cards";
import {
  EmptyProject,
  ModulePage,
  moduleErrorMessage,
} from "@/components/modules/ModulePage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { platformsFilterList } from "@/constants/FilterOptions";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useTableParams } from "@/hooks/useTableParams";

type Snapshot = {
  app?: AppOverview;
  accessKey?: AccessKeyInfo | null;
  links: DynamicLink[];
  campaigns: number;
  domains: LinkDomain[];
  rules: RedirectRule[];
  linkStatistics: LinkStatistics;
  products: number;
  productStatistics?: ProductStatistics;
};

const emptySnapshot: Snapshot = {
  links: [],
  campaigns: 0,
  domains: [],
  rules: [],
  linkStatistics: { totals: {}, series: [] },
  products: 0,
};

type DailyViews = { date: string; value: number };

function viewsSeries(statistics: LinkStatistics): DailyViews[] {
  const values = new Map<string, number>();
  for (const point of statistics.series) {
    const type = typeof point.event_type === "string" ? point.event_type : "";
    if (!["view", "click", "redirect"].includes(type)) continue;
    const date = typeof point.date === "string" ? point.date : "Unknown";
    const count =
      typeof point.count === "number" ? point.count : Number(point.count) || 0;
    values.set(date, (values.get(date) ?? 0) + count);
  }
  return [...values.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export default function DashboardPageContent() {
  const { selectedProject } = useProjectSelection();
  const { dateRange, setDateRange, platform, setPlatform } = useTableParams();
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [failures, setFailures] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    const filters = {
      from: dateRange?.from?.toISOString().slice(0, 10),
      to: dateRange?.to?.toISOString().slice(0, 10),
      platform: platform || undefined,
    };
    const results = await Promise.allSettled([
      getAppOverview(selectedProject.id),
      getAccessKey(selectedProject.id),
      getLinks(selectedProject.id, "", true, filters),
      getLinkCampaigns(selectedProject.id),
      getDomains(selectedProject.id),
      getRedirectRules(selectedProject.id),
      getLinkStatistics(selectedProject.id, {
        ...filters,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        interval: "day",
      }),
      getProducts(selectedProject.id),
      getProductStatistics(selectedProject.id, filters),
    ] as const);
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
    setSnapshot((previous) => ({
      app: value(results[0], previous.app),
      accessKey: value(results[1], previous.accessKey),
      links: value(results[2], previous.links),
      campaigns: value(results[3], []).length,
      domains: value(results[4], previous.domains),
      rules: value(results[5], previous.rules),
      linkStatistics: value(results[6], previous.linkStatistics),
      products: value(results[7], []).length,
      productStatistics: value(results[8], previous.productStatistics),
    }));
    setLoading(false);
  }, [dateRange?.from, dateRange?.to, platform, selectedProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = useMemo<DashBoardCardType[]>(() => {
    const linkTotals = snapshot.linkStatistics.totals;
    const productTotals = snapshot.productStatistics?.totals;
    return [
      card("Customers", snapshot.app?.customers ?? 0, "Acquisition identities recorded by App."),
      card("Link views", linkTotals.views ?? 0, "Browser views, clicks and redirects in the selected period."),
      card("App installs", linkTotals.installs ?? 0, "Installs attributed to dynamic links."),
      card("App opens", linkTotals.app_opens ?? 0, "Application opens attributed to dynamic links."),
      card("Referred users", linkTotals.user_referred ?? 0, "Customers referred through tracked links."),
      card("Purchases", productTotals?.purchases ?? 0, "Completed and recorded product purchases."),
      card(
        "Net revenue",
        (productTotals?.net_revenue_micros ?? 0) / 10_000,
        "Gross purchase revenue after recorded refunds.",
        "money",
      ),
      card(
        "Active subscriptions",
        productTotals?.active_subscriptions ?? 0,
        "Subscriptions currently active in Products.",
      ),
    ];
  }, [snapshot]);

  const series = useMemo(
    () => viewsSeries(snapshot.linkStatistics),
    [snapshot.linkStatistics],
  );
  const topLinks = useMemo(
    () => [...snapshot.links].sort((left, right) => (right.total_views ?? 0) - (left.total_views ?? 0)).slice(0, 8),
    [snapshot.links],
  );

  return (
    <ModulePage
      title="Dashboard"
      description="A cross-module view of acquisition, engagement and product performance."
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

          <QuickStart snapshot={snapshot} />
          <SectionCards cards={cards} />

          <div className="grid gap-6 2xl:grid-cols-[1fr_1.2fr]">
            <ViewsChart series={series} loading={loading} />
            <TopLinks links={topLinks} loading={loading} />
          </div>
        </div>
      )}
    </ModulePage>
  );
}

function value<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function card(
  title: string,
  metric: number | string,
  tooltip: string,
  valueType?: string,
): DashBoardCardType {
  return { title, value: metric, valueType, secondaryValue: "0", tooltip };
}

function QuickStart({ snapshot }: { snapshot: Snapshot }) {
  const items = [
    {
      label: "Create an Access Key",
      description: "Authenticate the SDK in the selected project.",
      href: "/app/access-key",
      done: Boolean(snapshot.accessKey),
      icon: KeyRound,
    },
    {
      label: "Configure an SDK",
      description: "Complete the iOS, Android or Web integration guide.",
      href: "/app/ios-setup",
      done: (snapshot.app?.configured_platforms ?? 0) > 0,
      icon: Smartphone,
    },
    {
      label: "Configure link routing",
      description: "Add redirect rules or verify a branded domain.",
      href: "/dynamic-links/redirect-rules",
      done:
        snapshot.rules.some((rule) => rule.active) ||
        snapshot.domains.some((domain) => domain.status === "verified"),
      icon: Route,
    },
    {
      label: "Publish the first link",
      description: "Create a link and optionally group it into a campaign.",
      href: "/dynamic-links/links",
      done: snapshot.links.length > 0 || snapshot.campaigns > 0,
      icon: Link2,
    },
    {
      label: "Build the product catalog",
      description: "Register products before resolving offerings.",
      href: "/products/offerings",
      done: snapshot.products > 0,
      icon: PackageCheck,
    },
  ];
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
              <span className="mt-1 text-xs text-muted-foreground">
                {description}
              </span>
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
              <div key={point.date} className="group flex h-full min-w-5 flex-1 items-end" title={`${point.date}: ${point.value.toLocaleString()} views`}>
                <div className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(2, (point.value / maximum) * 100)}%` }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed text-center">
            <Link2 className="mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">No link views yet</p>
            <p className="text-sm text-muted-foreground">Create and share a dynamic link to populate this chart.</p>
            <Button asChild className="mt-4" size="sm"><Link href="/dynamic-links/links">Create a link</Link></Button>
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
        <div><CardTitle>Top performing links</CardTitle><CardDescription>Ranked by attributed views in the selected period.</CardDescription></div>
        <Button asChild variant="outline" size="sm"><Link href="/dynamic-links/links">View all</Link></Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Link</TableHead><TableHead>Views</TableHead><TableHead>Opens</TableHead><TableHead>Installs</TableHead><TableHead>Revenue</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading && !links.length ? Array.from({length:4},(_,index)=><TableRow key={index}><TableCell colSpan={5}><div className="h-5 animate-pulse rounded bg-muted"/></TableCell></TableRow>) : links.length ? links.map((link)=><TableRow key={link.id}><TableCell><Link className="font-medium hover:underline" href={`/dynamic-links/links?q=${encodeURIComponent(link.slug)}`}>{link.name}</Link><code className="ml-2 text-xs text-muted-foreground">/{link.slug}</code></TableCell><TableCell>{(link.total_views??0).toLocaleString()}</TableCell><TableCell>{(link.total_opens??0).toLocaleString()}</TableCell><TableCell>{(link.total_installs??0).toLocaleString()}</TableCell><TableCell>{new Intl.NumberFormat(undefined,{style:"currency",currency:"USD"}).format((link.total_revenue??0)/100)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-40 text-center text-muted-foreground">No links are available for this period.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
