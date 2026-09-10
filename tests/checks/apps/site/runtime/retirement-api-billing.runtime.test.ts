import { expect, test } from "vitest";

import {
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plugmod-billing";
const file = "retirement-api-billing.runtime.test.ts";
test("canonical Billing migrates the real Products ledger and retains purchase, access, subscription and refund state", async () => {
	const scope = await prepareApiPlugin("supbrd-plug-products");
	const projectRef = scope.production_project_ref;
	const sourceBase = `/api/v1/products/projects/${projectRef}`;
	const product = await jsonResult<{ data: { id: string } }>(
		await apiCommand("supbrd-plug-products", "create_product", {
			method: "POST",
			path: sourceBase + "/catalog/products",
			body: {
				identifier: "billing-transfer-product",
				display_name: "Transferred premium",
				product_type: "subscription",
				status: "active",
			},
		}),
		201,
	);
	const entitlement = await jsonResult<{ data: { id: string } }>(
		await apiCommand("supbrd-plug-products", "create_entitlement", {
			method: "POST",
			path: sourceBase + "/entitlements",
			body: {
				identifier: "premium",
				display_name: "Premium access",
				active: true,
				product_ids: [product.data.id],
			},
		}),
		201,
	);
	await prepareApiPlugin(plugin);
	const db = pluginDatabase("api");
	const sourceDb = pluginDatabase("products");
	const base = `/api/v1/billing/projects/${projectRef}/ledger`;
	const command = (id: string, method: string, path: string, body?: unknown, key?: string) =>
		apiCommand(
			plugin,
			id,
			{ method, path: base + path, ...(body === undefined ? {} : { body }) },
			key,
		);
	const read = (id: string, path: string) =>
		apiRead(plugin, id, { method: "GET", path: base + path });
	let complete = false;
	for (let attempt = 0; attempt < 5 && !complete; attempt++) {
		const migration = await jsonResult<{ data: { complete: boolean } }>(
			await command("migrate_products", "POST", "/migrate-products", {}),
		);
		complete = migration.data.complete;
	}
	expect(complete).toBe(true);
	expect(
		await db
			.prepare("SELECT display_name FROM billing_catalog_products WHERE id=?")
			.bind(product.data.id)
			.first(),
	).toEqual({ display_name: "Transferred premium" });
	expect(
		await db
			.prepare("SELECT name FROM billing_catalog_entitlements WHERE id=?")
			.bind(entitlement.data.id)
			.first(),
	).toEqual({ name: "Premium access" });
	expect(
		await sourceDb.prepare("SELECT status FROM products_billing_ledger_authority LIMIT 1").first(),
	).toEqual({ status: "active" });
	proveApi(plugin, "migrate_products", "mutation", file, [product.data.id, entitlement.data.id]);
	const migrationStatus = await jsonResult<{ data: { complete: boolean } }>(
		await read("migration_status", "/migration/status"),
	);
	expect(migrationStatus.data.complete).toBe(true);
	proveApi(plugin, "migration_status", "read", file, [product.data.id]);
	const body = {
		financial_customer_id: "billing-proof-customer",
		product_id: product.data.id,
		store: "manual",
		environment: "production",
		external_transaction_id: "billing-proof-transaction",
		original_transaction_id: "billing-proof-original",
		purchased_price_micros: 9990000,
		currency: "EUR",
		expires_at: "2099-01-01T00:00:00.000Z",
	};
	const key = crypto.randomUUID();
	const purchase = await jsonResult<{ data: { id: string } }>(
		await command("create_purchase", "POST", "/purchases", body, key),
		201,
	);
	const id = purchase.data.id;
	const replay = await jsonResult<{ data: { id: string } }>(
		await command("create_purchase", "POST", "/purchases", body, key),
		201,
	);
	expect(replay.data.id).toBe(id);
	expect(
		await db
			.prepare(
				"SELECT COUNT(*) AS count FROM billing_catalog_purchases WHERE external_transaction_id='billing-proof-transaction'",
			)
			.first(),
	).toEqual({ count: 1 });
	proveApi(plugin, "create_purchase", "mutation", file, [id]);
	const purchases = await jsonResult<{ data: Array<{ id: string; product_name: string }> }>(
		await read("purchases", "/purchases"),
	);
	expect(purchases.data).toContainEqual(
		expect.objectContaining({ id, product_name: "Transferred premium" }),
	);
	proveApi(plugin, "purchases", "read", file, [id]);
	const detail = await jsonResult<{
		data: { id: string; status: string; entitlements: Array<{ id: string }> };
	}>(await read("purchase", `/purchases/${id}`));
	expect(detail.data).toMatchObject({
		id,
		status: "active",
		entitlements: [expect.objectContaining({ id: entitlement.data.id })],
	});
	proveApi(plugin, "purchase", "read", file, [id]);
	const access = await jsonResult<{ data: { entitlements: Array<{ id: string }> } }>(
		await read("financial_customer_entitlements", "/customers/billing-proof-customer/entitlements"),
	);
	expect(access.data.entitlements).toContainEqual(
		expect.objectContaining({ id: entitlement.data.id }),
	);
	proveApi(plugin, "financial_customer_entitlements", "read", file, [entitlement.data.id]);
	const subscriptions = await jsonResult<{ data: Array<{ id: string; status: string }> }>(
		await read("subscriptions", "/subscriptions"),
	);
	expect(subscriptions.data).toHaveLength(1);
	const subscriptionId = subscriptions.data[0]!.id;
	expect(subscriptions.data[0]!.status).toBe("active");
	proveApi(plugin, "subscriptions", "read", file, [subscriptionId]);
	await jsonResult(
		await command("update_subscription", "PUT", `/subscriptions/${subscriptionId}`, {
			status: "cancelled",
			auto_renew: false,
		}),
	);
	expect(
		await db
			.prepare("SELECT status,auto_renew FROM billing_catalog_subscriptions WHERE id=?")
			.bind(subscriptionId)
			.first(),
	).toEqual({ status: "cancelled", auto_renew: 0 });
	proveApi(plugin, "update_subscription", "mutation", file, [subscriptionId]);
	const refundBody = {
		status: "requested",
		amount_micros: 9990000,
		currency: "EUR",
		reason: "Customer requested refund",
	};
	const refund = await jsonResult<{ data: { id: string } }>(
		await command("create_refund", "POST", `/purchases/${id}/refunds`, refundBody),
		201,
	);
	const refundId = refund.data.id;
	const refunds = await jsonResult<{
		data: Array<{ id: string; status: string; purchase_id: string }>;
	}>(await read("refunds", "/refunds"));
	expect(refunds.data).toContainEqual(
		expect.objectContaining({ id: refundId, status: "requested", purchase_id: id }),
	);
	proveApi(plugin, "create_refund", "mutation", file, [refundId]);
	proveApi(plugin, "refunds", "read", file, [refundId]);
	await jsonResult(
		await command("update_refund", "PUT", `/refunds/${refundId}`, {
			...refundBody,
			status: "completed",
		}),
	);
	expect(
		await db
			.prepare("SELECT status FROM billing_catalog_refunds WHERE id=?")
			.bind(refundId)
			.first(),
	).toEqual({ status: "completed" });
	expect(
		await db.prepare("SELECT status FROM billing_catalog_purchases WHERE id=?").bind(id).first(),
	).toEqual({ status: "refunded" });
	expect(
		await jsonResult(
			await read(
				"financial_customer_entitlements",
				"/customers/billing-proof-customer/entitlements",
			),
		),
	).toMatchObject({ data: { entitlements: [] } });
	proveApi(plugin, "update_refund", "mutation", file, [refundId]);
	await jsonResult(await command("reconcile_store", "POST", "/reconcile", {}));
	const reconciliation = await db
		.prepare(
			"SELECT id FROM billing_catalog_audit_events WHERE action='billing.reconciled' LIMIT 1",
		)
		.first<{ id: string }>();
	expect(reconciliation?.id).toBeTruthy();
	proveApi(plugin, "reconcile_store", "mutation", file, [reconciliation!.id]);
	const ledger = await jsonResult<{
		data: { operations: Array<{ entity_id: string; action: string; actor_id: string }> };
	}>(await read("billing_ledger", ""));
	expect(ledger.data.operations).toContainEqual(
		expect.objectContaining({ entity_id: id, action: "purchase.recorded", actor_id: "operator-1" }),
	);
	proveApi(plugin, "billing_ledger", "read", file, [id, reconciliation!.id]);
});
