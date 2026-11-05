import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import purchases from "../../../../../../../packages/plugins/superboard-core/api/src/routes/purchases-sdk";
import type {
	AppVariables,
	Env,
} from "../../../../../../../packages/plugins/superboard-core/api/src/types";
import { createFakeD1 } from "../../helpers/fake-d1";

const billing = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock(
	"../../../../../../../packages/plugins/superboard-core/api/src/lib/billing-service",
	() => ({
		billingServiceEnabled: () => true,
		callBillingService: billing.call,
		customerInfoFromBillingAuthority: vi.fn(),
		identifyCustomerFromBillingAuthority: vi.fn(),
		resolveCustomerFromBillingAuthority: async () => ({
			customer: { id: "restorer" },
			appUserId: "restorer",
			identified: true,
		}),
	}),
);

describe("SDK purchase restoration", () => {
	it("reports a receipt kept by another App User ID as a conflict", async () => {
		billing.call.mockRejectedValue(
			Object.assign(new Error("The receipt is already in use by another App User ID"), {
				code: "receipt_already_in_use",
				status: 409,
				retryable: false,
			}),
		);
		const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
		app.use("*", async (c, next) => {
			c.set("projectId", "11");
			await next();
		});
		app.route("/", purchases);
		const env = {
			DB: createFakeD1((call) =>
				call.op === "first" && call.sql.includes("FROM projects p")
					? { id: 11, is_test: 1, purchases_enabled: 1 }
					: undefined,
			),
		} as unknown as Env;

		const response = await app.request(
			"/restore",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ google_purchases: [{ purchase_token: "t", product_id: "p" }] }),
			},
			env,
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: "The receipt is already in use by another App User ID",
			code: "receipt_already_in_use",
		});
	});
});
