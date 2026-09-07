export const BILLING_CATALOG_TABLES = {
	products: {
		columns: [
			"id",
			"project_id",
			"identifier",
			"display_name",
			"description",
			"product_type",
			"status",
			"created_at",
			"updated_at",
		],
		keys: ["id"],
	},
	financial_customers: {
		columns: [
			"id",
			"project_id",
			"external_customer_id",
			"attributes_json",
			"created_at",
			"updated_at",
		],
		keys: ["id"],
	},
	entitlements: {
		columns: [
			"id",
			"project_id",
			"key",
			"name",
			"description",
			"active",
			"created_at",
			"updated_at",
		],
		keys: ["id"],
	},
	entitlement_products: {
		columns: ["entitlement_id", "product_id"],
		keys: ["entitlement_id", "product_id"],
	},
	purchases: {
		columns: [
			"id",
			"project_id",
			"financial_customer_id",
			"product_id",
			"status",
			"purchased_at",
			"payload_json",
			"store",
			"environment",
			"external_transaction_id",
			"original_transaction_id",
			"purchased_price_micros",
			"currency",
			"expires_at",
			"updated_at",
		],
		keys: ["id"],
	},
	purchase_entitlements: {
		columns: ["purchase_id", "entitlement_id"],
		keys: ["purchase_id", "entitlement_id"],
	},
	subscriptions: {
		columns: [
			"id",
			"project_id",
			"financial_customer_id",
			"product_id",
			"latest_purchase_id",
			"store",
			"environment",
			"original_transaction_id",
			"status",
			"current_period_started_at",
			"current_period_ends_at",
			"auto_renew",
			"cancelled_at",
			"created_at",
			"updated_at",
		],
		keys: ["id"],
	},
	refunds: {
		columns: [
			"id",
			"project_id",
			"purchase_id",
			"external_refund_id",
			"status",
			"amount_micros",
			"currency",
			"reason",
			"metadata_json",
			"requested_at",
			"completed_at",
			"updated_at",
		],
		keys: ["id"],
	},
	audit_events: {
		columns: [
			"id",
			"project_id",
			"action",
			"payload_json",
			"created_at",
			"actor_id",
			"entity_type",
			"entity_id",
			"request_id",
			"occurred_at",
			"actor_role",
			"project_ref",
			"environment",
		],
		keys: ["id"],
	},
	idempotency_keys: {
		columns: [
			"project_id",
			"key",
			"method",
			"path",
			"request_hash",
			"status_code",
			"response_json",
			"created_at",
		],
		keys: ["project_id", "key"],
	},
} as const;

export type BillingCatalogTable = keyof typeof BILLING_CATALOG_TABLES;
export type BillingCatalogValue = string | number | null;
export interface BillingCatalogBatch {
	schema_version: 1;
	instance_id: string;
	project_ref: string;
	project_id: string;
	table: BillingCatalogTable;
	cursor: Array<string | number>;
	next_cursor: Array<string | number>;
	complete: boolean;
	rows: Array<Record<string, BillingCatalogValue>>;
	issued_at: number;
}
const SIGNATURE_PREFIX = "superboard.products-billing-catalog.v1\n";
export async function signBillingCatalogBatch(
	batch: BillingCatalogBatch,
	secret: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const bytes = new Uint8Array(
		await crypto.subtle.sign(
			"HMAC",
			key,
			new TextEncoder().encode(SIGNATURE_PREFIX + JSON.stringify(batch)),
		),
	);
	return btoa(String.fromCharCode(...bytes));
}
export async function verifyBillingCatalogBatch(
	batch: BillingCatalogBatch,
	signature: string,
	secret: string,
): Promise<boolean> {
	if (
		!secret ||
		!Number.isSafeInteger(batch.issued_at) ||
		Math.abs(Date.now() / 1000 - batch.issued_at) > 300
	)
		return false;
	try {
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);
		const bytes = Uint8Array.from(atob(signature), (value) => value.charCodeAt(0));
		return crypto.subtle.verify(
			"HMAC",
			key,
			bytes,
			new TextEncoder().encode(SIGNATURE_PREFIX + JSON.stringify(batch)),
		);
	} catch {
		return false;
	}
}

export interface BillingCatalogCompletion {
	schema_version: 1;
	instance_id: string;
	project_ref: string;
	project_id: string;
	issued_at: number;
}
export async function signBillingCatalogCompletion(
	receipt: BillingCatalogCompletion,
	secret: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signed = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(
			"superboard.billing-catalog-completion.v1\n" + JSON.stringify(receipt),
		),
	);
	return btoa(String.fromCharCode(...new Uint8Array(signed)));
}
export async function verifyBillingCatalogCompletion(
	receipt: BillingCatalogCompletion,
	signature: string,
	secret: string,
): Promise<boolean> {
	if (
		!secret ||
		!Number.isSafeInteger(receipt.issued_at) ||
		Math.abs(Date.now() / 1000 - receipt.issued_at) > 300
	)
		return false;
	try {
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);
		return crypto.subtle.verify(
			"HMAC",
			key,
			Uint8Array.from(atob(signature), (x) => x.charCodeAt(0)),
			new TextEncoder().encode(
				"superboard.billing-catalog-completion.v1\n" + JSON.stringify(receipt),
			),
		);
	} catch {
		return false;
	}
}
