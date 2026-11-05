import type { BillingEnv } from "../types";
import {
	aliasCustomer,
	applyVerifiedPurchase,
	type BillingEnvironment,
	type VerifiedPurchase,
} from "./billing";
import { entitlementIsActive } from "./billing-state";
import {
	finalizeGooglePurchase,
	verifyAppleTransaction,
	verifyGooglePurchase,
} from "./store-verification";

const RESTORE_BEHAVIORS = ["transfer", "transfer_if_no_active_subscriptions", "block"] as const;
type RestoreBehavior = (typeof RESTORE_BEHAVIORS)[number];

export type RestoreRequest = {
	projectId: string | number;
	customerId: string;
	environment: BillingEnvironment;
	appleTransactions: unknown;
	googlePurchases: unknown;
};

type ProductType = "subscription" | "non_consumable" | "consumable";

type SdkReceipt = {
	projectId: string | number;
	customerId: string;
	environment: BillingEnvironment;
	store: "apple" | "google";
	signedTransaction?: string;
	purchaseToken?: string;
	productId?: string;
	productType?: ProductType;
};

type ClaimedPurchase = {
	purchase: VerifiedPurchase;
	anonymousOwnerIds: string[];
	finalize: (() => Promise<void>) | null;
};

type PurchaseOwner = { id: string; anonymous: number; recorded: number };

export function restoreBehavior(value: unknown): RestoreBehavior {
	return RESTORE_BEHAVIORS.find((behavior) => behavior === value) ?? "transfer";
}

async function projectRestoreBehavior(db: D1Database, projectId: string | number) {
	const settings = await db
		.prepare("SELECT restore_behavior FROM billing_project_settings WHERE project_id = ?")
		.bind(String(projectId))
		.first<{ restore_behavior?: string }>();
	return restoreBehavior(settings?.restore_behavior);
}

export async function restoreVerifiedPurchases(env: BillingEnv, request: RestoreRequest) {
	const context = {
		projectId: request.projectId,
		customerId: request.customerId,
		environment: request.environment,
	};
	const receipts: SdkReceipt[] = [
		...boundedArray(request.appleTransactions, "apple_transactions").map((value) => {
			const signedTransaction = text(value);
			if (!signedTransaction)
				throw restoreError(
					"restore_apple_transaction_invalid",
					"Every Apple transaction must be a non-empty string",
				);
			return { ...context, store: "apple" as const, signedTransaction };
		}),
		...boundedArray(request.googlePurchases, "google_purchases").map((value) => {
			const item = object(value);
			const purchaseToken = text(item.purchase_token);
			const productId = text(item.product_id);
			if (!purchaseToken || !productId)
				throw restoreError(
					"restore_google_purchase_invalid",
					"Every Google purchase requires purchase_token and product_id",
				);
			return {
				...context,
				store: "google" as const,
				purchaseToken,
				productId,
				productType: productType(item.product_type),
			};
		}),
	];
	const behavior = await projectRestoreBehavior(env.DB, request.projectId);
	const claims: ClaimedPurchase[] = [];
	for (const receipt of receipts) claims.push(await claimReceipt(env, receipt, behavior));

	const restored: Array<Record<string, unknown>> = [];
	for (const claim of claims) {
		const applied = await commitClaim(env, claim);
		restored.push({
			store: claim.purchase.store,
			transaction_id: applied.transactionId,
			duplicate: applied.duplicate,
		});
	}
	return restored;
}

export async function applySdkPurchase(env: BillingEnv, receipt: SdkReceipt) {
	const behavior = await projectRestoreBehavior(env.DB, receipt.projectId);
	const claim = await claimReceipt(env, receipt, behavior);
	return { purchase: claim.purchase, applied: await commitClaim(env, claim) };
}

export async function currentPurchaseOwner(db: D1Database, purchase: VerifiedPurchase) {
	const chain = [
		String(purchase.projectId),
		purchase.store,
		purchase.environment,
		purchase.originalTransactionId || purchase.storeTransactionId,
	];
	const owner = await db
		.prepare(
			`SELECT customer_id FROM (
        SELECT customer_id, 0 AS source, COALESCE(latest_event_at, updated_at) AS observed_at
        FROM billing_subscriptions
        WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id = ?
        UNION ALL
        SELECT customer_id, 1 AS source, COALESCE(event_occurred_at, verified_at) AS observed_at
        FROM billing_transactions
        WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id = ?
      )
      WHERE customer_id IS NOT NULL
      ORDER BY source, datetime(observed_at) DESC
      LIMIT 1`,
		)
		.bind(...chain, ...chain)
		.first<{ customer_id: string }>();
	return owner?.customer_id ?? null;
}

