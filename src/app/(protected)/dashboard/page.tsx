"use client";

import dynamic from "next/dynamic";

const DashboardLinksView = dynamic(
  () => import("@/components/dashboard/DashboardActiveUsers"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px] w-full rounded-md" />,
  }
);
import QuickStartGuide from "@/components/dashboard/QuickStartGuide";
import TopPerformingLinks from "@/components/dashboard/TopPerformingLinks";
import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import AdsPlatformSelect from "@/components/common/ads-platform";
import AppHeader from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ColumnOptionType } from "@/components/common/customize-columns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
const SectionCards = dynamic(
  () =>
    import("@/components/layout/section-cards").then((mod) => ({
      default: mod.SectionCards,
    })),
  { ssr: false }
);
import { Skeleton } from "@/components/ui/skeleton";
import { platformsFilterList } from "@/constants/FilterOptions";
import {
  useTopLinksQuery,
  useLinksViewsQuery,
  useMetricsOverviewQuery,
} from "@/hooks/queries/useDashboardQueries";
import { useGlobalLinkDialog } from "@/context/useLinkDialogContext";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useInstanceDetailsQuery } from "@/hooks/queries/useInstanceQueries";
import LocalStorage from "@/lib/LocalStorage";
import SessionStorage from "@/lib/SessionStorage";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { formatApiStartOfDay, formatApiEndOfDay } from "@/lib/dateUtils";

import type { DashboardLink, DateRangeQuery } from "@/types";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import { IS_ENTERPRISE } from "@/lib/edition";

type MetricData = {
  current: Record<string, number>;
  previous: Record<string, number>;
};

type Card = {
  title: string;
  value: number | string;
  valueType?: string;
  secondaryValue: string;
  secondaryValueType?: "percent";
  tooltip?: string;
};

const metricMeta: Record<string, Partial<Card>> = {
  link_views: {
    title: "Link views",
    secondaryValueType: "percent",
    tooltip:
      "Counts how many times your Grovs links were opened in a browser, whether they were created in the dashboard, through the API, or via the SDK.",
  },
  installs: {
    title: "App installs",
    secondaryValueType: "percent",
    tooltip:
      "The total number of times your app was installed or reinstalled, covering both organic installs and those driven by Grovs links.",
  },
  app_opens: {
    title: "App opens",
    secondaryValueType: "percent",
    tooltip:
      "The total number of times your app was opened, including both organic opens and opens driven by Grovs links.",
  },
  new_users: {
    title: "New users",
    secondaryValueType: "percent",
    tooltip:
      "The total number of first-time users who installed your app, including both organic installs and installs driven by Grovs links.",
  },
  returning_users: {
    title: "Returning users",
    secondaryValueType: "percent",
    tooltip:
      "The share of daily active users (DAU) in the selected period who had already used the app before. This metric is DAU-weighted, so days with more activity contribute proportionally more to the result.",
  },
  referred_users: {
    title: "Referred users",
    secondaryValueType: "percent",
    tooltip:
      "The total number of users who were invited by an existing user through Grovs links (not dashboard- or API-generated links).",
  },
  organic_users: {
    title: "Organic installs",
    secondaryValueType: "percent",
    tooltip:
      "The total number of users who installed your app without using Grovs links.",
  },
  link_driven_installs: {
    title: "Link-driven installs",
    secondaryValueType: "percent",
    tooltip:
      "Installs attributed to Grovs links (App installs minus Organic installs).",
  },
  revenue: {
    title: "Revenue",
    valueType: "money",
    secondaryValueType: "percent",
    tooltip:
      "Total gross revenue generated within the selected period, including all purchases and renewals, before fees.",
  },
  arpu: {
    title: "Avg. Revenue/User",
    valueType: "money",
    secondaryValueType: "percent",
    tooltip:
      "Average revenue earned per active user, including both paying and non-paying users, during the selected time frame.",
  },
  arppu: {
    title: "Avg. Revenue/Paying User",
    valueType: "money",
    secondaryValueType: "percent",
    tooltip:
      "Average revenue from users who made at least one purchase during the selected period.",
  },
  units_sold: {
    title: "Units sold",
    secondaryValueType: "percent",
    tooltip:
      "Total number of successful purchase events (transactions) completed during the selected period, including first-time and repeat purchases.",
  },
  cancellations: {
    title: "Cancellations",
    secondaryValueType: "percent",
    tooltip:
      "Number of canceled purchases or subscriptions recorded during the period.",
  },
  first_time_purchases: {
    title: "First-Time Purchasers",
    secondaryValueType: "percent",
    tooltip:
      "Number of users who made their first purchase ever in the selected time frame.",
  },
};

