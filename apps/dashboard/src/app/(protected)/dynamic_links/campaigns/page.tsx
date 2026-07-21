"use client";

import { createCampaignsTableColumns } from "@/components/dynamic_links/campaigns/CampaignsTableColumns";
import CustomizeColumns from "@/components/common/customize-columns";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ACTIVE, ARCHIVED } from "@/constants/OptionsConstants";
import { IS_ENTERPRISE } from "@/lib/edition";
import { useCampaignsListQuery } from "@/hooks/queries/useCampaignsQueries";
import { useCreateCampaignMutation } from "@/hooks/mutations/useCampaignsMutations";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useEffect, useMemo, useState } from "react";

import { formatApiDate } from "@/lib/dateUtils";
import { ApiError } from "@/lib/ApiError";
import { showErrorNotification } from "@/lib/Notifications";
import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import AppHeader from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { ChevronDown, Plus } from "lucide-react";
import { useGlobalDialog } from "@/context/useCreateCampaignDialogContext";

import { useRouter } from "next/navigation";
import { PaginationFooter } from "@/components/common/pagination-footer";
import CampaignsTable from "@/components/dynamic_links/campaigns/CampaignsTable";
import AdsPlatformSelect from "@/components/common/ads-platform";
import { platformsFilterList } from "@/constants/FilterOptions";
import type { GetCampaignsParams } from "@/types";
import { useTableParams } from "@/hooks/useTableParams";
import { useUrlState } from "@/hooks/useUrlState";

const CampaignsPage = () => {
  const router = useRouter();

  const { openDialog } = useGlobalDialog();
  const { selectedProject, selectedInstance } = useProjectSelection();
  const createCampaignMutation = useCreateCampaignMutation(
    selectedProject?.id,
    selectedInstance?.id
  );

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
  } = useTableParams();

  const [linksType, setLinksType] = useUrlState("status", ACTIVE);

  const campaignsQueryParams = useMemo(() => {
    if (!selectedProject || !dateRange?.from) return null;
    const params: GetCampaignsParams = {
      archived: linksType === ARCHIVED,
      ascending: sort.ascending,
      page,
      start_date: formatApiDate(dateRange.from),
      sort_by: sort.sortKey,
      per_page: rowsPerPage,
    };
    if (searchTerm !== "") params.term = searchTerm;
    if (dateRange.to) params.end_date = formatApiDate(dateRange.to);
    return params;
  }, [
    selectedProject,
    dateRange,
    linksType,
    sort,
    page,
    rowsPerPage,
    searchTerm,
  ]);

  const campaignsQuery = useCampaignsListQuery(
    selectedProject?.id,
    campaignsQueryParams
  );
  const campaigns = campaignsQuery.data?.data;
  const totalPages = campaignsQuery.data?.totalPages ?? 0;
  const totalRows = campaignsQuery.data?.totalEntries ?? 0;
  const tableLoading = campaignsQuery.isLoading;

  const campaignsColumnOptions = [
    { label: "Views", value: "views" },
    { label: "Opens", value: "opens" },
    { label: "Installs", value: "installs" },
    { label: "Reinstalls", value: "reinstalls" },
    { label: "Reactivations", value: "reactivations" },
    { label: "App opens", value: "app_opens" },
    { label: "Users referred", value: "user_referred" },
    ...(IS_ENTERPRISE && selectedInstance?.revenue_collection_enabled
      ? [{ label: "Revenue", value: "revenue" }]
      : []),
    { label: "Date", value: "date" },
  ];

  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "title",
    "views",
    "opens",
    "installs",
    "reinstalls",
    "reactivations",
    "app_opens",
    "user_referred",
    "time_spent",
    "date",
  ]);

  const handleGoToCampaign = (campaignId: string) => {
    const currentParams = new URLSearchParams(window.location.search);
    router.push(
      `/dynamic_links/campaigns/${campaignId}` + `?${currentParams.toString()}`
    );
  };

  const tableColumns = createCampaignsTableColumns(
    sort,
    setSort,
    handleGoToCampaign
  );

  const handleCreateNewCampaign = async (campaignName: string) => {
    try {
      const response = await createCampaignMutation.mutateAsync({
        name: campaignName,
      });
      const newCampaign = response.data?.campaign;
      if (newCampaign?.id) {
        const currentParams = new URLSearchParams(window.location.search);
        router.push(
          `/dynamic_links/campaigns/${newCampaign.id}?${currentParams.toString()}`
        );
      } else {
        campaignsQuery.refetch();
      }
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  useEffect(() => {
    if (!selectedInstance) return;

    const baseColumns = [
      "title",
      "views",
      "opens",
      "installs",
      "reinstalls",
      "reactivations",
      "app_opens",
      "user_referred",
      "time_spent",
      "revenue",
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
          <div className="flex flex-col gap-2 px-6 md:gap-6 md:py-3 overflow-hidden h-full">
            <div className="flex flex-wrap justify-between gap-2 relative shrink-0">
              <div className="flex flex-wrap gap-2 min-w-[200px] flex-1">
                <Input
                  className="w-full min-w-[150px] max-w-[250px]"
                  placeholder="Search campaign"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.currentTarget.value)}
                />

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="cursor-pointer whitespace-nowrap"
                    >
                      {linksType === ACTIVE ? "Active" : "Archived"}
                      <ChevronDown className="ml-1 size-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[200px] p-2 space-y-2">
                    <div>
                      <label className="text-sm text-muted-foreground">
                        Status
                      </label>
                    </div>
                    {[
                      { label: "Active", value: ACTIVE },
                      { label: "Archived", value: ARCHIVED },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={linksType === option.value}
                          onCheckedChange={() => setLinksType(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </PopoverContent>
                </Popover>

                <DateRangePicker date={dateRange} setDate={setDateRange} />

                <AdsPlatformSelect
                  platformAdsOptions={platformsFilterList}
                  selectedAdsPlatform={platform}
                  setSelectedAdsPlatforms={setPlatform}
                  selectListTitle="Platforms"
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-end items-center">
                <CustomizeColumns
                  columnOptions={campaignsColumnOptions}
                  selectedColumns={selectedColumns}
                  setSelectedColumns={setSelectedColumns}
                />
                <Button
                  className="pl-3 pr-4"
                  size="sm"
                  onClick={() =>
                    openDialog({
                      onConfirm: (name: unknown) => {
                        handleCreateNewCampaign(name as string);
                      },
                    })
                  }
                >
                  <Plus className="size-3.5" />
                  Create Campaign
                </Button>
              </div>
            </div>

            <div className="flex flex-col flex-1 overflow-hidden min-h-0">
              <CampaignsTable
                columns={tableColumns}
                data={campaigns ?? []}
                selectedColumns={selectedColumns}
                handleGoToCampaign={handleGoToCampaign}
                loading={tableLoading}
                isArchived={linksType === ARCHIVED}
                hasFilters={searchTerm !== "" || platform !== ""}
                onCreateCampaign={() =>
                  openDialog({
                    onConfirm: (name: unknown) => {
                      handleCreateNewCampaign(name as string);
                    },
                  })
                }
              />

              {totalPages > 0 && (
                <div className="flex w-full shrink-0">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CampaignsPage;
