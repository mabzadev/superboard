import { DELETE as DELETE_REQUEST, GET, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

const projectPath = (projectRef: string, resource = "") =>
  `${config.apiPath}/products/projects/${projectRef}${resource}`;

const unwrap = <T>(response: { data: T | { data: T } }): T =>
  response.data && typeof response.data === "object" && "data" in response.data
    ? (response.data as { data: T }).data
    : (response.data as T);

export type Product = {
  id: string;
  identifier: string;
  display_name: string;
  description: string | null;
  product_type: "subscription" | "non_consumable" | "consumable";
  status: "draft" | "active" | "archived";
};

export type ProductPackage = {
  id: string;
  identifier: string;
  display_name: string;
  description: string | null;
  product_id: string | null;
  product_identifier?: string | null;
  position: number;
  active: number | boolean;
};

export type Offering = {
  id: string;
  identifier: string;
  display_name: string;
  description: string | null;
  placement: string;
  priority: number;
  active: number | boolean;
  package_ids: string[];
  packages?: ProductPackage[];
};

export type Entitlement = {
  id: string;
  identifier: string;
  display_name: string;
  description: string | null;
  active: number | boolean;
  product_ids: string[];
  products?: Product[];
};

export type Purchase = {
  id: string;
  external_customer_id: string;
  product_id: string;
  product_identifier?: string | null;
  product_name?: string | null;
  store: string;
  environment: string;
  external_transaction_id: string;
  status: string;
  purchased_at: string;
  expires_at?: string | null;
  purchased_price_micros: number;
  currency?: string | null;
};

export type Refund = {
  id: string;
  purchase_id: string;
  external_refund_id?: string | null;
  status: "requested" | "processing" | "completed" | "rejected" | "cancelled";
  amount_micros: number;
  currency?: string | null;
  reason?: string | null;
  requested_at: string;
  completed_at?: string | null;
};

export type PurchaseDetail = Purchase & {
  entitlements: Entitlement[];
  refunds: Refund[];
};

export type Subscription = {
  id: string;
  external_customer_id: string;
  product_id: string;
  product_identifier?: string | null;
  product_name?: string | null;
  store: string;
  environment: string;
  original_transaction_id: string;
  status:
    | "trialing"
    | "active"
    | "grace_period"
    | "paused"
    | "cancelled"
    | "expired"
    | "refunded";
  current_period_started_at?: string | null;
  current_period_ends_at?: string | null;
  auto_renew: number | boolean;
  cancelled_at?: string | null;
  updated_at?: string;
};

export type StoreSyncRun = {
  id: string;
  store: string;
  environment: string;
  status: string;
  imported_count: number;
  deactivated_count: number;
  started_at: string;
  completed_at?: string | null;
};

export type PurchaseFilters = {
  status?: string;
  customer_id?: string;
  product_id?: string;
  store?: string;
  platform?: string;
  from?: string;
  to?: string;
};

export type ProductStatistics = {
  totals: {
    purchases: number;
    gross_revenue_micros: number;
    refunds: number;
    refunded_micros: number;
    net_revenue_micros: number;
    active_subscriptions: number;
  };
  by_status: Array<{ status: string; count: number }>;
  series: Array<{ bucket: string; purchases: number; revenue_micros: number }>;
  by_product_platform: Array<{
    product_id: string;
    product_name: string;
    platform: string;
    store: string;
    units_sold: number;
    first_time_purchases: number;
    revenue_micros: number;
    currency: string;
    cancellations: number;
  }>;
};

export async function getProducts(projectRef: string) {
  return unwrap<Product[]>(
    await GET(projectPath(projectRef, "/catalog/products"))
  );
}
export async function createProduct(
  projectRef: string,
  input: Omit<Product, "id">
) {
  return unwrap<Product>(
    await POST(projectPath(projectRef, "/catalog/products"), input)
  );
}
export async function updateProduct(
  projectRef: string,
  id: string,
  input: Omit<Product, "id">
) {
  return unwrap<Product>(
    await PUT(projectPath(projectRef, `/catalog/products/${id}`), input)
  );
}
export async function archiveProduct(projectRef: string, id: string) {
  return unwrap(
    await DELETE_REQUEST(projectPath(projectRef, `/catalog/products/${id}`))
  );
}
export async function getPackages(projectRef: string) {
  return unwrap<ProductPackage[]>(
    await GET(projectPath(projectRef, "/packages"))
  );
}
export async function createPackage(
  projectRef: string,
  input: Omit<ProductPackage, "id" | "product_identifier">
) {
  return unwrap<ProductPackage>(
    await POST(projectPath(projectRef, "/packages"), input)
  );
}
export async function updatePackage(
  projectRef: string,
  id: string,
  input: Omit<ProductPackage, "id" | "product_identifier">
) {
  return unwrap<ProductPackage>(
    await PUT(projectPath(projectRef, `/packages/${id}`), input)
  );
}
export async function archivePackage(projectRef: string, id: string) {
  return unwrap(
    await DELETE_REQUEST(projectPath(projectRef, `/packages/${id}`))
  );
}
export async function getOfferings(projectRef: string) {
  return unwrap<Offering[]>(await GET(projectPath(projectRef, "/offerings")));
}
export async function createOffering(
  projectRef: string,
  input: Omit<Offering, "id" | "packages">
) {
  return unwrap<Offering>(
    await POST(projectPath(projectRef, "/offerings"), input)
  );
}
export async function updateOffering(
  projectRef: string,
  id: string,
  input: Omit<Offering, "id" | "packages">
) {
  return unwrap<Offering>(
    await PUT(projectPath(projectRef, `/offerings/${id}`), input)
  );
}
export async function archiveOffering(projectRef: string, id: string) {
  return unwrap(
    await DELETE_REQUEST(projectPath(projectRef, `/offerings/${id}`))
  );
}
export async function getEntitlements(projectRef: string) {
  return unwrap<Entitlement[]>(
    await GET(projectPath(projectRef, "/entitlements"))
  );
}
export async function createEntitlement(
  projectRef: string,
  input: Omit<Entitlement, "id" | "products">
) {
  return unwrap<Entitlement>(
    await POST(projectPath(projectRef, "/entitlements"), input)
  );
}
export async function updateEntitlement(
  projectRef: string,
  id: string,
  input: Omit<Entitlement, "id" | "products">
) {
  return unwrap<Entitlement>(
    await PUT(projectPath(projectRef, `/entitlements/${id}`), input)
  );
}
export async function archiveEntitlement(projectRef: string, id: string) {
  return unwrap(
    await DELETE_REQUEST(projectPath(projectRef, `/entitlements/${id}`))
  );
}
export function productQuery(filters: Record<string, string | undefined>) {
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1])
    )
  ).toString();
  return query ? `?${query}` : "";
}
export async function getPurchases(
  projectRef: string,
  filters: PurchaseFilters | string = {}
) {
  const query = typeof filters === "string" ? filters : productQuery(filters);
  return unwrap<Purchase[]>(
    await GET(`${projectPath(projectRef, "/purchases")}${query}`)
  );
}
export async function createPurchase(
  projectRef: string,
  input: Record<string, unknown>
) {
  return unwrap<Purchase>(
    await POST(projectPath(projectRef, "/purchases"), input)
  );
}
export async function getPurchase(projectRef: string, purchaseId: string) {
  return unwrap<PurchaseDetail>(
    await GET(projectPath(projectRef, `/purchases/${purchaseId}`))
  );
}
export async function createRefund(
  projectRef: string,
  purchaseId: string,
  input: Record<string, unknown>
) {
  return unwrap(
    await POST(
      projectPath(projectRef, `/purchases/${purchaseId}/refunds`),
      input
    )
  );
}
export async function getRefunds(projectRef: string) {
  return unwrap<Refund[]>(await GET(projectPath(projectRef, "/refunds")));
}
export async function updateRefund(
  projectRef: string,
  refundId: string,
  input: Omit<Refund, "id" | "purchase_id">
) {
  return unwrap<Refund>(
    await PUT(projectPath(projectRef, `/refunds/${refundId}`), input)
  );
}
export async function getFinancialCustomerEntitlements(
  projectRef: string,
  customerId: string
) {
  return unwrap<{
    customer: { id: string; external_customer_id: string };
    entitlements: Array<
      Entitlement & { expires_at?: string | null; purchase_id: string }
    >;
  }>(
    await GET(
      projectPath(
        projectRef,
        `/customers/${encodeURIComponent(customerId)}/entitlements`
      )
    )
  );
}
export async function getSubscriptions(
  projectRef: string,
  filters: Pick<PurchaseFilters, "status" | "customer_id"> = {}
) {
  return unwrap<Subscription[]>(
    await GET(
      `${projectPath(projectRef, "/subscriptions")}${productQuery(filters)}`
    )
  );
}
export async function updateSubscription(
  projectRef: string,
  id: string,
  input: Pick<
    Subscription,
    | "status"
    | "current_period_started_at"
    | "current_period_ends_at"
    | "auto_renew"
    | "cancelled_at"
  >
) {
  return unwrap<Subscription>(
    await PUT(projectPath(projectRef, `/subscriptions/${id}`), input)
  );
}
export async function getProductStatistics(
  projectRef: string,
  filters: {
    from?: string;
    to?: string;
    product_id?: string;
    platform?: string;
  } = {}
) {
  return unwrap<ProductStatistics>(
    await GET(
      `${projectPath(projectRef, "/statistics")}${productQuery(filters)}`
    )
  );
}
export async function syncStoreCatalog(
  projectRef: string,
  input: Record<string, unknown>
) {
  return unwrap<{
    id: string;
    imported_count: number;
    deactivated_count: number;
  }>(await POST(projectPath(projectRef, "/catalog/sync"), input));
}
export async function getStoreSyncRuns(projectRef: string) {
  return unwrap<StoreSyncRun[]>(
    await GET(projectPath(projectRef, "/catalog/syncs"))
  );
}
