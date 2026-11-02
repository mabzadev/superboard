import type { Kysely } from "kysely";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { handleContentPermanentDelete } from "../../../../../../packages/core/src/api/handlers/content.js";
import { createDatabase } from "../../../../../../packages/core/src/database/connection.js";
import { runMigrations } from "../../../../../../packages/core/src/database/migrations/runner.js";
import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";

describe("handleContentPermanentDelete — trash-state guard", () => {
	let db: Kysely<Database>;
	let repo: ContentRepository;

	beforeEach(async () => {
		db = createDatabase({ url: ":memory:" });
		await runMigrations(db);
		repo = new ContentRepository(db);
		const registry = new SchemaRegistry(db);

		await registry.createCollection({
			slug: "post",
			label: "Posts",
			labelSingular: "Post",
		});
		await registry.createField("post", {
			slug: "title",
			label: "Title",
			type: "string",
		});
	});

	afterEach(async () => {
		await db.destroy();
	});

	it("refuses to permanently delete a live (non-trashed) item", async () => {
		const item = await repo.create({ type: "post", data: { title: "Live post" } });

		const result = await handleContentPermanentDelete(db, "post", item.id);

		expect(result.success).toBe(false);

		const survivor = await repo.findById("post", item.id);
		expect(survivor?.id).toBe(item.id);
	});

	it("fails for a nonexistent id without touching the database", async () => {
		const result = await handleContentPermanentDelete(db, "post", "01HZZZZZZZZZZZZZZZZZZZZZZZ");

		expect(result.success).toBe(false);
	});

	it("permanently deletes a trashed item (happy path preserved)", async () => {
		const item = await repo.create({ type: "post", data: { title: "To trash" } });
		const softDeleted = await repo.delete("post", item.id);
		expect(softDeleted).toBe(true);

		const result = await handleContentPermanentDelete(db, "post", item.id);

		expect(result.success).toBe(true);

		const survivor = await repo.findByIdOrSlugIncludingTrashed("post", item.id);
		expect(survivor).toBeNull();
	});
});
