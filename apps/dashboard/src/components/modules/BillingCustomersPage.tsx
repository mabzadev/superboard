"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Eye,
  RefreshCw,
  Search,
  ShieldBan,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import {
  deleteBillingCustomer,
  getBillingCustomer,
  getBillingOverview,
  grantBillingEntitlement,
  mergeBillingCustomers,
  revokeBillingEntitlement,
  searchBillingCustomers,
  setBillingCustomerBlocked,
  type BillingCustomerDetail,
  type BillingCustomerSummary,
  type BillingOverview,
} from "@/api/billing/billingService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

export default function BillingCustomersPage() {
  const { selectedProject } = useProjectSelection();
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<BillingCustomerSummary[]>([]);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [detail, setDetail] = useState<BillingCustomerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantId, setGrantId] = useState("");
  const [grantExpiry, setGrantExpiry] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeConfirmation, setMergeConfirmation] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [page, billing] = await Promise.all([
        searchBillingCustomers(selectedProject.id, query.trim()),
        getBillingOverview(selectedProject.id),
      ]);
      setCustomers(page.data);
      setOverview(billing);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [query, selectedProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCustomer = useCallback(
    async (customerId: string) => {
      if (!selectedProject) return;
      setDetailLoading(true);
      try {
        setDetail(await getBillingCustomer(selectedProject.id, customerId));
        setGrantId("");
        setGrantExpiry("");
        setMergeTarget("");
        setMergeConfirmation("");
        setDeleteConfirmation("");
      } catch (cause) {
        showErrorNotification(moduleErrorMessage(cause));
      } finally {
        setDetailLoading(false);
      }
    },
    [selectedProject]
  );

  const refreshDetail = async () => {
    if (detail) await openCustomer(detail.customer.id);
  };

  const mutate = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await operation();
      showSuccessNotification(message);
      await Promise.all([load(), refreshDetail()]);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const activeEntitlements = useMemo(
    () =>
      Object.values(detail?.customer_info.entitlements ?? {}).filter(
        (entitlement) => entitlement.is_active
      ),
    [detail]
  );
  const paywallEvents = detail?.paywall_events ?? [];

  return (
    <ModulePage
      title="Billing customers"
      description="Application identities, subscriptions, entitlements, balances, transactions and paywall activity."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer search</CardTitle>
              <CardDescription>
                Results are isolated to the selected SuperBoard project.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <div className="relative min-w-64 flex-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={query}
                  placeholder="App user ID or alias"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </div>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw className={loading ? "animate-spin" : ""} />
                Refresh
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1.15fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-5" />
                  Customers
                </CardTitle>
                <CardDescription>
                  {customers.length} financial identities in the current page.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Identity</TableHead>
                      <TableHead>Subscriptions</TableHead>
                      <TableHead>Transactions</TableHead>
                      <TableHead>Last seen</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <code className="max-w-48 truncate text-xs">
                              {customer.primary_app_user_id}
                            </code>
                            {Boolean(customer.blocked) && (
                              <Badge variant="destructive">Blocked</Badge>
                            )}
                            {Boolean(customer.anonymous) && (
                              <Badge variant="outline">Anonymous</Badge>
                            )}
                          </div>
                          <code className="block max-w-48 truncate text-xs text-muted-foreground">
                            {customer.id}
                          </code>
                        </TableCell>
                        <TableCell>
                          {Number(
                            customer.active_subscription_count || 0
                          ).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {Number(
                            customer.transaction_count || 0
                          ).toLocaleString()}
                        </TableCell>
                        <TableCell>{date(customer.last_seen_at)}</TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Open ${customer.primary_app_user_id}`}
                            onClick={() => void openCustomer(customer.id)}
                          >
                            <Eye />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!loading && customers.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-10 text-center text-muted-foreground"
                        >
                          No customer matches this search.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <CustomerDetail
              detail={detail}
              overview={overview}
              loading={detailLoading}
              busy={busy}
              grantId={grantId}
              setGrantId={setGrantId}
              grantExpiry={grantExpiry}
              setGrantExpiry={setGrantExpiry}
              mergeTarget={mergeTarget}
              setMergeTarget={setMergeTarget}
              mergeConfirmation={mergeConfirmation}
              setMergeConfirmation={setMergeConfirmation}
              deleteConfirmation={deleteConfirmation}
              setDeleteConfirmation={setDeleteConfirmation}
              activeEntitlements={activeEntitlements}
              paywallEvents={paywallEvents}
              onBlock={(blocked) => {
                if (!detail) return;
                void mutate(
                  () =>
                    setBillingCustomerBlocked(
                      selectedProject.id,
                      detail.customer.id,
                      blocked
                    ),
                  blocked ? "Customer blocked" : "Customer unblocked"
                );
              }}
              onGrant={() => {
                if (!detail || !grantId) return;
                void mutate(
                  () =>
                    grantBillingEntitlement(
                      selectedProject.id,
                      detail.customer.id,
                      grantId,
                      grantExpiry
                        ? new Date(grantExpiry).toISOString()
                        : null
                    ),
                  "Promotional entitlement granted"
                );
              }}
              onRevoke={(identifier) => {
                if (!detail) return;
                const entitlement = overview?.entitlements.find(
                  (candidate) => candidate.identifier === identifier
                );
                if (!entitlement) return;
                void mutate(
                  () =>
                    revokeBillingEntitlement(
                      selectedProject.id,
                      detail.customer.id,
                      entitlement.id
                    ),
                  "Promotional entitlement revoked"
                );
              }}
              onMerge={() => {
                if (!detail || mergeConfirmation !== "MERGE") return;
                setBusy(true);
                void mergeBillingCustomers(
                  selectedProject.id,
                  detail.customer.id,
                  mergeTarget.trim()
                )
                  .then(async () => {
                    showSuccessNotification("Customer identities merged");
                    setDetail(null);
                    await load();
                  })
                  .catch((cause) =>
                    showErrorNotification(moduleErrorMessage(cause))
                  )
                  .finally(() => setBusy(false));
              }}
              onDelete={() => {
                if (
                  !detail ||
                  deleteConfirmation !== detail.customer.id
                )
                  return;
                setBusy(true);
                void deleteBillingCustomer(
                  selectedProject.id,
                  detail.customer.id
                )
                  .then(async () => {
                    showSuccessNotification("Billing customer deleted");
                    setDetail(null);
                    await load();
                  })
                  .catch((cause) =>
                    showErrorNotification(moduleErrorMessage(cause))
                  )
                  .finally(() => setBusy(false));
              }}
            />
          </div>
        </div>
      )}
    </ModulePage>
  );
}

type DetailProps = {
  detail: BillingCustomerDetail | null;
  overview: BillingOverview | null;
  loading: boolean;
  busy: boolean;
  grantId: string;
  setGrantId: (value: string) => void;
  grantExpiry: string;
  setGrantExpiry: (value: string) => void;
  mergeTarget: string;
  setMergeTarget: (value: string) => void;
  mergeConfirmation: string;
  setMergeConfirmation: (value: string) => void;
  deleteConfirmation: string;
  setDeleteConfirmation: (value: string) => void;
  activeEntitlements: BillingCustomerDetail["customer_info"]["entitlements"][string][];
  paywallEvents: Array<Record<string, unknown>>;
  onBlock: (blocked: boolean) => void;
  onGrant: () => void;
  onRevoke: (identifier: string) => void;
  onMerge: () => void;
  onDelete: () => void;
};

function CustomerDetail(props: DetailProps) {
  if (!props.detail) {
    return (
      <Card>
        <CardContent className="flex min-h-72 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {props.loading
            ? "Loading customer…"
            : "Select a customer to inspect billing, subscriptions, entitlements and paywall events."}
        </CardContent>
      </Card>
    );
  }
  const { customer, customer_info: info } = props.detail;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{customer.primary_app_user_id}</CardTitle>
              <CardDescription className="font-mono">
                {customer.id}
              </CardDescription>
            </div>
            <Button
              variant={customer.blocked ? "outline" : "destructive"}
              disabled={props.busy}
              onClick={() => props.onBlock(!Boolean(customer.blocked))}
            >
              {customer.blocked ? <ShieldCheck /> : <ShieldBan />}
              {customer.blocked ? "Unblock" : "Block"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Value label="First seen" value={date(customer.first_seen_at)} />
          <Value label="Last seen" value={date(customer.last_seen_at)} />
          <Value
            label="Aliases"
            value={
              info.aliases.length ? info.aliases.join(", ") : "No aliases"
            }
          />
          <Value
            label="CustomerInfo proof"
            value={`${info.signature_algorithm} · ${info.signature_key_id}`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entitlements and subscriptions</CardTitle>
          <CardDescription>
            Verified purchase state and explicit promotional overrides.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {props.activeEntitlements.map((entitlement) => (
              <div
                key={entitlement.identifier}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div>
                  <strong>{entitlement.identifier}</strong>
                  <p className="text-xs text-muted-foreground">
                    {entitlement.status} · {entitlement.store || "manual"} ·{" "}
                    {entitlement.expires_at
                      ? `expires ${date(entitlement.expires_at)}`
                      : "no expiry"}{" "}
                    · {entitlement.verification || "unknown proof"}
                  </p>
                </div>
                {entitlement.verification === "admin" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={props.busy}
                    onClick={() => props.onRevoke(entitlement.identifier)}
                  >
                    Revoke promotion
                  </Button>
                )}
              </div>
            ))}
            {props.activeEntitlements.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No active entitlement.
              </p>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_190px_auto]">
            <select
              aria-label="Promotional entitlement"
              className={selectClass}
              value={props.grantId}
              onChange={(event) => props.setGrantId(event.target.value)}
            >
              <option value="">Select entitlement</option>
              {(props.overview?.entitlements ?? [])
                .filter((item) => Boolean(item.active))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name} ({item.identifier})
                  </option>
                ))}
            </select>
            <Input
              aria-label="Promotion expiry"
              type="datetime-local"
              value={props.grantExpiry}
              onChange={(event) => props.setGrantExpiry(event.currentTarget.value)}
            />
            <Button
              disabled={props.busy || !props.grantId}
              onClick={props.onGrant}
            >
              Grant promotion
            </Button>
          </div>
          <RecordTable
            title="Subscriptions"
            rows={info.subscriptions}
            columns={["store_product_id", "store", "status", "expires_at"]}
          />
          <div>
            <h3 className="mb-2 text-sm font-semibold">Virtual balances</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(info.balances).map(([currency, balance]) => (
                <Badge key={currency} variant="secondary">
                  {currency}: {Number(balance).toLocaleString()}
                </Badge>
              ))}
              {Object.keys(info.balances).length === 0 && (
                <span className="text-sm text-muted-foreground">
                  No virtual balance.
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Financial and paywall history</CardTitle>
          <CardDescription>
            Read-only operational evidence for this customer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <RecordTable
            title="Transactions"
            rows={props.detail.transactions}
            columns={[
              "store",
              "store_transaction_id",
              "event_type",
              "status",
              "created_at",
            ]}
          />
          <RecordTable
            title="Paywall events"
            rows={props.paywallEvents}
            columns={[
              "event_type",
              "paywall_id",
              "placement_identifier",
              "occurred_at",
            ]}
          />
          <details>
            <summary className="cursor-pointer text-sm font-semibold">
              All billing events ({props.detail.events.length})
            </summary>
            <div className="mt-3">
              <RecordTable
                title=""
                rows={props.detail.events}
                columns={[
                  "event_type",
                  "status",
                  "store",
                  "occurred_at",
                ]}
              />
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identity operations</CardTitle>
          <CardDescription>
            Merge and deletion are audited and require explicit confirmation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Target customer ID</Label>
              <Input
                value={props.mergeTarget}
                onChange={(event) =>
                  props.setMergeTarget(event.currentTarget.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Type MERGE</Label>
              <Input
                value={props.mergeConfirmation}
                onChange={(event) =>
                  props.setMergeConfirmation(event.currentTarget.value)
                }
              />
            </div>
            <Button
              variant="outline"
              disabled={
                props.busy ||
                !props.mergeTarget.trim() ||
                props.mergeTarget.trim() === customer.id ||
                props.mergeConfirmation !== "MERGE"
              }
              onClick={props.onMerge}
            >
              Merge into target
            </Button>
          </div>
          <div className="rounded-md border border-destructive/40 p-4">
            <Label>Type the exact customer ID to delete</Label>
            <Input
              className="mt-2 font-mono"
              value={props.deleteConfirmation}
              placeholder={customer.id}
              onChange={(event) =>
                props.setDeleteConfirmation(event.currentTarget.value)
              }
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Transactions, subscriptions and events are retained without a
              customer link; aliases, balances and promotional rights are
              removed.
            </p>
            <Button
              className="mt-3"
              variant="destructive"
              disabled={
                props.busy || props.deleteConfirmation !== customer.id
              }
              onClick={props.onDelete}
            >
              <Trash2 />
              Delete billing customer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RecordTable({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
  columns: string[];
}) {
  return (
    <div>
      {title && <h3 className="mb-2 text-sm font-semibold">{title}</h3>}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column}>
                  {column.replaceAll("_", " ")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 100).map((row, index) => (
              <TableRow
                key={
                  text(row, "id") ||
                  `${text(row, columns[0] ?? "id")}:${index}`
                }
              >
                {columns.map((column) => (
                  <TableCell key={column} className="max-w-56 truncate">
                    {display(row[column])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-6 text-center text-muted-foreground"
                >
                  No record.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm font-medium">{value}</p>
    </div>
  );
}

function text(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function display(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function date(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}
