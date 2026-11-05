import { config } from "@superboard/front-ui/lib/config.js";

import { GET, POST, PUT } from "../../transport.js";

const projectPath = (projectRef: string, resource = "") =>
	`${config.apiPath}/billing/projects/${projectRef}/ledger${resource}`;

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

export type Entitlement = {
	id: string;
	identifier: string;
	display_name: string;
	description: string | null;
	active: number | boolean;
	product_ids: string[];
	products?: Product[];
	created_at?: string;
	updated_at?: string;
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
	usd_price_micros?: number | null;
	usd_rate_date?: string | null;
	display_currency?: string;
	display_price_micros?: number | null;
};

export type Refund = {
	id: string;
	purchase_id: string;
	external_refund_id?: string | null;
	status: "requested" | "processing" | "completed" | "rejected" | "cancelled";
	amount_micros: number;
	currency?: string | null;
	usd_amount_micros?: number | null;
	usd_rate_date?: string | null;
	display_currency?: string;
	display_amount_micros?: number | null;
	reason?: string | null;
	requested_at: string;
	completed_at?: string | null;
};

export type PurchaseDetail = Purchase & {
	usd_rate_source?: string | null;
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
	status: "trialing" | "active" | "grace_period" | "paused" | "cancelled" | "expired" | "refunded";
	current_period_started_at?: string | null;
	current_period_ends_at?: string | null;
	auto_renew: number | boolean;
	cancelled_at?: string | null;
	updated_at?: string;
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
	totals_by_currency?: Array<{
		currency: string | null;
		purchases: number;
		gross_revenue_micros: number;
		refunds: number;
		refunded_micros: number;
		net_revenue_micros: number;
	}>;
	by_status: Array<{ status: string; count: number }>;
	series: Array<{ bucket: string; purchases: number; revenue_micros: number }>;
	series_by_currency?: Array<{
		bucket: string;
		currency: string | null;
		purchases: number;
		revenue_micros: number;
	}>;
	by_product_platform: Array<{
		product_id: string;
		product_name: string;
		platform: string;
		store: string;
		units_sold: number;
		first_time_purchases: number;
		revenue_micros: number;
		currency: string | null;
		cancellations: number;
		revenue_in_display_currency_micros?: number;
		unconverted_purchases?: number;
	}>;
	display_currency?: string;
	totals_in_display_currency?: {
		purchases: number;
		gross_revenue_micros: number;
		refunds: number;
		refunded_micros: number;
		net_revenue_micros: number;
		active_subscriptions: number;
		unconverted_purchases: number;
		unconverted_refunds: number;
	};
	series_in_display_currency?: Array<{
		bucket: string;
		purchases: number;
		revenue_micros: number;
		unconverted_purchases: number;
	}>;
};

export async function getProducts(projectRef: string) {
	return unwrap<Product[]>(await GET(projectPath(projectRef, "/products")));
}
function productQuery(filters: Record<string, string | undefined>) {
	const query = new URLSearchParams(
		Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
	).toString();
	return query ? `?${query}` : "";
}
export async function getPurchases(projectRef: string, filters: PurchaseFilters | string = {}) {
	const query = typeof filters === "string" ? filters : productQuery(filters);
	return unwrap<Purchase[]>(await GET(`${projectPath(projectRef, "/purchases")}${query}`));
}
export async function createPurchase(projectRef: string, input: Record<string, unknown>) {
	return unwrap<Purchase>(await POST(projectPath(projectRef, "/purchases"), input));
}
export async function getPurchase(projectRef: string, purchaseId: string) {
	return unwrap<PurchaseDetail>(await GET(projectPath(projectRef, `/purchases/${purchaseId}`)));
}
export async function createRefund(
	projectRef: string,
	purchaseId: string,
	input: Record<string, unknown>,
) {
	return unwrap(await POST(projectPath(projectRef, `/purchases/${purchaseId}/refunds`), input));
}
export async function getSubscriptions(
	projectRef: string,
	filters: Pick<PurchaseFilters, "status" | "customer_id"> = {},
) {
	return unwrap<Subscription[]>(
		await GET(`${projectPath(projectRef, "/subscriptions")}${productQuery(filters)}`),
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
	>,
) {
	return unwrap<Subscription>(await PUT(projectPath(projectRef, `/subscriptions/${id}`), input));
}
export async function getProductStatistics(
	projectRef: string,
	filters: {
		from?: string;
		to?: string;
		product_id?: string;
		platform?: string;
	} = {},
) {
	return unwrap<ProductStatistics>(
		await GET(`${projectPath(projectRef, "/statistics")}${productQuery(filters)}`),
	);
}

export interface BillingMigrationStatus {
	complete: boolean;
	table?: string;
	cursor?: Array<string | number>;
}
export async function getBillingMigrationStatus(projectRef: string) {
	return unwrap<BillingMigrationStatus>(await GET(projectPath(projectRef, "/migration/status")));
}
export async function migrateProductsLedger(projectRef: string) {
	return unwrap<BillingMigrationStatus>(
		await POST(projectPath(projectRef, "/migrate-products"), {}),
	);
}