function generateCardsFromMetrics(
  metrics: MetricData,
  filter: string[]
): Card[] {
  return filter
    .filter((key) => key in metricMeta)
    .map((key) => {
      const currentValue = (metrics.current || {})[key] ?? 0;
      const previousValue = (metrics.previous || {})[key] ?? 0;

      const meta = metricMeta[key] || { title: key };

      const isRate = key === "returning_users";

      let value: number | string = currentValue;

      if (isRate) {
        value = Math.round(currentValue * 100);
      }

      let secondaryValue = "0";
      if (previousValue !== 0) {
        const change =
          ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
        secondaryValue = Math.round(change).toString();
      }

      return {
        title: meta.title || key,
        value: value,
        valueType: isRate ? "percent" : meta.valueType,
        secondaryValue,
        secondaryValueType: meta.secondaryValueType,
        tooltip: meta.tooltip,
      };
    });
}

export default function DashboardPage() {
  const { openEditLinkDialog } = useGlobalLinkDialog();
  const {
    selectedProject,
    selectedInstance,
    setGetStartedSetup,
    getStartedSetup,
  } = useProjectSelection();
  const instanceDetailsQuery = useInstanceDetailsQuery(selectedInstance?.id);

  const now = new Date();
  const from = new Date().setDate(now.getDate() - 30);
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>({
    from: new Date(from),
    to: now,
  });
  const [platform, setPlatform] = useState<string>("");

  const [selectedCards, setSelectedCards] = useState<string[]>([
    "link_views",
    "link_driven_installs",
    "organic_users",
    "installs",
    "app_opens",
    "new_users",
    "returning_users",
    "referred_users",
    ...(IS_ENTERPRISE
      ? [
          "revenue",
          "arpu",
          "arppu",
          "units_sold",
          "cancellations",
          "first_time_purchases",
        ]
      : []),
  ]);

  const queryParams = useMemo(() => {
    if (!selectedProject || !dateRange?.from || !dateRange?.to) return null;
    const params: DateRangeQuery = {
      start_date: formatApiStartOfDay(dateRange.from),
      end_date: formatApiEndOfDay(dateRange.to),
    };
    if (platform !== "") {
      params.platform = platform;
    }
    return params;
  }, [selectedProject, dateRange, platform]);

  const topLinksQuery = useTopLinksQuery(selectedProject?.id, queryParams);
  const linksViewsQuery = useLinksViewsQuery(selectedProject?.id, queryParams);
  const metricsOverviewQuery = useMetricsOverviewQuery(
    selectedProject?.id,
    queryParams
  );

  const topLinks = topLinksQuery.data;
  const linksViews = linksViewsQuery.data;
  const metricsOverview = metricsOverviewQuery.data;
  const dashboardLoading = topLinksQuery.isLoading || linksViewsQuery.isLoading;
  const cardsLoading = metricsOverviewQuery.isLoading;

  const cardsOptions = [
    { label: "Link views", value: "link_views" },
    { label: "Link-driven installs", value: "link_driven_installs" },
    { label: "App installs", value: "installs" },
    { label: "App opens", value: "app_opens" },
    { label: "New users", value: "new_users" },
    { label: "Returning users", value: "returning_users" },
    { label: "Referred users", value: "referred_users" },
    { label: "Organic installs", value: "organic_users" },
    ...(IS_ENTERPRISE && selectedInstance?.revenue_collection_enabled
      ? [
          { label: "Revenue", value: "revenue" },
          { label: "Avg. Revenue/User", value: "arpu" },
          {
            label: "Avg. Revenue/Paying User",
            value: "arppu",
          },
          { label: "Units sold", value: "units_sold" },
          { label: "Cancellations", value: "cancellations" },
          { label: "First-Time Purchasers", value: "first_time_purchases" },
        ]
      : []),
  ];

  const allStepsDone = useMemo(() => {
    if (!getStartedSetup) {
      return false;
    }
    return (
      getStartedSetup.android_sdk &&
      getStartedSetup.ios_sdk &&
      getStartedSetup.has_created_campaigns &&
      getStartedSetup.has_created_links &&
      getStartedSetup.redirect_fallback
    );
  }, [getStartedSetup]);

  const handleReorder = useCallback(
    (newVisibleKeys: string[]) => {
      // Rebuild full selectedCards: reordered visible keys + any hidden keys appended
      const visibleSet = new Set(newVisibleKeys);
      const hiddenKeys = selectedCards.filter((k) => !visibleSet.has(k));
      const newCards = [...newVisibleKeys, ...hiddenKeys];
      setSelectedCards(newCards);
      LocalStorage.setDashboardCards(newCards);
    },
    [selectedCards]
  );

  const toggleValue = (value: string) => {
    const cards = selectedCards.includes(value)
      ? selectedCards.filter((v: string) => v !== value)
      : [...selectedCards, value];
    LocalStorage.setDashboardCards(cards);

    setSelectedCards((prev: string[]) =>
      prev.includes(value)
        ? prev.filter((v: string) => v !== value)
        : [...prev, value]
    );
  };

  const handleEditLink = (link: DashboardLink) => {
    openEditLinkDialog(link, {
      onSuccess: () => {
        topLinksQuery.refetch();
      },
    });
  };

  const handleSetPlatform = (platform: string) => {
    setPlatform(platform);
    LocalStorage.setPlatformFilter(platform);
  };

  const handleDateChange = (range: DateRange | undefined) => {
    setDateRange(range);
    if (range) {
      SessionStorage.setDateFilter(JSON.stringify(range));
    }
  };

  useEffect(() => {
    if (!selectedInstance) return; // wait until instance is available

    // Step 1: Define the base cards
    const baseColumns = [
      "link_views",
      "link_driven_installs", // 👈 early in funnel
      "organic_users",
      "installs",
      "app_opens",
      "new_users",
      "returning_users",
      "referred_users",
      ...(IS_ENTERPRISE
        ? [
            "revenue",
            "arpu",
            "arppu",
            "units_sold",
            "cancellations",
            "first_time_purchases",
          ]
        : []),
    ];

    // Step 2: Load saved cards from localStorage
    const revenueKeys = [
      "revenue",
      "arpu",
      "arppu",
      "units_sold",
      "cancellations",
      "first_time_purchases",
    ];
    const savedCards = LocalStorage.getDashboardCards();

    if (savedCards) {
      let cards = savedCards;

      if (IS_ENTERPRISE && selectedInstance.revenue_collection_enabled) {
        // Ensure revenue cards are present when revenue is enabled
        revenueKeys.forEach((key) => {
          if (!cards.includes(key)) {
            cards.push(key);
          }
        });
      } else {
        cards = cards.filter((item) => !revenueKeys.includes(item));
      }

      setSelectedCards(cards);
    } else {
      // Fallback (no saved cards) → use base cards, filtered if needed
      const defaultCards =
        IS_ENTERPRISE && selectedInstance.revenue_collection_enabled
          ? baseColumns
          : baseColumns.filter((item) => !revenueKeys.includes(item));

      setSelectedCards(defaultCards);
    }
  }, [selectedInstance]);

  useEffect(() => {
    // Mount-only: restore persisted filters from storage once on initial render.
    // `now` is a render-time constant and should not trigger re-runs.
    const savedPlatform = LocalStorage.getPlatformFilter();
    if (savedPlatform) {
      setPlatform(savedPlatform);
    }

    const savedDateRange = SessionStorage.getDateFilter();
    if (savedDateRange) {
      try {
        const parsedRange = JSON.parse(savedDateRange);
        setDateRange({
          from: parsedRange.from ? new Date(parsedRange.from) : new Date(),
          to: parsedRange.to ? new Date(parsedRange.to) : now,
        });
      } catch {
        // Invalid date filter — use default range
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Mount-only: reads persisted filters from storage once
  }, []);

  const { metricCards, visibleCardKeys } = useMemo(() => {
    if (!metricsOverview)
      return { metricCards: [] as Card[], visibleCardKeys: [] as string[] };
    const keys = selectedCards.filter((key) => key in metricMeta);
    const cards = generateCardsFromMetrics(metricsOverview!, selectedCards);
    return { metricCards: cards, visibleCardKeys: keys };
  }, [metricsOverview, selectedCards]);

  useEffect(() => {
    if (instanceDetailsQuery.data?.get_started_setup) {
      setGetStartedSetup(instanceDetailsQuery.data.get_started_setup);
    }
  }, [instanceDetailsQuery.data, setGetStartedSetup]);
  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      <div className="border-b border-sidebar-border">
        <AppHeader />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col overflow-hidden min-w-0 w-full">
          <div className="@container/main flex-1 overflow-auto">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:p-6 @sm:p-4">
              {!selectedInstance?.get_started_dismissed && !allStepsDone && (
                <QuickStartGuide />
              )}

              {!getStartedSetup ||
              selectedInstance?.get_started_dismissed ||
              getStartedSetup?.ios_sdk ||
              getStartedSetup?.android_sdk ||
              getStartedSetup?.has_created_links ? (
                <>
                  <div className="flex w-full justify-between flex-wrap gap-4">
                    <AdsPlatformSelect
                      platformAdsOptions={platformsFilterList}
                      selectedAdsPlatform={platform}
                      setSelectedAdsPlatforms={handleSetPlatform}
                      selectListTitle="Platforms"
                    />
                    <div className="flex items-center gap-4 flex-wrap">
                      <DateRangePicker
                        date={dateRange}
                        setDate={handleDateChange}
                      />
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            className="flex items-center shadow-none"
                          >
                            <div className="flex items-center gap-2">
                              <LayoutGrid />
                              <p>Customize cards</p>
                              <ChevronDown />
                            </div>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[200px] p-2 space-y-2">
                          {cardsOptions.map((option: ColumnOptionType) => (
                            <label
                              key={option.value}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                            >
                              <Checkbox
                                checked={selectedCards.includes(option.value)}
                                onCheckedChange={() =>
                                  toggleValue(option.value)
                                }
                                id={option.value}
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  {cardsLoading ? (
                    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
                      {Array.from({ length: selectedCards.length }).map(
                        (_, i) => (
                          <Skeleton
                            key={i}
                            className="h-[100px] w-full rounded-md"
                          />
                        )
                      )}
                    </div>
                  ) : (
                    <SectionCards
                      cards={metricCards}
                      cardKeys={visibleCardKeys}
                      onReorder={handleReorder}
                    />
                  )}
                  <DashboardLinksView
                    data={linksViews ?? null}
                    loading={dashboardLoading}
                    hasCreatedLinks={!!getStartedSetup?.has_created_links}
                  />
                  <TopPerformingLinks
                    data={topLinks ?? []}
                    handleEditLink={handleEditLink}
                    loading={dashboardLoading}
                    hasCreatedLinks={!!getStartedSetup?.has_created_links}
                  />
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
