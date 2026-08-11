"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccessorKeyColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import {
  createCustomer,
  deleteCustomer,
  getCustomers,
  getReferrals,
  type AppCustomer,
  type AppReferral,
} from "@/api/app/appService";
import CustomizeColumns from "@/components/common/customize-columns";
import DataTable from "@/components/common/DataTable";
import { PaginationFooter } from "@/components/common/pagination-footer";
import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import { EmptyProject, ModulePage, moduleErrorMessage } from "@/components/modules/ModulePage";
import { Badge } from "@/components/ui/badge";
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
import { useProjectSelection } from "@/context/useProjectSelection";
import { useTableParams } from "@/hooks/useTableParams";
import { formatSlashDate } from "@/lib/dateUtils";
import { showErrorNotification, showSuccessNotification } from "@/lib/Notifications";
import { parseSecondsInDaysHoursMinutesSeconds } from "@/lib/utils";
import type { SortType } from "@/types";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";
import { numberFormatter } from "@/utils/numberFormatter";
import { checkSortDirection } from "@/components/dynamic_links/links/LinksTableColumns";

type AudienceRow = {
  id: string;
  recordId: string;
  sdkIdentifier: string;
  platform?: string | null;
  label: string;
  detail: string;
  status?: string;
  views: number;
  opens: number;
  installs: number;
  reinstalls: number;
  reactivations: number;
  invitedUsers: number;
  timeSpent: number;
  revenue: number;
  date: string;
};

const metricColumns = [
  { label: "Views", value: "views" },
  { label: "Opens", value: "opens" },
  { label: "Installs", value: "installs" },
  { label: "Reinstalls", value: "reinstalls" },
  { label: "Reactivations", value: "reactivations" },
  { label: "Invited users", value: "invited_users" },
  { label: "Time spent", value: "time_spent" },
  { label: "Revenue", value: "revenue" },
];

const customerColumns = [
  "id",
  "sdk_identifier",
  "platform",
  ...metricColumns.map((column) => column.value),
  "date",
];

const referralColumns = [
  "id",
  "sdk_identifier",
  ...metricColumns.map((column) => column.value),
  "last_access",
];

