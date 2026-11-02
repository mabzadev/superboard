import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";
import { FTSManager } from "../../../../../../packages/core/src/search/fts-manager.js";
import { getSuggestions } from "../../../../../../packages/core/src/search/query.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("getSuggestions: titleField drives the suggestion title", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
		const registry = new SchemaRegistry(db);
		const fts = new FTSManager(db);

		await registry.createCollection({
			slug: "employees",
			label: "Employees",
			supports: ["search"],
		});
		await registry.createField("employees", {
			slug: "full_name",
			label: "Full name",
			type: "string",
			searchable: true,
		});
		await registry.updateCollection("employees", { titleField: "full_name" });
		await fts.enableSearch("employees");

		const repo = new ContentRepository(db);
		await repo.create({
			type: "employees",
			slug: "jane-doe",
			status: "published",
			data: { full_name: "Jane Doe" },
		});
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("suggests the entry and uses the titleField value as the title", async () => {
		const suggestions = await getSuggestions(db, "jane", { collections: ["employees"] });
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({
			collection: "employees",
			slug: "jane-doe",
			title: "Jane Doe",
		});
	});
});
