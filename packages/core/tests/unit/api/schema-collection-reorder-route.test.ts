import type { APIContext } from "astro";
import { expect, test } from "vitest";

import { POST } from "../../../src/astro/routes/api/schema/collections/reorder.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

test("the collection reorder HTTP route persists sidebar order through its exported handler", async () => {
	const db = await setupTestDatabase();
	try {
		const registry = new SchemaRegistry(db);
		await registry.createCollection({ slug: "first", label: "First", labelSingular: "First" });
		await registry.createCollection({ slug: "second", label: "Second", labelSingular: "Second" });
		const request = new Request("https://site.test/_emdash/api/schema/collections/reorder", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slugs: ["second", "first"] }),
		});
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route consumes these Astro fields and uses the real migrated database.
		const response = await POST({
			request,
			locals: { emdash: { db }, user: { id: "owner", role: 50 } },
		} as unknown as APIContext);
		expect(response.status).toBe(200);
		expect(
			await db.selectFrom("_emdash_collections").select("slug").orderBy("sort_order").execute(),
		).toEqual([{ slug: "second" }, { slug: "first" }]);
	} finally {
		await teardownTestDatabase(db);
	}
});