function numeric(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

export function customerToAudienceRow(customer: AppCustomer): AudienceRow {
  const attributes = customer.attributes ?? {};
  const values = { ...attributes, ...customer } as Record<string, unknown>;
  return {
    id: customer.id,
    recordId: customer.id,
    sdkIdentifier: customer.external_id,
    platform: customer.platform,
    label: customer.name || customer.external_id,
    detail: customer.email || customer.external_id,
    views: numeric(values, "total_views", "views"),
    opens: numeric(values, "total_opens", "opens"),
    installs: numeric(values, "total_installs", "installs"),
    reinstalls: numeric(values, "total_reinstalls", "reinstalls"),
    reactivations: numeric(values, "total_reactivations", "reactivations"),
    invitedUsers: numeric(values, "total_user_referred", "invited_users"),
    timeSpent: numeric(values, "total_time_spent", "time_spent"),
    revenue: numeric(values, "total_revenue", "revenue_cents"),
    date: customer.last_seen_at || customer.updated_at || customer.first_seen_at,
  };
}

export function referralToAudienceRow(referral: AppReferral): AudienceRow {
  const values = referral as unknown as Record<string, unknown>;
  return {
    id: referral.id,
    recordId: referral.id,
    sdkIdentifier:
      referral.customer_external_id || referral.customer_id || referral.code,
    label: referral.code,
    detail: referral.invited_customer_external_id || referral.source || "Unassigned",
    status: referral.status,
    views: numeric(values, "view_count", "views"),
    opens: numeric(values, "open_count", "opens"),
    installs: numeric(values, "install_count", "installs"),
    reinstalls: numeric(values, "reinstall_count", "reinstalls"),
    reactivations: numeric(values, "reactivations"),
    invitedUsers: numeric(values, "user_referred_count", "invited_users"),
    timeSpent: numeric(values, "time_spent"),
    revenue: numeric(values, "total_revenue", "revenue_cents"),
    date: referral.converted_at || referral.created_at,
  };
}

function header(
  label: string,
  key: string,
  sort: SortType,
  setSort: React.Dispatch<React.SetStateAction<SortType>>,
) {
  return (
    <Button
      variant="ghost"
      onClick={() =>
        setSort((previous) => ({
          sortKey: key,
          ascending: previous.sortKey === key ? !previous.ascending : true,
        }))
      }
    >
      {label} {checkSortDirection(key, sort)}
    </Button>
  );
}

function columns(
  sort: SortType,
  setSort: React.Dispatch<React.SetStateAction<SortType>>,
  referral: boolean,
): AccessorKeyColumnDef<AudienceRow>[] {
  const result: AccessorKeyColumnDef<AudienceRow>[] = [
    {
      accessorKey: "id",
      header: () => header("Id", "id", sort, setSort),
      cell: ({ row }) => (
        <div className="min-w-32">
          <p className="font-medium">{row.original.label}</p>
          <code className="text-xs text-muted-foreground">
            {row.original.recordId.length > 18
              ? `${row.original.recordId.slice(0, 8)}…${row.original.recordId.slice(-6)}`
              : row.original.recordId}
          </code>
          {row.original.status ? (
            <Badge variant="outline" className="ml-2 capitalize">
              {row.original.status}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "sdk_identifier",
      header: () => header("SDK Identifier", "sdk_identifier", sort, setSort),
      cell: ({ row }) => (
        <div className="max-w-56">
          <p className="truncate">{row.original.sdkIdentifier}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.detail}</p>
        </div>
      ),
    },
  ];

  if (!referral) {
    result.push({
      accessorKey: "platform",
      header: () => header("Platform", "platform", sort, setSort),
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.original.platform || "unknown"}
        </Badge>
      ),
    });
  }

  result.push(
    ...([
      ["views", "Views", "views"],
      ["opens", "Opens", "opens"],
      ["installs", "Installs", "installs"],
      ["reinstalls", "Reinstalls", "reinstalls"],
      ["reactivations", "Reactivations", "reactivations"],
      ["invited_users", "Invited users", "invitedUsers"],
    ] as const).map(([accessorKey, label, field]) => ({
      accessorKey,
      header: () => header(label, field, sort, setSort),
      cell: ({ row }: { row: { original: AudienceRow } }) =>
        row.original[field] ? numberFormatter.format(row.original[field]) : "—",
    })),
    {
      accessorKey: "time_spent",
      header: () => header("Time spent", "timeSpent", sort, setSort),
      cell: ({ row }) =>
        parseSecondsInDaysHoursMinutesSeconds(row.original.timeSpent) || "—",
    },
    {
      accessorKey: "revenue",
      header: () => header("Revenue", "revenue", sort, setSort),
      cell: ({ row }) =>
        row.original.revenue
          ? formatCurrencyFromCents(row.original.revenue)
          : "—",
    },
    {
      accessorKey: referral ? "last_access" : "date",
      header: () =>
        header(referral ? "Last access" : "Date", "date", sort, setSort),
      cell: ({ row }) => formatSlashDate(row.original.date),
    },
  );
  return result;
}

function rowSort(left: AudienceRow, right: AudienceRow, sort: SortType) {
  const keys: Record<string, keyof AudienceRow> = {
    id: "recordId",
    sdk_identifier: "sdkIdentifier",
    platform: "platform",
    views: "views",
    opens: "opens",
    installs: "installs",
    reinstalls: "reinstalls",
    reactivations: "reactivations",
    invitedUsers: "invitedUsers",
    timeSpent: "timeSpent",
    revenue: "revenue",
    date: "date",
  };
  const key = keys[sort.sortKey] ?? "date";
  const first = left[key];
  const second = right[key];
  const comparison =
    typeof first === "number" && typeof second === "number"
      ? first - second
      : String(first ?? "").localeCompare(String(second ?? ""));
  return sort.ascending ? comparison : -comparison;
}

export function CustomersAnalyticsPage() {
  const { selectedProject } = useProjectSelection();
  const table = useTableParams({ defaultSortKey: "date" });
  const [customers, setCustomers] = useState<AppCustomer[]>([]);
  const [selectedColumns, setSelectedColumns] = useState(customerColumns);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<AppCustomer | null>(null);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const result = await getCustomers(selectedProject.id, table.searchTerm, 0, {
        from: table.dateRange?.from?.toISOString().slice(0,10),
        to: table.dateRange?.to?.toISOString().slice(0,10),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setCustomers(result.items);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedProject, table.dateRange?.from, table.dateRange?.to, table.searchTerm]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    return customers
      .map(customerToAudienceRow)
      .sort((left, right) => rowSort(left, right, table.sort));
  }, [customers, table.sort]);

  return (
    <AudiencePage
      title="Customers"
      description="Acquisition identities and their complete app engagement history."
      selected={Boolean(selectedProject)}
      error={error}
      rows={rows}
      loading={loading}
      table={table}
      selectedColumns={selectedColumns}
      setSelectedColumns={setSelectedColumns}
      columnOptions={[{ label: "Platform", value: "platform" }, ...metricColumns, { label: "Date", value: "date" }]}
      referral={false}
      searchPlaceholder="Search customer"
      actionLabel="Add customer"
      onAction={() => { setSelected(null); setDialogOpen(true); }}
      onRow={(row) => { setSelected(customers.find((customer) => customer.id === row.id) ?? null); setDialogOpen(true); }}
      dialog={<CustomerDialog open={dialogOpen} onOpenChange={setDialogOpen} customer={selected} onSaved={load} />}
    />
  );
}

