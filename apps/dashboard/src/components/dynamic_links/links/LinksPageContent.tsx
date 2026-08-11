"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import {
  createLink,
  deleteLink,
  getLinkCampaigns,
  getLinks,
  updateLink,
  type DynamicLink,
  type LinkCampaign,
} from "@/api/dynamic-links/dynamicLinksService";
import { ACTIVE, ARCHIVED } from "@/constants/OptionsConstants";
import { adsFilterList, platformsFilterList } from "@/constants/FilterOptions";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useTableParams } from "@/hooks/useTableParams";
import { useUrlState } from "@/hooks/useUrlState";
import { showErrorNotification, showSuccessNotification } from "@/lib/Notifications";
import AdsPlatformSelect from "@/components/common/ads-platform";
import CustomizeColumns from "@/components/common/customize-columns";
import { PaginationFooter } from "@/components/common/pagination-footer";
import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import { EmptyProject, ModulePage, moduleErrorMessage } from "@/components/modules/ModulePage";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import LinksTable from "./LinksTable";
import { getLinksTableColumns } from "./LinksTableColumns";
import { toLinkData, type LinkData } from "./linkAnalytics";

type LinkForm = {
  id?: string;
  name: string;
  slug: string;
  destination: string;
  ios: string;
  android: string;
  web: string;
  desktop: string;
  campaignId: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  tags: string;
  source: string;
  medium: string;
  trackingCampaign: string;
  active: boolean;
};

const emptyForm: LinkForm = {
  name: "",
  slug: "",
  destination: "",
  ios: "",
  android: "",
  web: "",
  desktop: "",
  campaignId: "",
  title: "",
  subtitle: "",
  imageUrl: "",
  tags: "",
  source: "",
  medium: "",
  trackingCampaign: "",
  active: true,
};

