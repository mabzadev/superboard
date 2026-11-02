import { it, expect, beforeEach, afterEach } from "vitest";

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

describeEachDialect("content list server-side search (#1219)", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		const registry = new SchemaRegistry(ctx.db);
		await registry.createCollection({ slug: "posts", label: "Posts", labelSingular: "Post" });
		await registry.createField("posts", { slug: "title", label: "Title", type: "string" });
		await registry.createField("posts", {
			slug: "ticket_number",
			label: "Ticket number",
			type: "integer",
			searchable: true,
		});

		for (let i = 0; i < 60; i++) {
			const created = await handleContentCreate(ctx.db, "posts", {
				slug: `post-${String(i).padStart(3, "0")}`,
				data: { title: `Ordinary Post ${i}` },
			});
			if (!created.success) throw new Error("seed failed");
		}
		const needle = await handleContentCreate(ctx.db, "posts", {
			slug: "the-needle-post",
			data: { title: "zzz Needle Headline", ticket_number: 2179 },
		});
		if (!needle.success) throw new Error("needle seed failed");

		const pct = await handleContentCreate(ctx.db, "posts", {
			slug: "percent-post",
			data: { title: "50% off sale" },
		});
		if (!pct.success) throw new Error("percent seed failed");
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	function titlesOf(result: {
		success: boolean;
		data?: { items: { data: Record<string, unknown> }[] };
	}) {
		if (!result.success || !result.data) throw new Error("list failed");
		return result.data.items.map((i) => i.data.title as string);
	}

	it("finds an entry that lives far past the first page", async () => {
		const result = await handleContentList(ctx.db, "posts", { q: "Needle", limit: 20 });
		expect(titlesOf(result)).toContain("zzz Needle Headline");
	});

	it("matches case-insensitively", async () => {
		const result = await handleContentList(ctx.db, "posts", { q: "needle", limit: 20 });
		expect(titlesOf(result)).toContain("zzz Needle Headline");

		const upper = await handleContentList(ctx.db, "posts", { q: "NEEDLE", limit: 20 });
		expect(titlesOf(upper)).toContain("zzz Needle Headline");
	});

	it("searches the slug as well as the title", async () => {
		const result = await handleContentList(ctx.db, "posts", { q: "the-needle-post", limit: 20 });
		expect(titlesOf(result)).toContain("zzz Needle Headline");
	});

	it("searches custom fields marked searchable", async () => {
		const result = await handleContentList(ctx.db, "posts", { q: "2179", limit: 20 });
		expect(titlesOf(result)).toContain("zzz Needle Headline");
	});

	it("treats LIKE wildcards in the query literally", async () => {
		const result = await handleContentList(ctx.db, "posts", { q: "50%", limit: 100 });
		const titles = titlesOf(result);
		expect(titles).toContain("50% off sale");
		expect(titles).not.toContain("Ordinary Post 0");
	});

	it("returns the full unfiltered list when no query is given", async () => {
		const result = await handleContentList(ctx.db, "posts", { limit: 20 });
		if (!result.success) throw new Error("list failed");
		expect(result.data.items).toHaveLength(20);
		expect(result.data.total).toBe(62);
	});
});
