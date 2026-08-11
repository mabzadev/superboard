"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { ACTIVE, ARCHIVED } from "@/constants/OptionsConstants";
import { platformsFilterList } from "@/constants/FilterOptions";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useTableParams } from "@/hooks/useTableParams";
import { useUrlState } from "@/hooks/useUrlState";
import { showErrorNotification } from "@/lib/Notifications";
import {
  createLinkCampaign,
  getLinkCampaignAnalytics,
  type CampaignAnalyticsRow,
} from "@/api/dynamic-links/dynamicLinksService";
import { ModulePage, EmptyProject, moduleErrorMessage } from "@/components/modules/ModulePage";
import AdsPlatformSelect from "@/components/common/ads-platform";
import CustomizeColumns from "@/components/common/customize-columns";
import { PaginationFooter } from "@/components/common/pagination-footer";
import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CampaignAnalyticsTable } from "./CampaignAnalyticsTable";
import { createCampaignAnalyticsColumns } from "./CampaignAnalyticsTableColumns";

const columnOptions = [
  { label: "Views", value: "views" },
  { label: "Opens", value: "opens" },
  { label: "Installs", value: "installs" },
  { label: "Reinstalls", value: "reinstalls" },
  { label: "Reactivations", value: "reactivations" },
  { label: "App opens", value: "app_opens" },
  { label: "Users referred", value: "user_referred" },
  { label: "Revenue", value: "revenue" },
  { label: "Date", value: "date" },
];

const defaultColumns = ["title", ...columnOptions.map((item) => item.value)];

function campaignMetric(row: CampaignAnalyticsRow, sortKey: string) {
  const metrics: Record<string, number | string> = {
    name: row.name.toLocaleLowerCase(),
    views: row.total_views,
    opens: row.total_opens,
    installs: row.total_installs,
    reinstalls: row.total_reinstalls,
    reactivations: row.total_reactivations,
    app_opens: row.total_app_opens,
    user_referred: row.total_user_referred,
    revenue: row.total_revenue,
    created_at: Date.parse(row.created_at) || 0,
  };
  return metrics[sortKey] ?? 0;
}

export default function CampaignsPageContent() {
  const router = useRouter();
  const { selectedProject } = useProjectSelection();
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
  } = useTableParams({ defaultSortKey: "created_at" });
  const [status, setStatus] = useUrlState("status", ACTIVE);
  const [campaigns, setCampaigns] = useState<CampaignAnalyticsRow[]>([]);
  const [selectedColumns, setSelectedColumns] =
    useState<string[]>(defaultColumns);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const data = await getLinkCampaignAnalytics(selectedProject.id, {
        from: dateRange?.from?.toISOString().slice(0, 10),
        to: dateRange?.to?.toISOString().slice(0, 10),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        interval: "day",
        platform: platform || undefined,
      });
      setCampaigns(data);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [dateRange?.from, dateRange?.to, platform, selectedProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
    const archived = status === ARCHIVED;
    return campaigns
      .filter((campaign) =>
        archived
          ? campaign.status === ARCHIVED
          : campaign.status !== ARCHIVED,
      )
      .filter(
        (campaign) =>
          !normalizedSearch ||
          campaign.name.toLocaleLowerCase().includes(normalizedSearch) ||
          campaign.slug.toLocaleLowerCase().includes(normalizedSearch),
      )
      .sort((left, right) => {
        const first = campaignMetric(left, sort.sortKey);
        const second = campaignMetric(right, sort.sortKey);
        const comparison =
          typeof first === "string" && typeof second === "string"
            ? first.localeCompare(second)
            : Number(first) - Number(second);
        return sort.ascending ? comparison : -comparison;
      });
  }, [campaigns, searchTerm, sort, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage,
  );
  const tableColumns = useMemo(
    () => createCampaignAnalyticsColumns(sort, setSort),
    [setSort, sort],
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount, setPage]);

  const createCampaign = async () => {
    const name = campaignName.trim();
    if (!selectedProject || !name) return;
    setCreating(true);
    try {
      const created = await createLinkCampaign(selectedProject.id, {
        name,
        slug: name
          .toLocaleLowerCase()
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        status: ACTIVE,
        metadata: { channel: "acquisition" },
      });
      setCampaignName("");
      setCreateOpen(false);
      router.push(`/dynamic-links/campaigns/${created.id}`);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  return (
    <ModulePage
      title="Campaigns"
      description="Measure every acquisition campaign from link view to referred customer and revenue."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-[240px] flex-1 flex-wrap gap-2">
              <Input
                className="w-full min-w-[180px] max-w-[280px]"
                placeholder="Search campaigns"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.currentTarget.value)}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="whitespace-nowrap">
                    {status === ACTIVE ? "Active" : "Archived"}
                    <ChevronDown className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 space-y-2 p-2">
                  <p className="text-sm text-muted-foreground">Status</p>
                  {[
                    { label: "Active", value: ACTIVE },
                    { label: "Archived", value: ARCHIVED },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={status === option.value}
                        onCheckedChange={() => setStatus(option.value)}
                      />
                      {option.label}
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
                title="Platforms"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <CustomizeColumns
                columnOptions={columnOptions}
                selectedColumns={selectedColumns}
                setSelectedColumns={setSelectedColumns}
              />
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Create campaign
              </Button>
            </div>
          </div>

          <CampaignAnalyticsTable
            columns={tableColumns}
            data={visible}
            selectedColumns={selectedColumns}
            loading={loading}
            hasFilters={Boolean(searchTerm || platform)}
            isArchived={status === ARCHIVED}
            onCreateCampaign={() => setCreateOpen(true)}
            onOpenCampaign={(campaignId) =>
              router.push(`/dynamic-links/campaigns/${campaignId}`)
            }
          />

          {filtered.length > 0 ? (
            <PaginationFooter
              rowsPerPage={rowsPerPage}
              setRowsPerPage={setRowsPerPage}
              page={currentPage}
              setPage={setPage}
              totalRows={filtered.length}
              pageCount={pageCount}
            />
          ) : null}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create acquisition campaign</DialogTitle>
            <DialogDescription>
              Group dynamic links and measure their performance independently
              from email campaigns.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Summer launch"
            value={campaignName}
            onChange={(event) => setCampaignName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && campaignName.trim()) {
                event.preventDefault();
                void createCampaign();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!campaignName.trim() || creating}
              onClick={() => void createCampaign()}
            >
              <Plus className="size-4" />
              {creating ? "Creating…" : "Create campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ModulePage>
  );
}
