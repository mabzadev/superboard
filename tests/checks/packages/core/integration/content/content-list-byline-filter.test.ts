import { sql } from "kysely";
import { beforeEach, afterEach, expect, it } from "vitest";

import {
	handleContentCreate,
	handleContentList,
} from "../../../../../../packages/core/src/api/handlers/content.js";
import { BylineRepository } from "../../../../../../packages/core/src/database/repositories/byline.js";
import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import { UserRepository } from "../../../../../../packages/core/src/database/repositories/user.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("content list byline filter", (dialect) => {
	let ctx: DialectTestContext;
	let adaGroup: string;
	let graceGroup: string;
	let turingGroup: string;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		const registry = new SchemaRegistry(ctx.db);
		await registry.createCollection({ slug: "posts", label: "Posts", labelSingular: "Post" });
		await registry.createField("posts", { slug: "title", label: "Title", type: "string" });

		const users = new UserRepository(ctx.db);
		const turingUser = await users.create({ email: "turing@example.com", name: "Turing" });

		const bylines = new BylineRepository(ctx.db);
		const ada = await bylines.create({ slug: "ada", displayName: "Ada Lovelace" });
		const grace = await bylines.create({ slug: "grace", displayName: "Grace Hopper" });
		const turing = await bylines.create({
			slug: "turing",
			displayName: "Alan Turing",
			userId: turingUser.id,
		});
		adaGroup = ada.translationGroup ?? ada.id;
		graceGroup = grace.translationGroup ?? grace.id;
		turingGroup = turing.translationGroup ?? turing.id;

		const seed = [
			{ slug: "ada-only", title: "Ada only", bylines: [ada.id] },
			{ slug: "grace-only", title: "Grace only", bylines: [grace.id] },
			{ slug: "both", title: "Both", bylines: [ada.id, grace.id] },
			{ slug: "uncredited", title: "Uncredited", bylines: [] },
			{ slug: "inferred", title: "Inferred", bylines: [], authorId: turingUser.id },
		];
		for (const s of seed) {
			const created = await handleContentCreate(ctx.db, "posts", {
				slug: s.slug,
				data: { title: s.title },
				authorId: s.authorId,
				bylines: s.bylines.map((bylineId) => ({ bylineId })),
			});
			if (!created.success) throw new Error(`seed ${s.slug} failed`);
		}
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	function slugsOf(result: {
		success: boolean;
		data?: { items: { slug: string | null }[] };
	}): string[] {
		if (!result.success || !result.data) throw new Error("list failed");
		return result.data.items.map((i) => i.slug ?? "").toSorted();
	}

	it("matches entries credited to the selected byline", async () => {
		const result = await handleContentList(ctx.db, "posts", { bylines: [adaGroup] });
		expect(slugsOf(result)).toEqual(["ada-only", "both"]);
	});

	it("matches entries credited to any of several bylines", async () => {
		const result = await handleContentList(ctx.db, "posts", {
			bylines: [adaGroup, graceGroup],
		});
		expect(slugsOf(result)).toEqual(["ada-only", "both", "grace-only"]);
	});

	it("reports a total that reflects the byline filter", async () => {
		const result = await handleContentList(ctx.db, "posts", { bylines: [adaGroup] });
		if (!result.success) throw new Error("list failed");
		expect(result.data.total).toBe(2);
	});

	it("matches entries with no byline credit", async () => {
		const result = await handleContentList(ctx.db, "posts", { bylinesNone: true });
		expect(slugsOf(result)).toEqual(["inferred", "uncredited"]);
	});

	it("ignores bylines inferred from the author by default", async () => {
		const result = await handleContentList(ctx.db, "posts", { bylines: [turingGroup] });
		expect(slugsOf(result)).toEqual([]);
	});

	it("matches inferred bylines when opted in", async () => {
		const result = await handleContentList(ctx.db, "posts", {
			bylines: [turingGroup],
			includeInferredBylines: true,
		});
		expect(slugsOf(result)).toEqual(["inferred"]);
	});

	it("excludes entries with an inferred byline from the no-byline filter when opted in", async () => {
		const result = await handleContentList(ctx.db, "posts", {
			bylinesNone: true,
			includeInferredBylines: true,
		});
		expect(slugsOf(result)).toEqual(["uncredited"]);
	});

	it("does not infer a credit for an entry that already has one", async () => {
		const bylines = new BylineRepository(ctx.db);
		const ada = await bylines.findBySlug("ada");
		if (!ada) throw new Error("ada byline missing");
		await bylines.setContentBylines("posts", await idOfSlug("inferred"), [{ bylineId: ada.id }]);

		const result = await handleContentList(ctx.db, "posts", {
			bylines: [turingGroup],
			includeInferredBylines: true,
		});
		expect(slugsOf(result)).toEqual([]);
	});

	it("resolves inferred credits at the locale the list is scoped to", async () => {
		const id = await idOfSlug("inferred");
		const bylines = new BylineRepository(ctx.db);
		const turing = await bylines.findBySlug("turing");
		if (!turing) throw new Error("turing byline missing");
		await bylines.create({
			slug: "turing-fr",
			displayName: "Alan Turing",
			locale: "fr",
			translationOf: turing.id,
		});
		await sql`UPDATE ${sql.ref("ec_posts")} SET locale = 'fr' WHERE id = ${id}`.execute(ctx.db);

		const list = await handleContentList(ctx.db, "posts", { locale: "fr" });
		if (!list.success) throw new Error("list failed");
		expect(list.data.items.find((i) => i.slug === "inferred")?.bylines).toEqual([]);

		const matched = await handleContentList(ctx.db, "posts", {
			locale: "fr",
			bylines: [turingGroup],
			includeInferredBylines: true,
		});
		expect(slugsOf(matched)).toEqual([]);

		const none = await handleContentList(ctx.db, "posts", {
			locale: "fr",
			bylinesNone: true,
			includeInferredBylines: true,
		});
		expect(slugsOf(none)).toEqual(["inferred"]);
	});

	it("ignores an explicit credit that does not resolve at the list's locale", async () => {
		const id = await idOfSlug("ada-only");
		await sql`UPDATE ${sql.ref("ec_posts")} SET locale = 'fr' WHERE id = ${id}`.execute(ctx.db);

		const list = await handleContentList(ctx.db, "posts", { locale: "fr" });
		if (!list.success) throw new Error("list failed");
		expect(list.data.items.find((i) => i.slug === "ada-only")?.bylines).toEqual([]);

		const matched = await handleContentList(ctx.db, "posts", {
			locale: "fr",
			bylines: [adaGroup],
		});
		expect(slugsOf(matched)).toEqual([]);

		const none = await handleContentList(ctx.db, "posts", { locale: "fr", bylinesNone: true });
		expect(slugsOf(none)).toEqual(["ada-only"]);
	});

	it("does not infer a credit for an entry whose explicit credit fails to resolve", async () => {
		const bylines = new BylineRepository(ctx.db);
		const ada = await bylines.findBySlug("ada");
		const turing = await bylines.findBySlug("turing");
		if (!ada || !turing) throw new Error("byline missing");
		await bylines.create({
			slug: "turing-fr",
			displayName: "Alan Turing",
			locale: "fr",
			translationOf: turing.id,
			userId: turing.userId ?? undefined,
		});

		const created = await handleContentCreate(ctx.db, "posts", {
			slug: "credited-fr",
			data: { title: "Credited FR" },
			authorId: turing.userId ?? undefined,
			bylines: [{ bylineId: ada.id }],
		});
		if (!created.success) throw new Error("seed credited-fr failed");
		await sql`UPDATE ${sql.ref("ec_posts")} SET locale = 'fr' WHERE id = ${
			created.data.item.id
		}`.execute(ctx.db);

		const list = await handleContentList(ctx.db, "posts", { locale: "fr" });
		if (!list.success) throw new Error("list failed");
		expect(list.data.items.find((i) => i.slug === "credited-fr")?.bylines).toEqual([]);

		const matched = await handleContentList(ctx.db, "posts", {
			locale: "fr",
			bylines: [turingGroup],
			includeInferredBylines: true,
		});
		expect(slugsOf(matched)).toEqual([]);

		const none = await handleContentList(ctx.db, "posts", {
			locale: "fr",
			bylinesNone: true,
			includeInferredBylines: true,
		});
		expect(slugsOf(none)).toEqual(["credited-fr"]);
	});

	it("composes with the status filter", async () => {
		const result = await handleContentList(ctx.db, "posts", {
			bylines: [adaGroup, graceGroup],
			status: "published",
		});
		expect(slugsOf(result)).toEqual([]);
	});

	it("matches nothing when the selected byline has no entries", async () => {
		const result = await handleContentList(ctx.db, "posts", {
			bylines: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"],
		});
		expect(slugsOf(result)).toEqual([]);
	});

	it("matches nothing when a repository caller passes an empty byline list", async () => {
		const repo = new ContentRepository(ctx.db);
		const result = await repo.findMany("posts", {
			where: { bylineFilter: { mode: "any", bylineIds: [] } },
		});
		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});

	async function idOfSlug(slug: string): Promise<string> {
		const list = await handleContentList(ctx.db, "posts", {});
		if (!list.success) throw new Error("list failed");
		const item = list.data.items.find((i) => i.slug === slug);
		if (!item) throw new Error(`no entry with slug ${slug}`);
		return item.id;
	}
});
