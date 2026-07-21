"use client";

import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import LinksTable from "@/components/dynamic_links/links/LinksTable";
import { getLinksTableColumns } from "@/components/dynamic_links/links/LinksTableColumns";
import { Button } from "@/components/ui/button";
import CustomizeColumns from "@/components/common/customize-columns";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  formatApiDate,
  formatApiStartOfDay,
  formatApiEndOfDay,
} from "@/lib/dateUtils";
import { ACTIVE, ARCHIVED } from "@/constants/OptionsConstants";
import { useProjectSelection } from "@/context/useProjectSelection";
import { IS_ENTERPRISE } from "@/lib/edition";
import {
  showErrorNotification,
  showExportNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import { ChevronDown, Download, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { downloadLinksAsCSV } from "@/hooks/queries/useEventQueries";
import { useLinksListQuery } from "@/hooks/queries/useLinksQueries";
import { useArchiveCampaignMutation } from "@/hooks/mutations/useCampaignsMutations";
import AdsPlatformSelect from "@/components/common/ads-platform";
import { adsFilterList, platformsFilterList } from "@/constants/FilterOptions";
import AppHeader from "@/components/layout/app-header";
import { useGlobalLinkDialog } from "@/context/useLinkDialogContext";
import { PaginationFooter } from "@/components/common/pagination-footer";
import type { Link, GetLinksParams } from "@/types";
import { useRouter } from "next/navigation";
import ActionConfirm from "@/components/common/action-confirm";
import { useTableParams } from "@/hooks/useTableParams";
import { useUrlState } from "@/hooks/useUrlState";

const LinksPage = ({ campaignId }: { campaignId?: string }) => {
  const { selectedInstance, selectedProject } = useProjectSelection();
  const archiveCampaignMutation = useArchiveCampaignMutation(
    selectedProject?.id
  );

  const { openLinkDialog, openEditLinkDialog } = useGlobalLinkDialog();
  const router = useRouter();

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
  const [adsFilter, setAdsFilter] = useUrlState("adsFilter", "");
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  const linksQueryParams = useMemo(() => {
    if (!selectedProject || !dateRange?.from) return null;
    const params: GetLinksParams = {
      active: linksType === ACTIVE,
      sdk: false,
      ascending: sort.ascending,
      page,
      start_date: formatApiStartOfDay(dateRange.from),
      sort_by: sort.sortKey,
      per_page: rowsPerPage,
    };
    if (campaignId) params.campaign_id = campaignId;
    if (adsFilter !== "") params.ads_platform = adsFilter;
    if (platform !== "") params.platform = platform;
    if (searchTerm !== "") params.term = searchTerm;
    if (dateRange.to) params.end_date = formatApiEndOfDay(dateRange.to);
    return params;
  }, [
    selectedProject,
    dateRange,
    linksType,
    sort,
    page,
    rowsPerPage,
    campaignId,
    adsFilter,
    platform,
    searchTerm,
  ]);

  const linksQuery = useLinksListQuery(selectedProject?.id, linksQueryParams);
  const links = linksQuery.data?.data;
  const totalPages = linksQuery.data?.totalPages ?? 0;
  const totalRows = linksQuery.data?.totalEntries ?? 0;
  const tableLoading = linksQuery.isLoading;

  const columnOptions = [
    { label: "Views", value: "views" },
    { label: "Installs", value: "installs" },
    { label: "Tags", value: "tags" },
    { label: "Opens", value: "opens" },
    { label: "Reinstalls", value: "reinstalls" },
    { label: "Reactivations", value: "reactivations" },
    { label: "Time spent", value: "time_spent" },
    ...(IS_ENTERPRISE && selectedInstance?.revenue_collection_enabled
      ? [{ label: "Revenue", value: "revenue" }]
      : []),
    { label: "Date", value: "date" },
  ];

  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "ads_platform",
    "title",
    "tags",
    "views",
    "opens",
    "installs",
    "reinstalls",
    "reactivations",
    "time_spent",
    "date",
  ]);

  const refreshLinks = useCallback(() => {
    linksQuery.refetch();
  }, [linksQuery]);

  const handleDownloadCSV = async () => {
    const dataObject: {
      active: boolean;
      sdk: boolean;
      start_date: string;
      end_date?: string;
    } = {
      active: linksType === ACTIVE,
      sdk: false,
      start_date: formatApiDate(dateRange!.from!),
    };

    if (dateRange?.to) {
      dataObject.end_date = formatApiDate(dateRange.to!);
    }

    if (!selectedProject) return;
    try {
      await downloadLinksAsCSV(selectedProject.id, dataObject);
      showExportNotification();
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  const handleEditLink = useCallback(
    (link: Link) => {
      openEditLinkDialog(link, {
        onSuccess: () => {
          refreshLinks();
        },
      });
    },
    [openEditLinkDialog, refreshLinks]
  );

  const columns = useMemo(
    () => getLinksTableColumns(sort, setSort, handleEditLink),
    [sort, setSort, handleEditLink]
  );

  const handleArchiveCampaign = async () => {
    try {
      await archiveCampaignMutation.mutateAsync(campaignId!);
      showSuccessNotification("Campaign archived");
      const currentParams = new URLSearchParams(window.location.search);
      router.replace(`/dynamic_links/campaigns?${currentParams.toString()}`);
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
      "ads_platform",
      "title",
      "tags",
      "views",
      "opens",
      "installs",
      "reinstalls",
      "reactivations",
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
        <div className="@container/main flex flex-1 flex-col gap-2  overflow-hidden">
          <div className="flex flex-col gap-2 px-6 md:gap-6 md:py-3 overflow-hidden h-full">
            <div className="flex flex-wrap justify-between gap-2 relative shrink-0">
              <div className="flex flex-wrap gap-2 min-w-[200px] flex-1">
                <Input
                  className="w-full min-w-[150px] max-w-[250px]"
                  placeholder="Search link"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.currentTarget.value)}
                />

                {!campaignId && (
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
                )}

                <DateRangePicker date={dateRange} setDate={setDateRange} />

                <AdsPlatformSelect
                  platformAdsOptions={adsFilterList}
                  selectedAdsPlatform={adsFilter}
                  setSelectedAdsPlatforms={setAdsFilter}
                  title="Type"
                  selectListTitle="Link type"
                />

                <AdsPlatformSelect
                  platformAdsOptions={platformsFilterList}
                  selectedAdsPlatform={platform}
                  setSelectedAdsPlatforms={setPlatform}
                  selectListTitle="Platforms"
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-end items-center">
                {campaignId && (
                  <Button
                    variant="outline"
                    className="shadow-none text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setArchiveConfirmOpen(true)}
                  >
                    <Trash2 className="size-3.5" />
                    Archive
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="shadow-none"
                  onClick={() => handleDownloadCSV()}
                >
                  <Download className="size-4" />
                  Export
                </Button>
                <CustomizeColumns
                  columnOptions={columnOptions}
                  selectedColumns={selectedColumns}
                  setSelectedColumns={setSelectedColumns}
                />
                <Button
                  className="pl-3 pr-4"
                  size="sm"
                  onClick={() =>
                    openLinkDialog({
                      campaignID: campaignId,
                      onSuccess: () => {
                        refreshLinks();
                      },
                    })
                  }
                >
                  <Plus className="size-3.5" />
                  Create Link
                </Button>
              </div>
            </div>

            <div className="flex flex-col flex-1 overflow-hidden min-h-0">
              <LinksTable
                selectedColumns={selectedColumns}
                data={links}
                columns={columns}
                handleEditLink={handleEditLink}
                loading={tableLoading}
                isCampaign={!!campaignId}
                isArchived={linksType === ARCHIVED}
                hasFilters={
                  searchTerm !== "" || adsFilter !== "" || platform !== ""
                }
                onCreateLink={() =>
                  openLinkDialog({
                    campaignID: campaignId,
                    onSuccess: () => {
                      refreshLinks();
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

      <ActionConfirm
        open={archiveConfirmOpen}
        setOpen={setArchiveConfirmOpen}
        onConfirm={handleArchiveCampaign}
        title="Archive this campaign?"
        description="This campaign will be moved to the archive. Its links will remain active but will no longer be grouped under this campaign."
        confirmText="Archive"
        cancelText="Cancel"
      />
    </div>
  );
};

export default LinksPage;

export type LinkData = Link;
