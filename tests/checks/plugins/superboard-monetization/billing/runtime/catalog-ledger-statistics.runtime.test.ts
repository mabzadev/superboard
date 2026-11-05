import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { beforeAll, expect, test } from "vitest";

import worker from "../../../../../../packages/plugins/superboard-monetization/billing/src/index.js";
import { billingTestEnv as testEnv, createExecutionContext } from "./apply-migrations.js";

async function request(method: string, resource: string, body?: unknown) {
	const path = `/internal/v1/catalog-ledger${resource}`;
	const headers = await createProjectContextHeaders(
		{
			module: "billing",
			method,
			pathname: new URL(path, "https://billing.internal").pathname,
			projectId: 191,
			projectRef: "19-test",
			instanceId: 19,
			environment: "test",
			actorId: 0,
			operatorId: "statistics-operator",
			role: "owner",
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		"billing-runtime-internal-token",
	);
	headers.set("Content-Type", "application/json");
	if (method !== "GET") headers.set("Idempotency-Key", crypto.randomUUID());
	return worker.fetch!(
		new Request(`https://billing.internal${path}`, {
			method,
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}) as Request<unknown, IncomingRequestCfProperties>,
		{ ...testEnv, CREDENTIAL_KEY_SCOPE: "billing" },
		createExecutionContext(),
	);
}

async function purchase(
	transaction: string,
	purchasedAt: string,
	micros: number,
	currency: string | null,
) {
	const response = await request("POST", "/purchases", {
		financial_customer_id: `customer-${transaction}`,
		product_id: "ledger-pro",
		product_snapshot: {
			identifier: "pro",
			display_name: "Pro",
			product_type: "non_consumable",
			status: "active",
		},
		store: "apple",
		environment: "sandbox",
		external_transaction_id: transaction,
		purchased_at: purchasedAt,
		purchased_price_micros: micros,
		currency,
	});
	expect(response.status).toBe(201);
	return (await response.json<{ data: { id: string } }>()).data.id;
}

beforeAll(async () => {
	await testEnv.DB.batch([
		testEnv.DB.prepare(
			"INSERT INTO instances(id,api_key,uri_scheme) VALUES(19,'statistics-test','statistics-test')",
		),
		testEnv.DB.prepare(
			"INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(191,19,1,'Statistics','statistics-test')",
		),
	]);
});

test("purchase statistics keep each currency apart while legacy totals stay unchanged", async () => {
	await purchase("eur-1", "2026-10-01T09:00:00.000Z", 9_990_000, "EUR");
	const refunded = await purchase("eur-2", "2026-10-01T10:00:00.000Z", 4_990_000, "EUR");
	await purchase("usd-1", "2026-10-01T11:00:00.000Z", 2_000_000, "USD");
	await purchase("unknown-1", "2026-10-02T09:00:00.000Z", 1_000_000, null);
	const refund = await request("POST", `/purchases/${refunded}/refunds`, {
		status: "completed",
		amount_micros: 4_990_000,
		requested_at: "2026-10-03T09:00:00.000Z",
		completed_at: "2026-10-03T09:00:00.000Z",
	});
	expect(refund.status).toBe(201);

	const response = await request("GET", "/statistics?from=2026-10-01&to=2026-10-31");
	expect(response.status).toBe(200);
	const { data } = await response.json<{ data: Record<string, unknown> }>();

	expect(data.totals).toEqual({
		purchases: 4,
		gross_revenue_micros: 17_980_000,
		refunds: 1,
		refunded_micros: 4_990_000,
		active_subscriptions: 0,
		net_revenue_micros: 12_990_000,
	});
	expect(data.series).toEqual([
		{ bucket: "2026-10-01", purchases: 3, revenue_micros: 16_980_000 },
		{ bucket: "2026-10-02", purchases: 1, revenue_micros: 1_000_000 },
	]);
	expect(data.totals_by_currency).toEqual([
		{
			currency: "EUR",
			purchases: 2,
			gross_revenue_micros: 14_980_000,
			refunds: 1,
			refunded_micros: 4_990_000,
			net_revenue_micros: 9_990_000,
		},
		{
			currency: "USD",
			purchases: 1,
			gross_revenue_micros: 2_000_000,
			refunds: 0,
			refunded_micros: 0,
			net_revenue_micros: 2_000_000,
		},
		{
			currency: null,
			purchases: 1,
			gross_revenue_micros: 1_000_000,
			refunds: 0,
			refunded_micros: 0,
			net_revenue_micros: 1_000_000,
		},
	]);
	expect(data.series_by_currency).toEqual([
		{ bucket: "2026-10-01", currency: "EUR", purchases: 2, revenue_micros: 14_980_000 },
		{ bucket: "2026-10-01", currency: "USD", purchases: 1, revenue_micros: 2_000_000 },
		{ bucket: "2026-10-02", currency: null, purchases: 1, revenue_micros: 1_000_000 },
	]);
});

test("an empty period has no currency totals", async () => {
	const response = await request("GET", "/statistics?from=2025-01-01&to=2025-01-31");
	expect(response.status).toBe(200);
	const { data } = await response.json<{ data: Record<string, unknown> }>();

	expect(data.totals).toMatchObject({ purchases: 0, gross_revenue_micros: 0, refunded_micros: 0 });
	expect(data.totals_by_currency).toEqual([]);
	expect(data.series_by_currency).toEqual([]);
});
