"use client";

import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import CustomizeColumns from "@/components/common/customize-columns";
import { Input } from "@/components/ui/input";
import { formatApiDate } from "@/lib/dateUtils";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useSetRevenueCollectionMutation } from "@/hooks/mutations/useInstanceMutations";
import { ApiError } from "@/lib/ApiError";
import { showErrorNotification } from "@/lib/Notifications";
import { useEffect, useMemo, useState } from "react";
import AdsPlatformSelect from "@/components/common/ads-platform";
import { platformsFilterList } from "@/constants/FilterOptions";
import AppHeader from "@/components/layout/app-header";
import { getRevenueTableColumns } from "@/components/revenue/RevenueTableColumns";
import { PaginationFooter } from "@/components/common/pagination-footer";
import { useRevenueMetricsQuery } from "@/hooks/queries/usePurchasesQueries";
import AudienceTable from "@/components/audience/AudienceTable";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";
import { useTableParams } from "@/hooks/useTableParams";
import type { RevenueMetrics } from "@/components/revenue/RevenueTableColumns";
import type { GetRevenueParams } from "@/types";
import { Button } from "@/components/ui/button";
import { DollarSign, BarChart3, Users, Repeat, Store } from "lucide-react";
import { useTheme } from "next-themes";
const RevenuePage = () => {
  const { resolvedTheme } = useTheme();
  const { selectedProject, selectedInstance } = useProjectSelection();
  const revenueCollectionMutation = useSetRevenueCollectionMutation();

  const {
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    sort,
    setSort,
    searchTerm,
    setSearchTerm,
    dateRange,
    setDateRange,
    platform,
    setPlatform,
  } = useTableParams({ defaultSortKey: "units_sold" });

  const [revenueEnabled, setRevenueEnabled] = useState<boolean | undefined>(
    undefined
  );

  const revenueQueryParams = useMemo(() => {
    if (!selectedProject || !selectedInstance?.revenue_collection_enabled)
      return null;
    if (!dateRange?.from || !dateRange?.to) return null;
    const params: GetRevenueParams = {
      ascending: sort.ascending,
      current_page: page,
      start_date: formatApiDate(dateRange.from),
      sort_by: sort.sortKey,
      per_page: rowsPerPage,
    };
    if (searchTerm !== "") params.term = searchTerm;
    if (dateRange.to) params.end_date = formatApiDate(dateRange.to);
    if (platform !== "") params.platform = platform;
    return params;
  }, [
    selectedProject,
    selectedInstance?.revenue_collection_enabled,
    dateRange,
    sort,
    page,
    rowsPerPage,
    searchTerm,
    platform,
  ]);

  const revenueQuery = useRevenueMetricsQuery(
    selectedProject?.id,
    revenueQueryParams
  );
  const revenueMetrics = revenueQuery.data?.data;
  const totalPages = revenueQuery.data?.totalPages ?? 0;
  const totalEntries = revenueQuery.data?.totalEntries ?? 0;
  const tableLoading = revenueQuery.isLoading;

  const tableData = useMemo(() => {
    if (!revenueMetrics) {
      return [];
    }

    const mapped = revenueMetrics?.map((item) => {
      let platformsArray: string | string[];
      try {
        platformsArray =
          typeof item.platforms === "string"
            ? JSON.parse(item.platforms)
            : item.platforms;
      } catch {
        platformsArray = item.platforms;
      }
      return {
        product: item.product_id,
        platforms: platformsArray,
        units_sold: item.units_sold,
        first_time_purchases: item.first_time_purchases,
        repeat_purchases: item.repeat_purchases,
        total_revenue: formatCurrencyFromCents(item.total_revenue_usd_cents),
        arpu: formatCurrencyFromCents(item.arpu_usd_cents),
        ltv: formatCurrencyFromCents(item.ltv_usd_cents),
        cancellations: item.cancellations,
      } satisfies RevenueMetrics;
    });
    return mapped;
  }, [revenueMetrics]);

  const columns = useMemo(
    () => getRevenueTableColumns(sort, setSort),
    [sort, setSort]
  );

  const columnOptions = [
    { label: "Product", value: "product" },
    { label: "Platform", value: "platform" },
    { label: "Units sold", value: "units_sold" },
    { label: "Cancellations", value: "cancellations" },
    { label: "First-Time purchase", value: "first_time_purchases" },
    { label: "Repeat purchase", value: "repeat_purchase" },
    { label: "Total revenue", value: "total_revenue" },
    // { label: "ARPU", value: "arpu" },
    // { label: "LTV", value: "ltv" },
  ];

  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "product",
    "platform",
    "units_sold",
    "first_time_purchases",
    "repeat_purchases",
    "total_revenue",
    "cancellations",
    // "arpu",
    // "ltv",
  ]);

  const handleEnableRevenueTracking = async () => {
    if (!selectedInstance) return;
    const dataObject = {
      revenue_collection_enabled: true,
    };
    try {
      await revenueCollectionMutation.mutateAsync({
        id: selectedInstance.id,
        data: dataObject,
      });
      setRevenueEnabled(true);
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  useEffect(() => {
    if (!selectedProject || !selectedInstance) {
      return;
    }
    setRevenueEnabled(selectedInstance.revenue_collection_enabled ?? false);
  }, [selectedProject, selectedInstance]);

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      {revenueEnabled === false && (
        <div className="flex flex-1 overflow-auto">
          <div className="flex flex-col w-full">
            {/* Hero banner */}
            <div
              className="px-8 pt-12 pb-10 flex flex-col items-center text-center"
              style={{
                background:
                  resolvedTheme === "dark"
                    ? "linear-gradient(180deg, rgba(60, 90, 140, 0.15) 0%, rgba(140, 100, 70, 0.10) 100%)"
                    : "linear-gradient(180deg, rgba(190, 218, 252, 0.25) 0%, rgba(255, 233, 216, 0.25) 100%)",
              }}
            >
              <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-foreground mb-5">
                <DollarSign className="h-5 w-5 text-background" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight mb-2">
                Revenue Tracking
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-md mb-6">
                Understand your app&apos;s monetization with automatic purchase
                tracking, revenue attribution, and real-time analytics.
              </p>
              <Button
                size="lg"
                className="px-8"
                onClick={() => handleEnableRevenueTracking()}
              >
                Enable Revenue Tracking
              </Button>
              <p className="text-[11px] text-muted-foreground/50 mt-2.5">
                You can disable this anytime in project settings
              </p>
            </div>

            {/* Features */}
            <div className="max-w-3xl w-full mx-auto px-8 py-10">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                What you get
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {[
                  {
                    icon: BarChart3,
                    title: "Total Revenue",
                    description:
                      "Track earnings across all your apps in real time with automatic currency conversion.",
                  },
                  {
                    icon: Users,
                    title: "Revenue per User",
                    description:
                      "Measure average revenue per paying user to understand monetization efficiency.",
                  },
                  {
                    icon: Repeat,
                    title: "Purchase Patterns",
                    description:
                      "Distinguish first-time buyers from repeat customers and track retention-driven revenue.",
                  },
                  {
                    icon: Store,
                    title: "Store Breakdowns",
                    description:
                      "Compare revenue across App Store, Google Play, and custom payment sources.",
                  },
                ].map((feature) => (
                  <div
                    key={feature.title}
                    className="flex items-start gap-3.5 rounded-xl border border-sidebar-border bg-[#FAFAFA] dark:bg-card p-4"
                  >
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-muted shrink-0 mt-0.5">
                      <feature.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {feature.title}
                      </span>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed mt-6 text-center">
                We automatically collect in-app purchases, custom payments, and
                revenue events sent through our SDKs or APIs.
              </p>
            </div>
          </div>
        </div>
      )}

      {revenueEnabled === true && (
        <>
          <AppHeader />
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="@container/main flex flex-1 flex-col gap-2 overflow-hidden">
              <div className="flex flex-col gap-2 px-6 md:gap-6 md:py-3 h-full overflow-hidden">
                <div className="flex flex-wrap justify-between gap-2 relative">
                  <div className="flex flex-wrap gap-2 min-w-[200px] flex-1">
                    <Input
                      className="w-full min-w-[150px] max-w-[250px]"
                      placeholder="Search product"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.currentTarget.value)}
                    />
                    <AdsPlatformSelect
                      platformAdsOptions={platformsFilterList}
                      selectedAdsPlatform={platform}
                      setSelectedAdsPlatforms={setPlatform}
                      selectListTitle="Platforms"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 min-w-[200px] justify-end">
                    <CustomizeColumns
                      columnOptions={columnOptions}
                      selectedColumns={selectedColumns}
                      setSelectedColumns={setSelectedColumns}
                    />
                    <DateRangePicker date={dateRange} setDate={setDateRange} />
                  </div>
                </div>

                <div className="overflow-auto">
                  <AudienceTable
                    selectedColumns={selectedColumns}
                    data={tableData}
                    columns={columns}
                    loading={tableLoading}
                    hasFilters={searchTerm !== "" || platform !== ""}
                    emptyStateType="revenue"
                  />
                </div>
                {totalPages > 0 && (
                  <div className="flex w-full mt-auto">
                    <PaginationFooter
                      rowsPerPage={rowsPerPage}
                      setRowsPerPage={setRowsPerPage}
                      page={page}
                      setPage={setPage}
                      totalRows={totalEntries}
                      pageCount={totalPages}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default RevenuePage;

export type RevenueDataType = RevenueMetrics;
