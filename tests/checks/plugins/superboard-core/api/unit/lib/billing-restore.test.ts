import { afterEach, describe, expect, it, vi } from "vitest";

import { restoreVerifiedPurchases } from "../../../../../../../packages/plugins/superboard-core/api/src/lib/billing-restore";
import type { BillingEnv } from "../../../../../../../packages/plugins/superboard-core/api/src/types";
import { createFakeD1 } from "../../helpers/fake-d1";

const providerMocks = vi.hoisted(() => ({
	apple: vi.fn(),
	google: vi.fn(),
	finalizeGoogle: vi.fn(),
	apply: vi.fn(),
}));

vi.mock(
	"../../../../../../../packages/plugins/superboard-core/api/src/lib/store-verification",
	() => ({
		verifyAppleTransaction: providerMocks.apple,
		verifyGooglePurchase: providerMocks.google,
		finalizeGooglePurchase: providerMocks.finalizeGoogle,
	}),
);

vi.mock(
	"../../../../../../../packages/plugins/superboard-core/api/src/lib/billing",
	async (loadOriginal) => ({
		...(await loadOriginal<
			typeof import("../../../../../../../packages/plugins/superboard-core/api/src/lib/billing")
		>()),
		applyVerifiedPurchase: providerMocks.apply,
	}),
);

afterEach(() => {
	for (const mock of Object.values(providerMocks)) mock.mockReset();
});

describe("verified purchase restoration", () => {
	it("restores Apple and Google through provider verification and finalizes Google last", async () => {
		const order: string[] = [];
		providerMocks.apple.mockResolvedValue({
			purchase: { store: "apple", environment: "sandbox" },
			transaction: {},
		});
		providerMocks.google.mockResolvedValue({
			purchase: { store: "google", environment: "sandbox" },
			verified: {},
		});
		providerMocks.apply.mockImplementation(async (_env, purchase) => {
			order.push(`apply:${purchase.store}`);
			return { transactionId: `${purchase.store}-transaction`, duplicate: false };
		});
		providerMocks.finalizeGoogle.mockImplementation(async () => {
			order.push("finalize:google");
		});
		const env = restoreEnvironment("transfer");

		await expect(
			restoreVerifiedPurchases(env, {
				projectId: "11",
				customerId: "customer-1",
				environment: "sandbox",
				appleTransactions: ["signed-apple-transaction"],
				googlePurchases: [
					{
						purchase_token: "google-token",
						product_id: "weekly-plan",
						product_type: "subscription",
					},
				],
			}),
		).resolves.toEqual([
			{ store: "apple", transaction_id: "apple-transaction", duplicate: false },
			{ store: "google", transaction_id: "google-transaction", duplicate: false },
		]);
		expect(order).toEqual(["apply:apple", "apply:google", "finalize:google"]);
		expect(providerMocks.apple).toHaveBeenCalledWith(
			env,
			expect.objectContaining({ allowTransfer: true }),
		);
		expect(providerMocks.google).toHaveBeenCalledWith(
			env,
			expect.objectContaining({ allowTransfer: true }),
		);
	});

	it("rejects a receipt kept by another App User ID before applying any purchase", async () => {
		const env = restoreEnvironment("block", [{ id: "owner-1", anonymous: 0, recorded: 1 }]);
		providerMocks.apple.mockResolvedValue({
			purchase: { store: "apple", environment: "production" },
			transaction: {},
		});
		providerMocks.google.mockResolvedValue({
			purchase: { store: "google", environment: "production" },
			verified: {},
		});

		await expect(
			restoreVerifiedPurchases(env, {
				projectId: "11",
				customerId: "customer-1",
				environment: "production",
				appleTransactions: ["signed-apple-transaction"],
				googlePurchases: [{ purchase_token: "google-token", product_id: "weekly-plan" }],
			}),
		).rejects.toMatchObject({ code: "receipt_already_in_use", status: 409, retryable: false });
		expect(providerMocks.apply).not.toHaveBeenCalled();
		expect(providerMocks.finalizeGoogle).not.toHaveBeenCalled();
	});

	it("rejects incomplete provider entries before contacting a provider", async () => {
		const env = restoreEnvironment("transfer");
		await expect(
			restoreVerifiedPurchases(env, {
				projectId: "11",
				customerId: "customer-1",
				environment: "production",
				appleTransactions: ["signed-apple-transaction"],
				googlePurchases: [{ product_id: "weekly-plan" }],
			}),
		).rejects.toMatchObject({ code: "restore_google_purchase_invalid", retryable: false });
		expect(providerMocks.apple).not.toHaveBeenCalled();
		expect(providerMocks.google).not.toHaveBeenCalled();
	});

	it("bounds restore batches before contacting a provider", async () => {
		const env = restoreEnvironment("transfer");
		await expect(
			restoreVerifiedPurchases(env, {
				projectId: "11",
				customerId: "customer-1",
				environment: "sandbox",
				appleTransactions: Array.from({ length: 101 }, () => "signed"),
				googlePurchases: [],
			}),
		).rejects.toMatchObject({ code: "restore_payload_too_large", status: 413 });
		expect(providerMocks.apple).not.toHaveBeenCalled();
	});
});

function restoreEnvironment(restoreBehavior: string, owners: unknown[] = []) {
	return {
		DB: createFakeD1((call) => {
			if (call.op === "first" && call.sql.includes("FROM billing_project_settings"))
				return { restore_behavior: restoreBehavior };
			if (call.op === "all" && call.sql.includes("WITH chain AS")) return owners;
			return undefined;
		}),
	} as BillingEnv;
}
