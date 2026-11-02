import { beforeEach, afterEach, expect, it } from "vitest";

import {
	handleContentCreate,
	handleContentList,
} from "../../../../../../packages/core/src/api/handlers/content.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("content list custom-field sort", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		const registry = new SchemaRegistry(ctx.db);
		await registry.createCollection({ slug: "events", label: "Events", labelSingular: "Event" });
		await registry.createField("events", { slug: "title", label: "Title", type: "string" });
		await registry.createField("events", { slug: "event_date", label: "Date", type: "datetime" });
		await registry.createField("events", { slug: "location", label: "Location", type: "string" });
		await registry.updateCollection("events", { titleField: "title", dateField: "event_date" });

		const seed = [
			{
				slug: "e1",
				title: "Bravo",
				event_date: "2020-01-01T00:00:00.000Z",
				createdAt: "2025-06-01T00:00:00.000Z",
			},
			{
				slug: "e2",
				title: "Charlie",
				event_date: "2022-01-01T00:00:00.000Z",
				createdAt: "2024-06-01T00:00:00.000Z",
			},
			{
				slug: "e3",
				title: "Alpha",
				event_date: "2021-01-01T00:00:00.000Z",
				createdAt: "2023-06-01T00:00:00.000Z",
			},
		];
		for (const s of seed) {
			const created = await handleContentCreate(ctx.db, "events", {
				slug: s.slug,
				data: { title: s.title, event_date: s.event_date, location: "HQ" },
				createdAt: s.createdAt,
			});
			if (!created.success) throw new Error(`seed ${s.slug} failed`);
		}
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	function slugsOf(result: Awaited<ReturnType<typeof handleContentList>>): string[] {
		if (!result.success) throw new Error(`list failed: ${result.error.code}`);
		return result.data.items.map((i) => i.slug ?? "");
	}

	it("sorts by the configured dateField, not createdAt", async () => {
		const desc = await handleContentList(ctx.db, "events", {
			orderBy: "event_date",
			order: "desc",
		});
		expect(slugsOf(desc)).toEqual(["e2", "e3", "e1"]);

		const asc = await handleContentList(ctx.db, "events", { orderBy: "event_date", order: "asc" });
		expect(slugsOf(asc)).toEqual(["e1", "e3", "e2"]);
	});

	it("sorts by the configured titleField, distinct from createdAt and dateField", async () => {
		const asc = await handleContentList(ctx.db, "events", { orderBy: "title", order: "asc" });
		expect(slugsOf(asc)).toEqual(["e3", "e1", "e2"]);

		const desc = await handleContentList(ctx.db, "events", { orderBy: "title", order: "desc" });
		expect(slugsOf(desc)).toEqual(["e2", "e1", "e3"]);
	});

	it("rejects ordering by a field that isn't titleField/dateField", async () => {
		const result = await handleContentList(ctx.db, "events", { orderBy: "location" });
		expect(result.success).toBe(false);
	});

	it("rejects ordering by an unknown field", async () => {
		const result = await handleContentList(ctx.db, "events", { orderBy: "not_a_field" });
		expect(result.success).toBe(false);
	});
});
