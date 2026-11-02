import type { Kysely } from "kysely";
import { it, expect, beforeEach, afterEach } from "vitest";

import { PluginStorageRepository } from "../../../../../../packages/core/src/database/repositories/plugin-storage.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { createStorageIndexes } from "../../../../../../packages/core/src/plugins/storage-indexes.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

interface Product {
	sku: string;
	stock: number;
}

describeEachDialect("Plugin storage numeric comparison on Postgres", (dialect) => {
	let ctx: DialectTestContext;
	let db: Kysely<Database>;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		db = ctx.db;
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	function productsRepo(): PluginStorageRepository<Product> {
		return new PluginStorageRepository<Product>(db, "shop", "products", ["sku", "stock"]);
	}

	async function seedProducts(): Promise<PluginStorageRepository<Product>> {
		const repo = productsRepo();
		await repo.putMany([
			{ id: "p9", data: { sku: "A9", stock: 9 } },
			{ id: "p10", data: { sku: "B10", stock: 10 } },
			{ id: "p100", data: { sku: "C100", stock: 100 } },
		]);
		return repo;
	}

	it("numeric RangeFilter { gte: 10 } returns exactly {10, 100}, never 9", async () => {
		const repo = await seedProducts();
		const result = await repo.query({ where: { stock: { gte: 10 } } });
		expect(result.items.map((i) => i.id).toSorted()).toEqual(["p10", "p100"]);
		expect(result.items.map((i) => i.data.stock).toSorted((a, b) => a - b)).toEqual([10, 100]);
	});

	it("count({ stock: { gte: 10 } }) is numerically correct (2, not 3)", async () => {
		const repo = await seedProducts();
		expect(await repo.count({ stock: { gte: 10 } })).toBe(2);
	});

	it("creates and enforces a UNIQUE expression index (regression guard for #1898)", async () => {
		const result = await createStorageIndexes(db, "shop", "products", [], {
			uniqueIndexes: ["sku"],
		});
		expect(result.errors).toEqual([]);
		expect(result.created).toContain("uidx_plugin_shop_products_sku");

		const repo = productsRepo();
		await repo.put("first", { sku: "DUP", stock: 1 });
		await expect(repo.put("second", { sku: "DUP", stock: 2 })).rejects.toThrow();
	});

	it("orderBy { stock: 'asc' } sorts numerically [9, 10, 100], not lexically [10, 100, 9]", async () => {
		const repo = await seedProducts();
		const asc = await repo.query({ orderBy: { stock: "asc" } });
		expect(asc.items.map((i) => i.data.stock)).toEqual([9, 10, 100]);
		expect(asc.items.map((i) => i.id)).toEqual(["p9", "p10", "p100"]);

		const desc = await repo.query({ orderBy: { stock: "desc" } });
		expect(desc.items.map((i) => i.data.stock)).toEqual([100, 10, 9]);
	});
});
