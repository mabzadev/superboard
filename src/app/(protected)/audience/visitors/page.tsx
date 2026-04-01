"use client";

import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import CustomizeColumns from "@/components/common/customize-columns";
import { Input } from "@/components/ui/input";
import { formatApiDate, formatShortDate } from "@/lib/dateUtils";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useEffect, useMemo, useState } from "react";
import AdsPlatformSelect from "@/components/common/ads-platform";
import { platformsFilterList } from "@/constants/FilterOptions";
import { useVisitorsQuery } from "@/hooks/queries/useVisitorsQueries";

import { getVisitorsTableColumns } from "@/components/audience/VisitorsTableColumns";
import AppHeader from "@/components/layout/app-header";
import { PaginationFooter } from "@/components/common/pagination-footer";
import AudienceTable from "@/components/audience/AudienceTable";
import AudienceItemDetailsDialog from "@/components/audience/AudienceItemDetailsDialog";
import type { VisitorMetrics } from "@/components/audience/VisitorsTableColumns";
import type { Visitor, GetVisitorsParams } from "@/types";
import { useTableParams } from "@/hooks/useTableParams";
import { IS_ENTERPRISE } from "@/lib/edition";

const VisitorsPage = () => {
  const defaultDateRange = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    return { from: todayStart, to: now };
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

  const { selectedProject, selectedInstance } = useProjectSelection();

  const [isDetailsDialogOpen, setIsDetailsDialogOpen] =
    useState<Visitor | null>(null);

  const visitorsQueryParams = useMemo(() => {
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

  const visitorsQuery = useVisitorsQuery(
    selectedProject?.id,
    visitorsQueryParams
  );
  const visitors = visitorsQuery.data?.visitors;
  const totalPages = visitorsQuery.data?.totalPages ?? 0;
  const totalRows = visitorsQuery.data?.totalEntries ?? 0;
  const tableLoading = visitorsQuery.isLoading;

  const tableData = useMemo(() => {
    if (!visitors) {
      return [];
    }

    const mapped = visitors?.map((item) => {
      return {
        id: item.id,
        uuid: item.uuid,
        updated_at: formatShortDate(item.updated_at),
        total_views: item.total_views,
        total_opens: item.total_app_opens,
        total_installs: item.total_installs,
        total_reinstalls: item.total_reinstalls,
        sdk_identifier: item.sdk_identifier,
        invited_by: item.inviter,
        total_user_referred: item.total_user_referred,
        platform: item.platform,
        total_reactivations: item.total_reactivations,
        total_time_spent: item.total_time_spent,
        total_revenue: item.total_revenue,
      };
    });
    return mapped;
  }, [visitors]);

  const columns = useMemo(
    () => getVisitorsTableColumns(sort, setSort),
    [sort, setSort]
  );

  const columnOptions = [
    { label: "ID", value: "uuid" },
    { label: "SDK Identifier", value: "sdk_identifier" },
    { label: "Platform", value: "platform" },
    { label: "Views", value: "views" },
    { label: "Opens", value: "opens" },
    { label: "Installs", value: "installs" },
    { label: "Reinstalls", value: "reinstalls" },
    { label: "Reactivations", value: "reactivations" },
    { label: "Invited Users", value: "invited_users" },
    { label: "Time spent", value: "time_spent" },
    ...(IS_ENTERPRISE && selectedInstance?.revenue_collection_enabled
      ? [{ label: "Revenue", value: "total_revenue" }]
      : []),
    { label: "Date", value: "date" },
  ];

  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "uuid",
    "sdk_identifier",
    "platform",
    "views",
    "opens",
    "installs",
    "reinstalls",
    "reactivations",
    "invited_users",
    "time_spent",
    ...(IS_ENTERPRISE && selectedInstance?.revenue_collection_enabled
      ? ["total_revenue"]
      : []),
    "date",
  ]);

  const handleDisplayItemDetails = (id: string) => {
    const foundItem = visitors?.find((item) => item.id === id);
    setIsDetailsDialogOpen(foundItem ?? null);
  };

  useEffect(() => {
    if (!selectedInstance) return;

    const baseColumns = [
      "uuid",
      "sdk_identifier",
      "platform",
      "views",
      "opens",
      "installs",
      "reinstalls",
      "reactivations",
      "invited_users",
      "time_spent",
      "total_revenue",
      "date",
    ];

    const fullColumns =
      IS_ENTERPRISE && selectedInstance.revenue_collection_enabled
        ? baseColumns
        : [...baseColumns.slice(0, -2), "date"];

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
                  placeholder="Search visitor"
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
              />
            </div>
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

export default VisitorsPage;

export type VisitorsDataType = VisitorMetrics;
