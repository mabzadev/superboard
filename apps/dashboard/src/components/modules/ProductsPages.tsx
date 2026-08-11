"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
  X,
} from "lucide-react";
import {
  archiveEntitlement,
  archiveOffering,
  archivePackage,
  archiveProduct,
  createEntitlement,
  createOffering,
  createPackage,
  createProduct,
  createPurchase,
  createRefund,
  getEntitlements,
  getOfferings,
  getPackages,
  getPurchase,
  getProducts,
  getProductStatistics,
  getPurchases,
  getStoreSyncRuns,
  getSubscriptions,
  syncStoreCatalog,
  updateEntitlement,
  updateOffering,
  updatePackage,
  updateProduct,
  updateSubscription,
  type Entitlement,
  type Offering,
  type Product,
  type ProductPackage,
  type ProductStatistics,
  type Purchase,
  type PurchaseDetail,
  type StoreSyncRun,
  type Subscription,
} from "@/api/products/productsService";
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
import { Switch } from "@/components/ui/switch";
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
const asIdentifier = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
const enabled = (value: number | boolean) => value === true || value === 1;
const money = (micros = 0, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    micros / 1_000_000
  );
const dateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
const defaultFrom = () =>
  new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

export function PurchasesPage() {
  const { selectedProject } = useProjectSelection();
  const [items, setItems] = useState<Purchase[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [statistics, setStatistics] = useState<ProductStatistics | null>(null);
  const [purchaseDetail, setPurchaseDetail] = useState<PurchaseDetail>();
  const [filters, setFilters] = useState({
    from: defaultFrom(),
    to: today(),
    status: "",
    customer_id: "",
    product_id: "",
    store: "",
  });
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [store, setStore] = useState("manual");
  const [transactionId, setTransactionId] = useState("");
  const [price, setPrice] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [purchases, catalog, stats, activeSubscriptions] =
        await Promise.all([
          getPurchases(selectedProject.id, {
            status: filters.status,
            customer_id: filters.customer_id.trim(),
            product_id: filters.product_id,
            store: filters.store,
            from: filters.from,
            to: filters.to,
          }),
          getProducts(selectedProject.id),
          getProductStatistics(selectedProject.id, {
            from: filters.from,
            to: filters.to,
            product_id: filters.product_id,
            platform: filters.store,
          }),
          getSubscriptions(selectedProject.id, {
            customer_id: filters.customer_id.trim(),
          }),
        ]);
      setItems(purchases);
      setProducts(catalog);
      setStatistics(stats);
      setSubscriptions(activeSubscriptions);
      setProductId(
        (current) =>
          current || catalog.find((item) => item.status === "active")?.id || ""
      );
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [filters, selectedProject]);

  useEffect(() => void load(), [load]);

  const recordPurchase = async () => {
    if (!selectedProject || !customerId || !productId || !transactionId) return;
    try {
      await createPurchase(selectedProject.id, {
        financial_customer_id: customerId,
        product_id: productId,
        store,
        environment: "sandbox",
        external_transaction_id: transactionId,
        original_transaction_id: transactionId,
        status: "active",
        purchased_at: new Date().toISOString(),
        purchased_price_micros: Math.round(Number(price) * 1_000_000),
        currency: currency.toUpperCase(),
        payload: { source: "dashboard" },
      });
      setTransactionId("");
      showSuccessNotification("Sandbox purchase recorded");
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const refund = async (purchase: Purchase) => {
    if (!selectedProject) return;
    try {
      await createRefund(selectedProject.id, purchase.id, {
        status: "completed",
        amount_micros: purchase.purchased_price_micros,
        currency: purchase.currency,
        reason: "Dashboard refund",
        requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        metadata: { source: "dashboard" },
      });
      showSuccessNotification("Purchase refunded");
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const showPurchase = async (purchaseId: string) => {
    if (!selectedProject) return;
    try {
      setPurchaseDetail(await getPurchase(selectedProject.id, purchaseId));
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const changeSubscription = async (
    subscription: Subscription,
    status: Subscription["status"]
  ) => {
    if (!selectedProject) return;
    try {
      await updateSubscription(selectedProject.id, subscription.id, {
        status,
        current_period_started_at: subscription.current_period_started_at,
        current_period_ends_at: subscription.current_period_ends_at,
        auto_renew: status === "active",
        cancelled_at: status === "cancelled" ? new Date().toISOString() : null,
      });
      showSuccessNotification(
        status === "active" ? "Subscription restored" : "Subscription cancelled"
      );
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const totals = statistics?.totals;
  return (
    <ModulePage
      title="Purchases"
      description="Purchases, subscriptions, restorations, refunds and financial history."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Results stay scoped to the selected project and environment.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <LabeledInput
                label="From"
                type="date"
                value={filters.from}
                onChange={(from) => setFilters((value) => ({ ...value, from }))}
              />
              <LabeledInput
                label="To"
                type="date"
                value={filters.to}
                onChange={(to) => setFilters((value) => ({ ...value, to }))}
              />
              <LabeledInput
                label="Financial customer"
                value={filters.customer_id}
                placeholder="customer_123"
                onChange={(customer_id) =>
                  setFilters((value) => ({ ...value, customer_id }))
                }
              />
              <LabeledSelect
                label="Product"
                value={filters.product_id}
                onChange={(product_id) =>
                  setFilters((value) => ({ ...value, product_id }))
                }
                options={products.map((item) => ({
                  value: item.id,
                  label: item.display_name,
                }))}
                empty="All products"
              />
              <LabeledSelect
                label="Store"
                value={filters.store}
                onChange={(store) =>
                  setFilters((value) => ({ ...value, store }))
                }
                options={["apple", "google", "stripe", "manual"].map(
                  (value) => ({ value, label: value })
                )}
                empty="All stores"
              />
              <LabeledSelect
                label="Status"
                value={filters.status}
                onChange={(status) =>
                  setFilters((value) => ({ ...value, status }))
                }
                options={[
                  "pending",
                  "active",
                  "expired",
                  "cancelled",
                  "refunded",
                  "failed",
                ].map((value) => ({ value, label: value }))}
                empty="All statuses"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Revenue by product and platform</CardTitle>
              <CardDescription>
                Legacy Revenue metrics reassigned to Purchases, calculated
                server-side for the selected period.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <DataTable
                headers={[
                  "Product",
                  "Platform",
                  "Units sold",
                  "First-time purchases",
                  "Total revenue",
                  "Cancellations",
                ]}
                empty="No product revenue in this period."
              >
                {(statistics?.by_product_platform ?? []).map((row) => (
                  <TableRow
                    key={`${row.product_id}:${row.platform}:${row.currency}`}
                  >
                    <TableCell>
                      <b>{row.product_name}</b>
                    </TableCell>
                    <TableCell className="capitalize">
                      {row.platform}
                      <span className="block text-xs text-muted-foreground">
                        {row.store}
                      </span>
                    </TableCell>
                    <TableCell>
                      {Number(row.units_sold).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {Number(row.first_time_purchases).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {money(Number(row.revenue_micros), row.currency || "USD")}
                    </TableCell>
                    <TableCell>
                      {Number(row.cancellations).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Purchases" value={String(totals?.purchases ?? 0)} />
            <Metric
              label="Active subscriptions"
              value={String(totals?.active_subscriptions ?? 0)}
            />
            <Metric
              label="Gross revenue"
              value={money(totals?.gross_revenue_micros)}
            />
            <Metric label="Refunded" value={money(totals?.refunded_micros)} />
            <Metric
              label="Net revenue"
              value={money(totals?.net_revenue_micros)}
            />
            <Metric label="Refunds" value={String(totals?.refunds ?? 0)} />
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Revenue timeline</CardTitle>
                <CardDescription>
                  Daily volume and gross revenue.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh purchases"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw className={loading ? "animate-spin" : ""} />
              </Button>
            </CardHeader>
            <CardContent>
              <DataTable
                headers={["Date", "Purchases", "Revenue"]}
                empty="No financial activity in this period."
              >
                {(statistics?.series ?? []).map((row) => (
                  <TableRow key={row.bucket}>
                    <TableCell>{row.bucket}</TableCell>
                    <TableCell>{row.purchases.toLocaleString()}</TableCell>
                    <TableCell>{money(row.revenue_micros)}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Record sandbox purchase</CardTitle>
                <CardDescription>
                  Validate catalog, entitlement and subscription flows without
                  touching a live store.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="Financial customer ID"
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                />
                <select
                  aria-label="Product"
                  className={selectClass}
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                >
                  <option value="">Select a product</option>
                  {products
                    .filter((item) => item.status === "active")
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.display_name}
                      </option>
                    ))}
                </select>
                <select
                  aria-label="Store"
                  className={selectClass}
                  value={store}
                  onChange={(event) => setStore(event.target.value)}
                >
                  <option value="manual">Manual</option>
                  <option value="apple">Apple</option>
                  <option value="google">Google</option>
                  <option value="stripe">Stripe</option>
                </select>
                <Input
                  placeholder="External transaction ID"
                  value={transactionId}
                  onChange={(event) => setTransactionId(event.target.value)}
                />
                <div className="grid grid-cols-[1fr_90px] gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Price"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                  <Input
                    aria-label="Currency"
                    maxLength={3}
                    value={currency}
                    onChange={(event) =>
                      setCurrency(event.target.value.toUpperCase())
                    }
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={
                    !customerId ||
                    !productId ||
                    !transactionId ||
                    Number(price) < 0
                  }
                  onClick={() => void recordPurchase()}
                >
                  <Plus />
                  Record purchase
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Purchase history</CardTitle>
                <CardDescription>
                  {items.length} matching transactions
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <DataTable
                  headers={[
                    "Product",
                    "Customer",
                    "Store",
                    "Status",
                    "Purchased",
                    "Expires",
                    "Amount",
                    "",
                  ]}
                  empty="No purchases match these filters."
                >
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <b>
                          {item.product_name ||
                            item.product_identifier ||
                            item.product_id}
                        </b>
                        <code className="block max-w-40 truncate text-xs text-muted-foreground">
                          {item.external_transaction_id}
                        </code>
                      </TableCell>
                      <TableCell>{item.external_customer_id}</TableCell>
                      <TableCell className="capitalize">
                        {item.store}
                        <span className="block text-xs text-muted-foreground">
                          {item.environment}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>{dateTime(item.purchased_at)}</TableCell>
                      <TableCell>{dateTime(item.expires_at)}</TableCell>
                      <TableCell>
                        {money(
                          item.purchased_price_micros,
                          item.currency || "USD"
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`View purchase ${item.external_transaction_id}`}
                            onClick={() => void showPurchase(item.id)}
                          >
                            <Eye />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={item.status === "refunded"}
                            onClick={() => void refund(item)}
                          >
                            <RotateCcw />
                            Refund
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </DataTable>
              </CardContent>
            </Card>
          </div>

          {purchaseDetail && (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Purchase detail</CardTitle>
                  <CardDescription>
                    {purchaseDetail.external_transaction_id} ·{" "}
                    {purchaseDetail.external_customer_id}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close purchase detail"
                  onClick={() => setPurchaseDetail(undefined)}
                >
                  <X />
                </Button>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Granted entitlements
                  </p>
                  <div className="space-y-2">
                    {purchaseDetail.entitlements.map((item) => (
                      <div key={item.id} className="rounded-md border p-3">
                        <b>{item.display_name}</b>
                        <code className="ml-2 text-xs text-muted-foreground">
                          {item.identifier}
                        </code>
                      </div>
                    ))}
                    {!purchaseDetail.entitlements.length && (
                      <p className="text-sm text-muted-foreground">
                        No entitlement was granted.
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">Refund history</p>
                  <div className="space-y-2">
                    {purchaseDetail.refunds.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-md border p-3"
                      >
                        <span>
                          <StatusBadge status={item.status} />
                          <span className="ml-2 text-xs text-muted-foreground">
                            {item.reason || "No reason"}
                          </span>
                        </span>
                        <b>
                          {money(
                            item.amount_micros,
                            item.currency || purchaseDetail.currency || "USD"
                          )}
                        </b>
                      </div>
                    ))}
                    {!purchaseDetail.refunds.length && (
                      <p className="text-sm text-muted-foreground">
                        No refunds recorded.
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Subscriptions</CardTitle>
              <CardDescription>
                Current periods, renewals, cancellation and restoration state.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <DataTable
                headers={[
                  "Product",
                  "Customer",
                  "Status",
                  "Period end",
                  "Renewal",
                  "Updated",
                  "",
                ]}
                empty="No subscriptions match this customer."
              >
                {subscriptions.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.product_name ||
                        item.product_identifier ||
                        item.product_id}
                    </TableCell>
                    <TableCell>{item.external_customer_id}</TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell>
                      {dateTime(item.current_period_ends_at)}
                    </TableCell>
                    <TableCell>
                      {enabled(item.auto_renew) ? "Auto-renew" : "Off"}
                    </TableCell>
                    <TableCell>{dateTime(item.updated_at)}</TableCell>
                    <TableCell>
                      {item.status === "cancelled" ||
                      item.status === "expired" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void changeSubscription(item, "active")
                          }
                        >
                          <RotateCcw />
                          Restore
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void changeSubscription(item, "cancelled")
                          }
                        >
                          <X />
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

type ProductForm = {
  identifier: string;
  name: string;
  description: string;
  type: Product["product_type"];
  status: Product["status"];
};
type PackageForm = {
  identifier: string;
  name: string;
  description: string;
  productId: string;
  position: number;
  active: boolean;
};
type OfferingForm = {
  identifier: string;
  name: string;
  description: string;
  placement: string;
  priority: number;
  packageIds: string[];
  active: boolean;
};
const emptyProduct = (): ProductForm => ({
  identifier: "",
  name: "",
  description: "",
  type: "subscription",
  status: "active",
});
const emptyPackage = (): PackageForm => ({
  identifier: "",
  name: "",
  description: "",
  productId: "",
  position: 0,
  active: true,
});
const emptyOffering = (): OfferingForm => ({
  identifier: "",
  name: "",
  description: "",
  placement: "default",
  priority: 100,
  packageIds: [],
  active: true,
});

export function OfferingsPage() {
  const { selectedProject } = useProjectSelection();
  const [products, setProducts] = useState<Product[]>([]);
  const [packages, setPackages] = useState<ProductPackage[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [syncRuns, setSyncRuns] = useState<StoreSyncRun[]>([]);
  const [productForm, setProductForm] = useState<ProductForm>(emptyProduct);
  const [packageForm, setPackageForm] = useState<PackageForm>(emptyPackage);
  const [offeringForm, setOfferingForm] = useState<OfferingForm>(emptyOffering);
  const [editing, setEditing] = useState<{
    kind: "product" | "package" | "offering";
    id: string;
  }>();
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<"all" | "active" | "archived">(
    "all"
  );
  const [syncJson, setSyncJson] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [catalog, configuredPackages, configuredOfferings, runs] =
        await Promise.all([
          getProducts(selectedProject.id),
          getPackages(selectedProject.id),
          getOfferings(selectedProject.id),
          getStoreSyncRuns(selectedProject.id),
        ]);
      setProducts(catalog);
      setPackages(configuredPackages);
      setOfferings(configuredOfferings);
      setSyncRuns(runs);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);

  const run = async (
    action: () => Promise<unknown>,
    success: string,
    reset?: () => void
  ) => {
    try {
      await action();
      reset?.();
      setEditing(undefined);
      showSuccessNotification(success);
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };
  const saveProduct = () =>
    selectedProject &&
    run(
      () =>
        editing?.kind === "product"
          ? updateProduct(selectedProject.id, editing.id, {
              identifier: productForm.identifier,
              display_name: productForm.name,
              description: productForm.description || null,
              product_type: productForm.type,
              status: productForm.status,
            })
          : createProduct(selectedProject.id, {
              identifier: productForm.identifier,
              display_name: productForm.name,
              description: productForm.description || null,
              product_type: productForm.type,
              status: productForm.status,
            }),
      editing ? "Product updated" : "Product created",
      () => setProductForm(emptyProduct())
    );
  const savePackage = () =>
    selectedProject &&
    run(
      () =>
        editing?.kind === "package"
          ? updatePackage(selectedProject.id, editing.id, {
              identifier: packageForm.identifier,
              display_name: packageForm.name,
              description: packageForm.description || null,
              product_id: packageForm.productId || null,
              position: packageForm.position,
              active: packageForm.active,
            })
          : createPackage(selectedProject.id, {
              identifier: packageForm.identifier,
              display_name: packageForm.name,
              description: packageForm.description || null,
              product_id: packageForm.productId || null,
              position: packageForm.position,
              active: packageForm.active,
            }),
      editing ? "Package updated" : "Package created",
      () => setPackageForm(emptyPackage())
    );
  const saveOffering = () =>
    selectedProject &&
    run(
      () =>
        editing?.kind === "offering"
          ? updateOffering(selectedProject.id, editing.id, {
              identifier: offeringForm.identifier,
              display_name: offeringForm.name,
              description: offeringForm.description || null,
              placement: offeringForm.placement,
              priority: offeringForm.priority,
              active: offeringForm.active,
              package_ids: offeringForm.packageIds,
            })
          : createOffering(selectedProject.id, {
              identifier: offeringForm.identifier,
              display_name: offeringForm.name,
              description: offeringForm.description || null,
              placement: offeringForm.placement,
              priority: offeringForm.priority,
              active: offeringForm.active,
              package_ids: offeringForm.packageIds,
            }),
      editing ? "Offering updated" : "Offering created",
      () => setOfferingForm(emptyOffering())
    );
  const startProductEdit = (item: Product) => {
    setEditing({ kind: "product", id: item.id });
    setProductForm({
      identifier: item.identifier,
      name: item.display_name,
      description: item.description || "",
      type: item.product_type,
      status: item.status,
    });
  };
  const startPackageEdit = (item: ProductPackage) => {
    setEditing({ kind: "package", id: item.id });
    setPackageForm({
      identifier: item.identifier,
      name: item.display_name,
      description: item.description || "",
      productId: item.product_id || "",
      position: item.position,
      active: enabled(item.active),
    });
  };
  const startOfferingEdit = (item: Offering) => {
    setEditing({ kind: "offering", id: item.id });
    setOfferingForm({
      identifier: item.identifier,
      name: item.display_name,
      description: item.description || "",
      placement: item.placement,
      priority: item.priority,
      packageIds: item.package_ids || item.packages?.map(({ id }) => id) || [],
      active: enabled(item.active),
    });
  };
  const cancelEdit = () => {
    setEditing(undefined);
    setProductForm(emptyProduct());
    setPackageForm(emptyPackage());
    setOfferingForm(emptyOffering());
  };
  const sync = async () => {
    if (!selectedProject) return;
    try {
      const parsed = JSON.parse(syncJson) as {
        store?: string;
        environment?: string;
        complete_catalog?: boolean;
        products?: unknown[];
      };
      await syncStoreCatalog(selectedProject.id, {
        store: parsed.store || "manual",
        environment: parsed.environment || "sandbox",
        complete_catalog: Boolean(parsed.complete_catalog),
        products: parsed.products || [],
      });
      showSuccessNotification("Store catalog synchronized");
      setSyncJson("");
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof SyntaxError
          ? "Catalog must be valid JSON."
          : moduleErrorMessage(cause)
      );
    }
  };
  const matches = (title: string, identifier: string, active: boolean) => {
    const queryMatch = `${title} ${identifier}`
      .toLowerCase()
      .includes(search.toLowerCase());
    return (
      queryMatch &&
      (visibility === "all" || (visibility === "active" ? active : !active))
    );
  };
  const visibleProducts = products.filter((item) =>
    matches(item.display_name, item.identifier, item.status !== "archived")
  );
  const visiblePackages = packages.filter((item) =>
    matches(item.display_name, item.identifier, enabled(item.active))
  );
  const visibleOfferings = offerings.filter((item) =>
    matches(item.display_name, item.identifier, enabled(item.active))
  );

  return (
    <ModulePage
      title="Offerings"
      description="Manage the store catalog, packages and SDK-resolved offerings."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="flex flex-wrap gap-3 pt-6">
              <div className="relative min-w-64 flex-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search catalog"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <select
                aria-label="Catalog status"
                className={`${selectClass} w-40`}
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as typeof visibility)
                }
              >
                <option value="all">All states</option>
                <option value="active">Active</option>
                <option value="archived">Inactive</option>
              </select>
              {editing && (
                <Button variant="outline" onClick={cancelEdit}>
                  <X />
                  Cancel editing
                </Button>
              )}
            </CardContent>
          </Card>
          <div className="grid gap-6 xl:grid-cols-3">
            <EditorCard
              title={
                editing?.kind === "product" ? "Edit product" : "Create product"
              }
              description="A purchasable catalog item"
            >
              <Input
                placeholder="Identifier"
                value={productForm.identifier}
                onChange={(event) =>
                  setProductForm((value) => ({
                    ...value,
                    identifier: asIdentifier(event.target.value),
                  }))
                }
              />
              <Input
                placeholder="Display name"
                value={productForm.name}
                onChange={(event) =>
                  setProductForm((value) => ({
                    ...value,
                    name: event.target.value,
                  }))
                }
              />
              <Input
                placeholder="Description"
                value={productForm.description}
                onChange={(event) =>
                  setProductForm((value) => ({
                    ...value,
                    description: event.target.value,
                  }))
                }
              />
              <select
                aria-label="Product type"
                className={selectClass}
                value={productForm.type}
                onChange={(event) =>
                  setProductForm((value) => ({
                    ...value,
                    type: event.target.value as Product["product_type"],
                  }))
                }
              >
                <option value="subscription">Subscription</option>
                <option value="non_consumable">Non-consumable</option>
                <option value="consumable">Consumable</option>
              </select>
              <select
                aria-label="Product status"
                className={selectClass}
                value={productForm.status}
                onChange={(event) =>
                  setProductForm((value) => ({
                    ...value,
                    status: event.target.value as Product["status"],
                  }))
                }
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
              <Button
                className="w-full"
                disabled={
                  (editing != null && editing.kind !== "product") ||
                  !productForm.identifier ||
                  !productForm.name
                }
                onClick={() => void saveProduct()}
              >
                {editing?.kind === "product" ? <Check /> : <Plus />}
                {editing?.kind === "product"
                  ? "Save product"
                  : "Create product"}
              </Button>
            </EditorCard>
            <EditorCard
              title={
                editing?.kind === "package" ? "Edit package" : "Create package"
              }
              description="Connect a product to an offering"
            >
              <Input
                placeholder="Identifier"
                value={packageForm.identifier}
                onChange={(event) =>
                  setPackageForm((value) => ({
                    ...value,
                    identifier: asIdentifier(event.target.value),
                  }))
                }
              />
              <Input
                placeholder="Display name"
                value={packageForm.name}
                onChange={(event) =>
                  setPackageForm((value) => ({
                    ...value,
                    name: event.target.value,
                  }))
                }
              />
              <Input
                placeholder="Description"
                value={packageForm.description}
                onChange={(event) =>
                  setPackageForm((value) => ({
                    ...value,
                    description: event.target.value,
                  }))
                }
              />
              <select
                aria-label="Package product"
                className={selectClass}
                value={packageForm.productId}
                onChange={(event) =>
                  setPackageForm((value) => ({
                    ...value,
                    productId: event.target.value,
                  }))
                }
              >
                <option value="">No product</option>
                {products
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.display_name}
                    </option>
                  ))}
              </select>
              <Input
                aria-label="Package position"
                type="number"
                min="0"
                value={packageForm.position}
                onChange={(event) =>
                  setPackageForm((value) => ({
                    ...value,
                    position: Number(event.target.value),
                  }))
                }
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={packageForm.active}
                  onCheckedChange={(active) =>
                    setPackageForm((value) => ({ ...value, active }))
                  }
                />
                Active
              </label>
              <Button
                className="w-full"
                disabled={
                  (editing != null && editing.kind !== "package") ||
                  !packageForm.identifier ||
                  !packageForm.name
                }
                onClick={() => void savePackage()}
              >
                {editing?.kind === "package" ? <Check /> : <Plus />}
                {editing?.kind === "package"
                  ? "Save package"
                  : "Create package"}
              </Button>
            </EditorCard>
            <EditorCard
              title={
                editing?.kind === "offering"
                  ? "Edit offering"
                  : "Create offering"
              }
              description="Resolve packages for an SDK placement"
            >
              <Input
                placeholder="Identifier"
                value={offeringForm.identifier}
                onChange={(event) =>
                  setOfferingForm((value) => ({
                    ...value,
                    identifier: asIdentifier(event.target.value),
                  }))
                }
              />
              <Input
                placeholder="Display name"
                value={offeringForm.name}
                onChange={(event) =>
                  setOfferingForm((value) => ({
                    ...value,
                    name: event.target.value,
                  }))
                }
              />
              <Input
                placeholder="Description"
                value={offeringForm.description}
                onChange={(event) =>
                  setOfferingForm((value) => ({
                    ...value,
                    description: event.target.value,
                  }))
                }
              />
              <Input
                placeholder="Placement"
                value={offeringForm.placement}
                onChange={(event) =>
                  setOfferingForm((value) => ({
                    ...value,
                    placement: asIdentifier(event.target.value),
                  }))
                }
              />
              <Input
                aria-label="Offering priority"
                type="number"
                min="0"
                value={offeringForm.priority}
                onChange={(event) =>
                  setOfferingForm((value) => ({
                    ...value,
                    priority: Number(event.target.value),
                  }))
                }
              />
              <div className="max-h-32 space-y-2 overflow-auto rounded-md border p-3">
                {packages
                  .filter((item) => enabled(item.active))
                  .map((item) => (
                    <label
                      key={item.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={offeringForm.packageIds.includes(item.id)}
                        onChange={(event) =>
                          setOfferingForm((value) => ({
                            ...value,
                            packageIds: event.target.checked
                              ? [...value.packageIds, item.id]
                              : value.packageIds.filter((id) => id !== item.id),
                          }))
                        }
                      />
                      {item.display_name}
                    </label>
                  ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={offeringForm.active}
                  onCheckedChange={(active) =>
                    setOfferingForm((value) => ({ ...value, active }))
                  }
                />
                Active
              </label>
              <Button
                className="w-full"
                disabled={
                  (editing != null && editing.kind !== "offering") ||
                  !offeringForm.identifier ||
                  !offeringForm.name ||
                  !offeringForm.placement
                }
                onClick={() => void saveOffering()}
              >
                {editing?.kind === "offering" ? <Check /> : <Plus />}
                {editing?.kind === "offering"
                  ? "Save offering"
                  : "Create offering"}
              </Button>
            </EditorCard>
          </div>
          <CatalogTable
            title="Products"
            headers={["Name", "Identifier", "Type", "State", ""]}
            empty="No products match the filters."
          >
            {visibleProducts.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <b>{item.display_name}</b>
                  <span className="block text-xs text-muted-foreground">
                    {item.description || "No description"}
                  </span>
                </TableCell>
                <TableCell>
                  <code>{item.identifier}</code>
                </TableCell>
                <TableCell className="capitalize">
                  {item.product_type.replaceAll("_", " ")}
                </TableCell>
                <TableCell>
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell>
                  <RowActions
                    onEdit={() => startProductEdit(item)}
                    onArchive={
                      item.status !== "archived"
                        ? () =>
                            selectedProject &&
                            void run(
                              () => archiveProduct(selectedProject.id, item.id),
                              "Product archived"
                            )
                        : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </CatalogTable>
          <CatalogTable
            title="Packages"
            headers={["Name", "Identifier", "Product", "Position", "State", ""]}
            empty="No packages match the filters."
          >
            {visiblePackages.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <b>{item.display_name}</b>
                  <span className="block text-xs text-muted-foreground">
                    {item.description || "No description"}
                  </span>
                </TableCell>
                <TableCell>
                  <code>{item.identifier}</code>
                </TableCell>
                <TableCell>{item.product_identifier || "Unlinked"}</TableCell>
                <TableCell>{item.position}</TableCell>
                <TableCell>
                  <StatusBadge
                    status={enabled(item.active) ? "active" : "archived"}
                  />
                </TableCell>
                <TableCell>
                  <RowActions
                    onEdit={() => startPackageEdit(item)}
                    onArchive={
                      enabled(item.active)
                        ? () =>
                            selectedProject &&
                            void run(
                              () => archivePackage(selectedProject.id, item.id),
                              "Package archived"
                            )
                        : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </CatalogTable>
          <CatalogTable
            title="Offerings"
            headers={[
              "Name",
              "Identifier",
              "Placement",
              "Priority",
              "Packages",
              "State",
              "",
            ]}
            empty="No offerings match the filters."
          >
            {visibleOfferings.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <b>{item.display_name}</b>
                  <span className="block text-xs text-muted-foreground">
                    {item.description || "No description"}
                  </span>
                </TableCell>
                <TableCell>
                  <code>{item.identifier}</code>
                </TableCell>
                <TableCell>{item.placement}</TableCell>
                <TableCell>{item.priority}</TableCell>
                <TableCell>
                  {item.package_ids?.length || item.packages?.length || 0}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    status={enabled(item.active) ? "active" : "archived"}
                  />
                </TableCell>
                <TableCell>
                  <RowActions
                    onEdit={() => startOfferingEdit(item)}
                    onArchive={
                      enabled(item.active)
                        ? () =>
                            selectedProject &&
                            void run(
                              () =>
                                archiveOffering(selectedProject.id, item.id),
                              "Offering archived"
                            )
                        : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </CatalogTable>
          <Card>
            <CardHeader>
              <CardTitle>Store catalog synchronization</CardTitle>
              <CardDescription>
                Import Apple, Google, Stripe or manual products. A complete
                catalog deactivates products missing from the payload.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                aria-label="Store catalog JSON"
                className="min-h-36 w-full rounded-md border bg-background p-3 font-mono text-xs"
                placeholder={
                  '{"store":"apple","environment":"sandbox","complete_catalog":false,"products":[]}'
                }
                value={syncJson}
                onChange={(event) => setSyncJson(event.target.value)}
              />
              <Button disabled={!syncJson} onClick={() => void sync()}>
                <Upload />
                Synchronize catalog
              </Button>
              <DataTable
                headers={[
                  "Started",
                  "Store",
                  "Environment",
                  "Status",
                  "Imported",
                  "Deactivated",
                ]}
                empty="No catalog synchronization yet."
              >
                {syncRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{dateTime(run.started_at)}</TableCell>
                    <TableCell className="capitalize">{run.store}</TableCell>
                    <TableCell>{run.environment}</TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>{run.imported_count}</TableCell>
                    <TableCell>{run.deactivated_count}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

export function EntitlementsPage() {
  const { selectedProject } = useProjectSelection();
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<Entitlement[]>([]);
  const [form, setForm] = useState({
    identifier: "",
    name: "",
    description: "",
    productIds: [] as string[],
    active: true,
  });
  const [editingId, setEditingId] = useState<string>();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"all" | "active" | "archived">("all");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [catalog, entitlements] = await Promise.all([
        getProducts(selectedProject.id),
        getEntitlements(selectedProject.id),
      ]);
      setProducts(catalog);
      setItems(entitlements);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);
  const reset = () => {
    setEditingId(undefined);
    setForm({
      identifier: "",
      name: "",
      description: "",
      productIds: [],
      active: true,
    });
  };
  const save = async () => {
    if (!selectedProject) return;
    try {
      const payload = {
        identifier: form.identifier,
        display_name: form.name,
        description: form.description || null,
        active: form.active,
        product_ids: form.productIds,
      };
      if (editingId)
        await updateEntitlement(selectedProject.id, editingId, payload);
      else await createEntitlement(selectedProject.id, payload);
      showSuccessNotification(
        editingId ? "Entitlement updated" : "Entitlement created"
      );
      reset();
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };
  const edit = (item: Entitlement) => {
    setEditingId(item.id);
    setForm({
      identifier: item.identifier,
      name: item.display_name,
      description: item.description || "",
      productIds: item.product_ids || item.products?.map(({ id }) => id) || [],
      active: enabled(item.active),
    });
  };
  const productNames = useMemo(
    () => new Map(products.map((item) => [item.id, item.display_name])),
    [products]
  );
  const visible = items.filter((item) => {
    const active = enabled(item.active);
    return (
      `${item.display_name} ${item.identifier}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (state === "all" || (state === "active" ? active : !active))
    );
  });
  return (
    <ModulePage
      title="Entitlements"
      description="Define SDK access rights and the products that unlock each right."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingId ? "Edit entitlement" : "Create entitlement"}
              </CardTitle>
              <CardDescription>
                Identifiers are stable public keys exposed to the SDK.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Identifier"
                value={form.identifier}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    identifier: asIdentifier(event.target.value),
                  }))
                }
              />
              <Input
                placeholder="Display name"
                value={form.name}
                onChange={(event) =>
                  setForm((value) => ({ ...value, name: event.target.value }))
                }
              />
              <Input
                placeholder="Description"
                value={form.description}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    description: event.target.value,
                  }))
                }
              />
              <div className="max-h-64 space-y-2 overflow-auto rounded-md border p-3">
                {products
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <label
                      key={item.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={form.productIds.includes(item.id)}
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            productIds: event.target.checked
                              ? [...value.productIds, item.id]
                              : value.productIds.filter((id) => id !== item.id),
                          }))
                        }
                      />
                      {item.display_name}
                    </label>
                  ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.active}
                  onCheckedChange={(active) =>
                    setForm((value) => ({ ...value, active }))
                  }
                />
                Active
              </label>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={!form.identifier || !form.name}
                  onClick={() => void save()}
                >
                  {editingId ? <Check /> : <Plus />}
                  {editingId ? "Save entitlement" : "Create entitlement"}
                </Button>
                {editingId && (
                  <Button variant="outline" onClick={reset}>
                    <X />
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Configured entitlements</CardTitle>
              <CardDescription>
                {visible.length} matching rights
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search entitlements"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <select
                  aria-label="Entitlement status"
                  className={`${selectClass} w-36`}
                  value={state}
                  onChange={(event) =>
                    setState(event.target.value as typeof state)
                  }
                >
                  <option value="all">All states</option>
                  <option value="active">Active</option>
                  <option value="archived">Inactive</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <DataTable
                  headers={["Name", "Identifier", "Products", "State", ""]}
                  empty="No entitlements match the filters."
                >
                  {visible.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <b>{item.display_name}</b>
                        <span className="block text-xs text-muted-foreground">
                          {item.description || "No description"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <code>{item.identifier}</code>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-72 flex-wrap gap-1">
                          {(
                            item.product_ids ||
                            item.products?.map(({ id }) => id) ||
                            []
                          ).map((id) => (
                            <Badge key={id} variant="outline">
                              {productNames.get(id) || id}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={enabled(item.active) ? "active" : "archived"}
                        />
                      </TableCell>
                      <TableCell>
                        <RowActions
                          onEdit={() => edit(item)}
                          onArchive={
                            enabled(item.active)
                              ? () =>
                                  void archiveEntitlement(
                                    selectedProject.id,
                                    item.id
                                  )
                                    .then(() => {
                                      showSuccessNotification(
                                        "Entitlement archived"
                                      );
                                      return load();
                                    })
                                    .catch((cause) =>
                                      showErrorNotification(
                                        moduleErrorMessage(cause)
                                      )
                                    )
                              : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </DataTable>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
function EditorCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
function CatalogTable({
  title,
  headers,
  empty,
  children,
}: {
  title: string;
  headers: string[];
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <DataTable headers={headers} empty={empty}>
          {children}
        </DataTable>
      </CardContent>
    </Card>
  );
}
function DataTable({
  headers,
  empty,
  children,
}: {
  headers: string[];
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((header, index) => (
            <TableHead key={`${header}:${index}`}>{header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {hasChildren ? (
          children
        ) : (
          <TableRow>
            <TableCell
              colSpan={headers.length}
              className="py-10 text-center text-muted-foreground"
            >
              {empty}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
function StatusBadge({ status }: { status: string }) {
  const destructive = [
    "failed",
    "refunded",
    "cancelled",
    "expired",
    "archived",
  ].includes(status);
  const positive = ["active", "succeeded", "trialing", "grace_period"].includes(
    status
  );
  return (
    <Badge
      variant={destructive ? "destructive" : positive ? "default" : "outline"}
      className="capitalize"
    >
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
function RowActions({
  onEdit,
  onArchive,
}: {
  onEdit: () => void;
  onArchive?: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" aria-label="Edit" onClick={onEdit}>
        <Pencil />
      </Button>
      {onArchive && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Archive"
          onClick={onArchive}
        >
          <Archive />
        </Button>
      )}
    </div>
  );
}
function LabeledInput({
  label,
  value,
  onChange,
  ...props
}: { label: string; value: string; onChange: (value: string) => void } & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange"
>) {
  return (
    <label className="space-y-1 text-xs">
      {label}
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </label>
  );
}
function LabeledSelect({
  label,
  value,
  onChange,
  options,
  empty,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  empty: string;
}) {
  return (
    <label className="space-y-1 text-xs">
      {label}
      <select
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{empty}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
