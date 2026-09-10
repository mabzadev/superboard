import { expect, test } from "vitest";

import {
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plug-products";
const file = "retirement-api-products.runtime.test.ts";
test("canonical Products commands retain catalog relations, archived records and imported store products", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/products/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("products");
	const command = (id: string, method: string, path: string, body?: unknown) =>
		apiCommand(plugin, id, { method, path: base + path, ...(body === undefined ? {} : { body }) });
	const read = (id: string, path: string) =>
		apiRead(plugin, id, { method: "GET", path: base + path });
	const productBody = {
		identifier: "proof-product",
		display_name: "Canonical subscription",
		product_type: "subscription",
		status: "active",
	};
	const product = await jsonResult<{ data: { id: string } }>(
		await command("create_product", "POST", "/catalog/products", productBody),
		201,
	);
	const productId = product.data.id;
	let products = await jsonResult<{
		data: Array<{ id: string; display_name: string; status: string }>;
	}>(await read("products", "/catalog/products"));
	expect(products.data).toContainEqual(
		expect.objectContaining({ id: productId, display_name: "Canonical subscription" }),
	);
	proveApi(plugin, "create_product", "mutation", file, [productId]);
	proveApi(plugin, "products", "read", file, [productId]);
	await jsonResult(
		await command("update_product", "PUT", `/catalog/products/${productId}`, {
			...productBody,
			display_name: "Updated subscription",
			description: "Retained description",
		}),
	);
	expect(
		await db
			.prepare("SELECT display_name,description FROM products WHERE id=?")
			.bind(productId)
			.first(),
	).toEqual({ display_name: "Updated subscription", description: "Retained description" });
	proveApi(plugin, "update_product", "mutation", file, [productId]);
	const packageBody = {
		identifier: "proof-package",
		display_name: "Canonical package",
		product_id: productId,
		position: 3,
		active: true,
	};
	const pkg = await jsonResult<{ data: { id: string } }>(
		await command("create_package", "POST", "/packages", packageBody),
		201,
	);
	const packageId = pkg.data.id;
	const packages = await jsonResult<{ data: Array<{ id: string; product_id: string }> }>(
		await read("packages", "/packages"),
	);
	expect(packages.data).toContainEqual(
		expect.objectContaining({ id: packageId, product_id: productId }),
	);
	proveApi(plugin, "create_package", "mutation", file, [packageId]);
	proveApi(plugin, "packages", "read", file, [packageId]);
	await jsonResult(
		await command("update_package", "PUT", `/packages/${packageId}`, {
			...packageBody,
			display_name: "Updated package",
			position: 7,
		}),
	);
	expect(
		await db
			.prepare("SELECT display_name,position FROM packages WHERE id=?")
			.bind(packageId)
			.first(),
	).toEqual({ display_name: "Updated package", position: 7 });
	proveApi(plugin, "update_package", "mutation", file, [packageId]);
	const offeringBody = {
		identifier: "proof-offering",
		display_name: "Canonical offering",
		placement: "proof_home",
		package_ids: [packageId],
		priority: 10,
		active: true,
	};
	const offering = await jsonResult<{ data: { id: string } }>(
		await command("create_offering", "POST", "/offerings", offeringBody),
		201,
	);
	const offeringId = offering.data.id;
	const offerings = await jsonResult<{
		data: Array<{ id: string; packages: Array<{ id: string }> }>;
	}>(await read("offerings", "/offerings"));
	expect(offerings.data).toContainEqual(
		expect.objectContaining({
			id: offeringId,
			packages: [expect.objectContaining({ id: packageId })],
		}),
	);
	proveApi(plugin, "create_offering", "mutation", file, [offeringId]);
	proveApi(plugin, "offerings", "read", file, [offeringId]);
	await jsonResult(
		await command("update_offering", "PUT", `/offerings/${offeringId}`, {
			...offeringBody,
			display_name: "Updated offering",
			priority: 20,
		}),
	);
	expect(
		await db.prepare("SELECT name,priority FROM offerings WHERE id=?").bind(offeringId).first(),
	).toEqual({ name: "Updated offering", priority: 20 });
	proveApi(plugin, "update_offering", "mutation", file, [offeringId]);
	const entitlementBody = {
		identifier: "proof_access",
		display_name: "Canonical access",
		product_ids: [productId],
		active: true,
	};
	const entitlement = await jsonResult<{ data: { id: string } }>(
		await command("create_entitlement", "POST", "/entitlements", entitlementBody),
		201,
	);
	const entitlementId = entitlement.data.id;
	const entitlements = await jsonResult<{
		data: Array<{ id: string; products: Array<{ id: string }> }>;
	}>(await read("entitlements", "/entitlements"));
	expect(entitlements.data).toContainEqual(
		expect.objectContaining({
			id: entitlementId,
			products: [expect.objectContaining({ id: productId })],
		}),
	);
	proveApi(plugin, "create_entitlement", "mutation", file, [entitlementId]);
	proveApi(plugin, "entitlements", "read", file, [entitlementId]);
	await jsonResult(
		await command("update_entitlement", "PUT", `/entitlements/${entitlementId}`, {
			...entitlementBody,
			display_name: "Updated access",
			description: "Entitlement description",
		}),
	);
	expect(
		await db
			.prepare("SELECT name,description FROM entitlements WHERE id=?")
			.bind(entitlementId)
			.first(),
	).toEqual({ name: "Updated access", description: "Entitlement description" });
	proveApi(plugin, "update_entitlement", "mutation", file, [entitlementId]);
	const sync = await jsonResult<{ data: { id: string } }>(
		await command("sync_store_catalog", "POST", "/catalog/sync", {
			store: "manual",
			environment: "sandbox",
			complete_catalog: false,
			products: [
				{
					store_product_id: "proof.store.subscription",
					identifier: "proof_synced",
					display_name: "Imported store subscription",
					product_type: "subscription",
					price_micros: 4990000,
					currency: "USD",
					billing_period: "P1M",
				},
			],
		}),
		202,
	);
	const syncs = await jsonResult<{ data: Array<{ id: string; status: string }> }>(
		await read("store_sync_runs", "/catalog/syncs"),
	);
	expect(syncs.data).toContainEqual(
		expect.objectContaining({ id: sync.data.id, status: "succeeded" }),
	);
	const stored = await db
		.prepare(
			"SELECT store_product_id,price_micros FROM store_products WHERE store_product_id='proof.store.subscription'",
		)
		.first();
	expect(stored).toEqual({ store_product_id: "proof.store.subscription", price_micros: 4990000 });
	proveApi(plugin, "sync_store_catalog", "mutation", file, [sync.data.id]);
	proveApi(plugin, "store_sync_runs", "read", file, [sync.data.id]);
	const stats = await jsonResult<{ data: { totals: { purchases: number } } }>(
		await read("product_statistics", `/statistics?product_id=${productId}`),
	);
	expect(stats.data.totals.purchases).toBe(0);
	proveApi(plugin, "product_statistics", "read", file, [productId]);
	for (const [commandId, path, query, expected, id] of [
		[
			"archive_entitlement",
			"/entitlements",
			"SELECT active AS value FROM entitlements WHERE id=?",
			0,
			entitlementId,
		],
		[
			"archive_offering",
			"/offerings",
			"SELECT active AS value FROM offerings WHERE id=?",
			0,
			offeringId,
		],
		[
			"archive_package",
			"/packages",
			"SELECT active AS value FROM packages WHERE id=?",
			0,
			packageId,
		],
		[
			"archive_product",
			"/catalog/products",
			"SELECT status AS value FROM products WHERE id=?",
			"archived",
			productId,
		],
	] as const) {
		await jsonResult(await command(commandId!, "DELETE", `${path}/${id}`));
		expect(await db.prepare(query).bind(id).first()).toEqual({ value: expected });
		proveApi(plugin, commandId!, "mutation", file, [id!]);
	}
	products = await jsonResult(await read("products", "/catalog/products"));
	expect(products.data).toContainEqual(
		expect.objectContaining({ id: productId, status: "archived" }),
	);
});