async function claimReceipt(
	env: BillingEnv,
	receipt: SdkReceipt,
	behavior: RestoreBehavior,
): Promise<ClaimedPurchase> {
	if (receipt.store === "apple") {
		const verified = await verifyAppleTransaction(env, {
			projectId: receipt.projectId,
			customerId: receipt.customerId,
			signedTransaction: receipt.signedTransaction ?? "",
			environment: receipt.environment,
			allowTransfer: true,
		});
		return claimPurchase(env, {
			purchase: verified.purchase,
			customerId: receipt.customerId,
			boundCustomerId: verified.transaction.appAccountToken ?? null,
			behavior,
			finalize: null,
		});
	}
	const verified = await verifyGooglePurchase(env, {
		projectId: receipt.projectId,
		customerId: receipt.customerId,
		purchaseToken: receipt.purchaseToken ?? "",
		storeProductId: receipt.productId ?? "",
		productType: receipt.productType,
		environment: receipt.environment,
		allowTransfer: true,
	});
	return claimPurchase(env, {
		purchase: verified.purchase,
		customerId: receipt.customerId,
		boundCustomerId: googleBoundCustomer(verified.verified),
		behavior,
		finalize: () => finalizeGooglePurchase(verified),
	});
}

async function claimPurchase(
	env: BillingEnv,
	params: {
		purchase: VerifiedPurchase;
		customerId: string;
		boundCustomerId: string | null;
		behavior: RestoreBehavior;
		finalize: (() => Promise<void>) | null;
	},
): Promise<ClaimedPurchase> {
	const { purchase, customerId } = params;
	const chain = [
		String(purchase.projectId),
		purchase.store,
		purchase.environment,
		purchase.originalTransactionId || purchase.storeTransactionId,
	];
	const owners = await env.DB.prepare(
		`WITH chain AS (
      SELECT customer_id FROM billing_subscriptions
      WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id = ?
      UNION
      SELECT customer_id FROM billing_transactions
      WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id = ?
    )
    SELECT c.id, c.anonymous, c.id IN (SELECT customer_id FROM chain) AS recorded
    FROM billing_customers c
    WHERE c.project_id = ? AND c.id <> ?
      AND (c.id IN (SELECT customer_id FROM chain) OR c.id = ?)`,
	)
		.bind(...chain, ...chain, String(purchase.projectId), customerId, params.boundCustomerId ?? "")
		.all<PurchaseOwner>();
	const identified = owners.results.filter((owner) => Number(owner.anonymous) !== 1);
	if (identified.length > 0 && params.behavior !== "transfer") {
		const keep =
			params.behavior === "block" ||
			(await ownsActiveSubscription(
				env.DB,
				purchase,
				identified.map((owner) => owner.id),
			));
		if (keep) throw receiptAlreadyInUse();
	}
	return {
		purchase: { ...purchase, customerId, transfer: identified.length > 0 },
		anonymousOwnerIds: owners.results
			.filter((owner) => Number(owner.anonymous) === 1 && Number(owner.recorded) === 1)
			.map((owner) => owner.id),
		finalize: params.finalize,
	};
}

async function ownsActiveSubscription(
	db: D1Database,
	purchase: VerifiedPurchase,
	customerIds: string[],
) {
	if (
		purchase.productType === "subscription" &&
		entitlementIsActive(purchase.status, purchase.expiresAt)
	)
		return true;
	const subscriptions = await db
		.prepare(
			`SELECT status, expires_at FROM billing_subscriptions
      WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id <> ?
        AND customer_id IN (SELECT value FROM json_each(?))`,
		)
		.bind(
			String(purchase.projectId),
			purchase.store,
			purchase.environment,
			purchase.originalTransactionId || purchase.storeTransactionId,
			JSON.stringify(customerIds),
		)
		.all<{ status: string; expires_at: string | null }>();
	return subscriptions.results.some((row) => entitlementIsActive(row.status, row.expires_at));
}

async function commitClaim(env: BillingEnv, claim: ClaimedPurchase) {
	const customerId = claim.purchase.customerId ?? "";
	for (const ownerId of claim.anonymousOwnerIds) await aliasCustomer(env.DB, customerId, ownerId);
	const applied = await applyVerifiedPurchase(env, claim.purchase);
	if (claim.finalize) await claim.finalize();
	return applied;
}

function googleBoundCustomer(verified: Record<string, unknown>) {
	const identifiers = object(verified.externalAccountIdentifiers);
	return (
		text(identifiers.obfuscatedExternalAccountId) ||
		text(verified.obfuscatedExternalAccountId) ||
		null
	);
}

function productType(value: unknown): ProductType | undefined {
	return (["subscription", "non_consumable", "consumable"] as const).find((type) => type === value);
}

function boundedArray(value: unknown, field: string): unknown[] {
	if (value == null) return [];
	if (!Array.isArray(value))
		throw restoreError("restore_payload_invalid", `${field} must be an array`);
	if (value.length > 100)
		throw restoreError("restore_payload_too_large", `${field} is limited to 100 items`, 413);
	return value;
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: {};
}

function text(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

function restoreError(code: string, message: string, status = 422) {
	return Object.assign(new Error(message), { code, status, retryable: false });
}

function receiptAlreadyInUse() {
	return Object.assign(new Error("The receipt is already in use by another App User ID"), {
		code: "receipt_already_in_use",
		status: 409,
		retryable: false,
	});
}