function toForm(link: DynamicLink): LinkForm {
  return {
    id: link.id,
    name: link.name,
    slug: link.slug,
    destination: link.destination_url,
    ios: link.destinations.ios ?? "",
    android: link.destinations.android ?? "",
    web: link.destinations.web ?? "",
    desktop: link.destinations.desktop ?? "",
    campaignId: link.campaign_id ?? "",
    title: link.title ?? "",
    subtitle: link.subtitle ?? "",
    imageUrl: link.image_url ?? "",
    tags: typeof link.utm.tags === "string" ? link.utm.tags : "",
    source: typeof link.utm.source === "string" ? link.utm.source : "",
    medium: typeof link.utm.medium === "string" ? link.utm.medium : "",
    trackingCampaign:
      typeof link.utm.campaign === "string" ? link.utm.campaign : "",
    active: link.active,
  };
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function LinksPageContent({ campaignId }: { campaignId?: string }) {
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
  } = useTableParams({ defaultSortKey: "updated_at" });
  const [status, setStatus] = useUrlState("status", ACTIVE);
  const [linkType, setLinkType] = useUrlState("type", "");
  const [links, setLinks] = useState<DynamicLink[]>([]);
  const [campaigns, setCampaigns] = useState<LinkCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<LinkForm>(emptyForm);
  const [selectedColumns, setSelectedColumns] = useState([
    "ads_platform",
    "title",
    "tags",
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
  ]);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [linkRows, campaignRows] = await Promise.all([
        getLinks(selectedProject.id, searchTerm, status === ACTIVE, {
          from: dateRange?.from?.toISOString().slice(0, 10),
          to: dateRange?.to?.toISOString().slice(0, 10),
          platform: platform || undefined,
        }),
        getLinkCampaigns(selectedProject.id),
      ]);
      setLinks(linkRows);
      setCampaigns(campaignRows);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [dateRange?.from, dateRange?.to, platform, searchTerm, selectedProject, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const from = dateRange?.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const to = dateRange?.to?.getTime() ?? Number.POSITIVE_INFINITY;
    return links
      .filter((link) => !campaignId || link.campaign_id === campaignId)
      .filter((link) => {
        const created = Date.parse(link.created_at);
        return !Number.isFinite(created) || (created >= from && created <= to);
      })
      .filter(
        (link) =>
          !linkType ||
          (typeof link.utm.source === "string"
            ? link.utm.source === linkType
            : linkType === "quick-link"),
      )
      .filter(
        (link) => !platform || Boolean(link.destinations[platform]),
      )
      .map(toLinkData)
      .sort((left, right) => {
        const keys: Record<string, keyof LinkData> = {
          name: "name",
          tags: "tags",
          views: "total_views",
          opens: "total_opens",
          installs: "total_installs",
          reinstalls: "total_reinstalls",
          reactivations: "total_reactivations",
          app_opens: "total_app_opens",
          user_referred: "total_user_referred",
          time_spent: "total_time_spent",
          revenue: "total_revenue",
          updated_at: "updated_at",
        };
        const key = keys[sort.sortKey] ?? "updated_at";
        const first = left[key];
        const second = right[key];
        const comparison =
          typeof first === "number" && typeof second === "number"
            ? first - second
            : String(first).localeCompare(String(second));
        return sort.ascending ? comparison : -comparison;
      });
  }, [campaignId, dateRange?.from, dateRange?.to, linkType, links, platform, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage,
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount, setPage]);

  const openCreate = () => {
    setForm({ ...emptyForm, campaignId: campaignId ?? "" });
    setDialogOpen(true);
  };

  const openEdit = useCallback((row: LinkData) => {
    const link = links.find((item) => item.id === row.id);
    if (!link) return;
    setForm(toForm(link));
    setDialogOpen(true);
  }, [links]);

  const payload = () => ({
    slug: form.slug.trim(),
    name: form.name.trim() || form.slug.trim(),
    destination_url: form.destination.trim(),
    destinations: Object.fromEntries(
      Object.entries({
        ios: form.ios.trim(),
        android: form.android.trim(),
        web: form.web.trim(),
        desktop: form.desktop.trim(),
      }).filter(([, value]) => value),
    ),
    campaign_id: form.campaignId || null,
    title: form.title.trim() || null,
    subtitle: form.subtitle.trim() || null,
    image_url: form.imageUrl.trim() || null,
    utm: {
      source: form.source.trim(),
      medium: form.medium.trim(),
      campaign: form.trackingCampaign.trim(),
      tags: form.tags.trim(),
    },
    active: form.active,
  });

  const save = async () => {
    if (!selectedProject || !form.slug.trim() || !form.destination.trim()) return;
    setSaving(true);
    try {
      if (form.id) {
        await updateLink(selectedProject.id, form.id, payload());
        showSuccessNotification("Link updated");
      } else {
        await createLink(selectedProject.id, payload());
        showSuccessNotification("Link created");
      }
      setDialogOpen(false);
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedProject || !form.id) return;
    setSaving(true);
    try {
      await deleteLink(selectedProject.id, form.id);
      setDialogOpen(false);
      showSuccessNotification("Link deleted");
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const header = [
      "Title",
      "Slug",
      "Tags",
      "Views",
      "Opens",
      "Installs",
      "Reinstalls",
      "Reactivations",
      "App opens",
      "Users referred",
      "Time spent",
      "Revenue",
      "Date",
    ];
    const rows = filtered.map((link) => [
      link.name,
      link.path,
      link.tags.join(";"),
      link.total_views,
      link.total_opens,
      link.total_installs,
      link.total_reinstalls,
      link.total_reactivations,
      link.total_app_opens,
      link.total_user_referred,
      link.total_time_spent,
      link.total_revenue,
      link.updated_at,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "dynamic-links.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const columns = useMemo(
    () => getLinksTableColumns(sort, setSort, openEdit),
    [openEdit, sort, setSort],
  );

  const columnOptions = [
    { label: "Tags", value: "tags" },
    { label: "Views", value: "views" },
    { label: "Opens", value: "opens" },
    { label: "Installs", value: "installs" },
    { label: "Reinstalls", value: "reinstalls" },
    { label: "Reactivations", value: "reactivations" },
    { label: "App opens", value: "app_opens" },
    { label: "Users referred", value: "user_referred" },
    { label: "Time spent", value: "time_spent" },
    { label: "Revenue", value: "revenue" },
    { label: "Date", value: "date" },
  ];

  return (
    <ModulePage
      title={campaignId ? "Campaign links" : "Links"}
      description="Create, route and measure links across every platform and acquisition source."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-[260px] flex-1 flex-wrap gap-2">
              <Input
                className="w-full min-w-[180px] max-w-[260px]"
                placeholder="Search link"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.currentTarget.value)}
              />
              {!campaignId ? (
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ACTIVE}>Active</SelectItem>
                    <SelectItem value={ARCHIVED}>Archived</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              <DateRangePicker date={dateRange} setDate={setDateRange} />
              <AdsPlatformSelect
                platformAdsOptions={adsFilterList}
                selectedAdsPlatform={linkType}
                setSelectedAdsPlatforms={setLinkType}
                title="Types"
                selectListTitle="Types"
              />
              <AdsPlatformSelect
                platformAdsOptions={platformsFilterList}
                selectedAdsPlatform={platform}
                setSelectedAdsPlatforms={setPlatform}
                title="Platforms"
                selectListTitle="Platforms"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportCsv}>
                <Download className="size-4" /> Export
              </Button>
              <CustomizeColumns
                columnOptions={columnOptions}
                selectedColumns={selectedColumns}
                setSelectedColumns={setSelectedColumns}
              />
              <Button onClick={openCreate}><Plus className="size-4" /> Create Link</Button>
            </div>
          </div>
          <LinksTable
            selectedColumns={selectedColumns}
            data={visible}
            columns={columns}
            handleEditLink={openEdit}
            loading={loading}
            isCampaign={Boolean(campaignId)}
            isArchived={status === ARCHIVED}
            hasFilters={Boolean(searchTerm || linkType || platform)}
            onCreateLink={openCreate}
          />
          {filtered.length ? (
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit link" : "Create link"}</DialogTitle>
            <DialogDescription>
              Configure the short path, platform destinations, social preview and UTM tracking.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2 sm:grid-cols-2">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Link details</h3>
              <Field label="Name" value={form.name} onChange={(name) => setForm((v) => ({ ...v, name }))} />
              <Field label="Slug" value={form.slug} onChange={(slug) => setForm((v) => ({ ...v, slug: slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-") }))} />
              <Field label="Default destination" type="url" value={form.destination} onChange={(destination) => setForm((v) => ({ ...v, destination }))} />
              <label className="space-y-2 text-sm"><span>Campaign</span>
                <Select value={form.campaignId || "none"} onValueChange={(campaignId) => setForm((v) => ({ ...v, campaignId: campaignId === "none" ? "" : campaignId }))}>
                  <SelectTrigger><SelectValue placeholder="No campaign" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No campaign</SelectItem>{campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <Field label="Tags (comma separated)" value={form.tags} onChange={(tags) => setForm((v) => ({ ...v, tags }))} />
              <label className="flex items-center gap-3 text-sm"><Switch checked={form.active} onCheckedChange={(active) => setForm((v) => ({ ...v, active }))} /> Active</label>
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Platform routing</h3>
              <Field label="iOS destination" type="url" value={form.ios} onChange={(ios) => setForm((v) => ({ ...v, ios }))} />
              <Field label="Android destination" type="url" value={form.android} onChange={(android) => setForm((v) => ({ ...v, android }))} />
              <Field label="Web destination" type="url" value={form.web} onChange={(web) => setForm((v) => ({ ...v, web }))} />
              <Field label="Desktop destination" type="url" value={form.desktop} onChange={(desktop) => setForm((v) => ({ ...v, desktop }))} />
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Social preview</h3>
              <Field label="Title" value={form.title} onChange={(title) => setForm((v) => ({ ...v, title }))} />
              <Field label="Description" value={form.subtitle} onChange={(subtitle) => setForm((v) => ({ ...v, subtitle }))} />
              <Field label="Image URL" type="url" value={form.imageUrl} onChange={(imageUrl) => setForm((v) => ({ ...v, imageUrl }))} />
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">UTM tracking</h3>
              <Field label="Source" value={form.source} onChange={(source) => setForm((v) => ({ ...v, source }))} />
              <Field label="Medium" value={form.medium} onChange={(medium) => setForm((v) => ({ ...v, medium }))} />
              <Field label="Campaign" value={form.trackingCampaign} onChange={(trackingCampaign) => setForm((v) => ({ ...v, trackingCampaign }))} />
            </section>
          </div>
          <DialogFooter className="sm:justify-between">
            {form.id ? <Button variant="destructive" disabled={saving} onClick={() => void remove()}>Delete link</Button> : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button disabled={saving || !form.slug.trim() || !form.destination.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save link"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ModulePage>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value} onChange={(event) => onChange(event.currentTarget.value)} /></div>;
}
