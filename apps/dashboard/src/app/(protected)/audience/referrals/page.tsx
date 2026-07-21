"use client";

import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import CustomizeColumns from "@/components/common/customize-columns";
import { Input } from "@/components/ui/input";
import { formatApiDate, formatShortDate } from "@/lib/dateUtils";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useEffect, useMemo, useState } from "react";
import AdsPlatformSelect from "@/components/common/ads-platform";
import { platformsFilterList } from "@/constants/FilterOptions";
import { useAggregatedVisitorsQuery } from "@/hooks/queries/useVisitorsQueries";
import AppHeader from "@/components/layout/app-header";
import { getReferralsTableColumns } from "@/components/audience/ReferralsTableColumns";
import { PaginationFooter } from "@/components/common/pagination-footer";
import AudienceTable from "@/components/audience/AudienceTable";
import AudienceItemDetailsDialog from "@/components/audience/AudienceItemDetailsDialog";
import type { RefferalMetrics } from "@/components/audience/ReferralsTableColumns";
import type { AggregatedVisitor, GetVisitorsParams } from "@/types";
import { useTableParams } from "@/hooks/useTableParams";
import { IS_ENTERPRISE } from "@/lib/edition";

const ReferralsPage = () => {
  const { selectedProject, selectedInstance } = useProjectSelection();

  const defaultDateRange = useMemo(() => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return { from: yesterday, to: now };
  }, []);

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
  } = useTableParams({ defaultDateRange });

  const [isDetailsDialogOpen, setIsDetailsDialogOpen] =
    useState<AggregatedVisitor | null>(null);

  const referralsQueryParams = useMemo(() => {
    if (!selectedProject || !dateRange?.from) return null;
    const params: GetVisitorsParams = {
      ascending: sort.ascending,
      page,
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
    dateRange,
    sort,
    page,
    rowsPerPage,
    searchTerm,
    platform,
  ]);

  const referralsQuery = useAggregatedVisitorsQuery(
    selectedProject?.id,
    referralsQueryParams
  );
  const agregatedVisitors = referralsQuery.data?.visitors;
  const totalPages = referralsQuery.data?.totalPages ?? 0;
  const totalRows = referralsQuery.data?.totalEntries ?? 0;
  const tableLoading = referralsQuery.isLoading;

  const tableData = useMemo(() => {
    if (!agregatedVisitors) {
      return [];
    }

    const mapped = agregatedVisitors?.map((item) => {
      return {
        id: item.id,
        uuid: item.uuid,
        date: formatShortDate(item.updated_at),
        view_count: item.invited_views,
        open_count: item.invited_app_opens,
        install_count: item.invited_installs,
        reinstall_count: item.invited_reinstalls,
        reactivations: item.invited_reactivations,
        sdk_identifier: item.sdk_identifier,
        referred: item.inviter,
        user_referred_count: item.invited_user_referred,
        platform: item.platform,
        time_spent: item.invited_time_spent,
        invited_by: item.inviter,
        updated_at: item.updated_at,
      };
    });
    return mapped;
  }, [agregatedVisitors]);

  const columns = useMemo(
    () => getReferralsTableColumns(sort, setSort),
    [sort, setSort]
  );

  const columnOptions = [
    { label: "ID", value: "id" },
    { label: "SDK Identifier", value: "sdk_identifier" },
    { label: "Views", value: "views" },
    { label: "Opens", value: "opens" },
    { label: "Installs", value: "installs" },
    { label: "Reinstalls", value: "reinstalls" },
    { label: "Reactivations", value: "reactivations" },
    { label: "Invited users", value: "user_referred_count" },
    { label: "Time spent", value: "time_spent" },
    ...(IS_ENTERPRISE && selectedInstance?.revenue_collection_enabled
      ? [{ label: "Revenue", value: "revenue" }]
      : []),
    { label: "Last access", value: "last_access" },
  ];

  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "id",
    "sdk_identifier",
    "views",
    "opens",
    "installs",
    "reinstalls",
    "reactivations",
    "user_referred_count",
    "time_spent",
    ...(IS_ENTERPRISE && selectedInstance?.revenue_collection_enabled
      ? ["revenue"]
      : []),
    "last_access",
  ]);

  const handleDisplayItemDetails = (id: string) => {
    const foundItem = agregatedVisitors?.find((item) => item.id === id);
    setIsDetailsDialogOpen(foundItem ?? null);
  };

  useEffect(() => {
    if (!selectedInstance) return;

    const baseColumns = [
      "id",
      "sdk_identifier",
      "views",
      "opens",
      "installs",
      "reinstalls",
      "reactivations",
      "user_referred_count",
      "time_spent",
      "revenue",
      "last_access",
    ];

    const fullColumns =
      IS_ENTERPRISE && selectedInstance.revenue_collection_enabled
        ? baseColumns
        : [...baseColumns.slice(0, -2), "last_access"];

    setSelectedColumns(fullColumns);
  }, [selectedInstance]);

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      <AppHeader />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="@container/main flex flex-1 flex-col gap-2 overflow-hidden">
          <div className="flex flex-col gap-2 px-6 md:gap-6 md:py-3 h-full overflow-hidden">
            <div className="flex flex-wrap justify-between gap-2 relative">
              <div className="flex flex-wrap gap-2 min-w-[200px] flex-1">
                <Input
                  className="w-full min-w-[150px] max-w-[250px]"
                  placeholder="Search referral"
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
                handleSelectRow={handleDisplayItemDetails}
                loading={tableLoading}
                hasFilters={searchTerm !== "" || platform !== ""}
                emptyStateType="referrals"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              These metrics are the total results from your referrals —
              everything they&apos;ve generated through their invites.
            </p>
            {totalPages > 0 && (
              <div className="flex w-full mt-auto">
                <PaginationFooter
                  rowsPerPage={rowsPerPage}
                  setRowsPerPage={setRowsPerPage}
                  page={page}
                  setPage={setPage}
                  totalRows={totalRows}
                  pageCount={totalPages}
                />
              </div>
            )}
            <AudienceItemDetailsDialog
              open={isDetailsDialogOpen}
              onOpenChange={(open) => {
                if (!open) setIsDetailsDialogOpen(null);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReferralsPage;

export type VisitorsDataType = RefferalMetrics;
