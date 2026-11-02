import { afterEach, beforeEach, expect, it } from "vitest";

import { listTablesLike } from "../../../../../../packages/core/src/database/dialect-helpers.js";
import {
	type DialectTestContext,
	describeEachDialect,
	setupForDialectWithCollections,
	teardownForDialect,
} from "../../utils/test-db.js";

describeEachDialect("listTablesLike schema scoping", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await setupForDialectWithCollections(dialect);
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	it("finds content tables in the active schema", async () => {
		const tables = await listTablesLike(ctx.db, "ec_%");
		expect(tables.toSorted()).toEqual(["ec_page", "ec_post"]);
	});

	it("returns an empty list when nothing matches the pattern", async () => {
		const tables = await listTablesLike(ctx.db, "nonexistent_%");
		expect(tables).toEqual([]);
	});
});