export function ReferralsAnalyticsPage() {
  const { selectedProject } = useProjectSelection();
  const table = useTableParams({ defaultSortKey: "date" });
  const [referrals, setReferrals] = useState<AppReferral[]>([]);
  const [selectedColumns, setSelectedColumns] = useState(referralColumns);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      setReferrals(await getReferrals(selectedProject.id, {
        from: table.dateRange?.from?.toISOString().slice(0,10),
        to: table.dateRange?.to?.toISOString().slice(0,10),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }));
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedProject, table.dateRange?.from, table.dateRange?.to]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const search = table.searchTerm.trim().toLocaleLowerCase();
    return referrals
      .map(referralToAudienceRow)
      .filter((row) => !search || `${row.label} ${row.sdkIdentifier} ${row.detail}`.toLocaleLowerCase().includes(search))
      .sort((left, right) => rowSort(left, right, table.sort));
  }, [referrals, table.searchTerm, table.sort]);

  return (
    <AudiencePage
      title="Referrals"
      description="Referral codes, attributed customers and the complete conversion lifecycle."
      selected={Boolean(selectedProject)}
      error={error}
      rows={rows}
      loading={loading}
      table={table}
      selectedColumns={selectedColumns}
      setSelectedColumns={setSelectedColumns}
      columnOptions={[...metricColumns, { label: "Last access", value: "last_access" }]}
      referral
      searchPlaceholder="Search referral"
    />
  );
}

type TableState = ReturnType<typeof useTableParams>;

function AudiencePage({ title, description, selected, error, rows, loading, table, selectedColumns, setSelectedColumns, columnOptions, referral, searchPlaceholder, actionLabel, onAction, onRow, dialog }: {
  title: string; description: string; selected: boolean; error: string | null; rows: AudienceRow[]; loading: boolean; table: TableState;
  selectedColumns: string[]; setSelectedColumns: React.Dispatch<React.SetStateAction<string[]>>; columnOptions: Array<{label:string;value:string}>;
  referral: boolean; searchPlaceholder: string; actionLabel?: string; onAction?: () => void; onRow?: (row: AudienceRow) => void; dialog?: React.ReactNode;
}) {
  const pageCount = Math.max(1, Math.ceil(rows.length / table.rowsPerPage));
  const page = Math.min(table.page, pageCount);
  const visible = rows.slice((page - 1) * table.rowsPerPage, page * table.rowsPerPage);
  const tableColumns = useMemo(() => columns(table.sort, table.setSort, referral), [referral, table.setSort, table.sort]);
  useEffect(() => { if (table.page > pageCount) table.setPage(pageCount); }, [pageCount, table]);
  return <ModulePage title={title} description={description} error={error}>{!selected ? <EmptyProject /> : <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-1 flex-wrap gap-2"><Input className="max-w-72" placeholder={searchPlaceholder} value={table.searchTerm} onChange={(event) => table.setSearchTerm(event.currentTarget.value)} /><DateRangePicker date={table.dateRange} setDate={table.setDateRange} /></div><div className="flex gap-2"><CustomizeColumns columnOptions={columnOptions} selectedColumns={selectedColumns} setSelectedColumns={setSelectedColumns} />{onAction&&actionLabel?<Button onClick={onAction}><Plus className="size-4" />{actionLabel}</Button>:null}</div></div>
    <DataTable columns={tableColumns} data={visible} selectedColumns={selectedColumns} onRowClick={onRow} getRowId={(row) => row.id} getRowAriaLabel={(row) => `View ${row.label}`} loading={loading} hasFilters={Boolean(table.searchTerm)} ariaLabel={title} stickyHeader emptyState={<div className="flex flex-col items-center gap-3 bg-sidebar px-4 py-14 text-center"><h3 className="font-semibold">No {title.toLocaleLowerCase()} yet</h3><p className="max-w-md text-sm text-muted-foreground">New records will appear here with their engagement and attribution metrics.</p>{onAction&&actionLabel?<Button onClick={onAction}><Plus className="size-4" />{actionLabel}</Button>:null}</div>} />
    {rows.length ? <PaginationFooter rowsPerPage={table.rowsPerPage} setRowsPerPage={table.setRowsPerPage} page={page} setPage={table.setPage} totalRows={rows.length} pageCount={pageCount} /> : null}
  </div>}{dialog}</ModulePage>;
}

function CustomerDialog({ open, onOpenChange, customer, onSaved }: { open: boolean; onOpenChange: (open:boolean)=>void; customer: AppCustomer|null; onSaved:()=>Promise<void> }) {
  const { selectedProject } = useProjectSelection();
  const [externalId,setExternalId]=useState(""); const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [platform,setPlatform]=useState(""); const [country,setCountry]=useState(""); const [saving,setSaving]=useState(false);
  useEffect(()=>{setExternalId(customer?.external_id??"");setName(customer?.name??"");setEmail(customer?.email??"");setPlatform(customer?.platform??"");setCountry(customer?.country_code??"");},[customer,open]);
  const save=async()=>{if(!selectedProject||!externalId.trim())return;setSaving(true);try{await createCustomer(selectedProject.id,{external_id:externalId.trim(),name:name.trim()||null,email:email.trim()||null,platform:platform||null,country_code:country.trim().toUpperCase()||null,attributes:customer?.attributes??{}});showSuccessNotification(customer?"Customer updated":"Customer created");onOpenChange(false);await onSaved();}catch(cause){showErrorNotification(moduleErrorMessage(cause));}finally{setSaving(false);}};
  const remove=async()=>{if(!selectedProject||!customer)return;setSaving(true);try{await deleteCustomer(selectedProject.id,customer.id);showSuccessNotification("Customer deleted");onOpenChange(false);await onSaved();}catch(cause){showErrorNotification(moduleErrorMessage(cause));}finally{setSaving(false);}};
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{customer?"Customer details":"Add customer"}</DialogTitle><DialogDescription>The SDK identifier is the stable acquisition identity for this project.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="SDK identifier" value={externalId} onChange={setExternalId}/><Field label="Name" value={name} onChange={setName}/><Field label="Email" type="email" value={email} onChange={setEmail}/><label className="space-y-2"><Label>Platform</Label><Select value={platform||"none"} onValueChange={(value)=>setPlatform(value==="none"?"":value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unknown</SelectItem><SelectItem value="ios">iOS</SelectItem><SelectItem value="android">Android</SelectItem><SelectItem value="web">Web</SelectItem></SelectContent></Select></label><Field label="Country code" value={country} onChange={setCountry}/></div><DialogFooter className="sm:justify-between">{customer?<Button variant="destructive" disabled={saving} onClick={()=>void remove()}><Trash2 className="size-4"/>Delete</Button>:<span/>}<Button disabled={saving||!externalId.trim()} onClick={()=>void save()}>{saving?"Saving…":"Save customer"}</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({label,value,onChange,type="text"}:{label:string;value:string;onChange:(value:string)=>void;type?:string}){return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value} onChange={(event)=>onChange(event.currentTarget.value)}/></div>;}
