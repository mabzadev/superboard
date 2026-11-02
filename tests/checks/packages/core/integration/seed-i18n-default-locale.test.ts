import type { Kysely } from "kysely";
import { ulid } from "ulidx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportSeed } from "../../../../../packages/core/src/cli/commands/export-seed.js";
import type { Database } from "../../../../../packages/core/src/database/types.js";
import { setI18nConfig } from "../../../../../packages/core/src/i18n/config.js";
import { applySeed } from "../../../../../packages/core/src/seed/apply.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../utils/test-db.js";

describe("seed round-trip preserves a non-en default locale (#1421)", () => {
	let source: Kysely<Database>;
	let target: Kysely<Database>;

	beforeEach(() => {
		setI18nConfig(null);
	});

	afterEach(async () => {
		if (source) await teardownTestDatabase(source);
		if (target) await teardownTestDatabase(target);
		setI18nConfig(null);
	});

	it("keeps menus, taxonomies, and content at their real default locale", async () => {
		source = await setupTestDatabaseWithCollections();
		const now = new Date().toISOString();

		await source.updateTable("_emdash_taxonomy_defs").set({ locale: "de" }).execute();

		await source
			.insertInto("_emdash_menus")
			.values({
				id: ulid(),
				name: "primary",
				label: "Hauptmenü",
				created_at: now,
				updated_at: now,
				locale: "de",
				translation_group: ulid(),
			})
			.execute();

		await source
			.insertInto("_emdash_taxonomy_defs")
			.values({
				id: ulid(),
				name: "genre",
				label: "Kategorien",
				hierarchical: 0,
				collections: JSON.stringify(["post"]),
				created_at: now,
				locale: "de",
				translation_group: ulid(),
			})
			.execute();

		await source
			.insertInto("ec_post")
			.values({
				id: ulid(),
				slug: "hallo",
				status: "published",
				created_at: now,
				updated_at: now,
				version: 1,
				locale: "de",
				translation_group: ulid(),
				title: "Hallo",
			} as never)
			.execute();

		const seed = await exportSeed(source, "post");

		target = await setupTestDatabaseWithCollections();
		await applySeed(target, seed, { includeContent: true });

		const menu = await target
			.selectFrom("_emdash_menus")
			.select("locale")
			.where("name", "=", "primary")
			.executeTakeFirstOrThrow();
		expect(menu.locale).toBe("de");

		const def = await target
			.selectFrom("_emdash_taxonomy_defs")
			.select("locale")
			.where("name", "=", "genre")
			.executeTakeFirstOrThrow();
		expect(def.locale).toBe("de");

		const post = await target
			.selectFrom("ec_post")
			.select("locale")
			.where("slug", "=", "hallo")
			.executeTakeFirstOrThrow();
		expect(post.locale).toBe("de");
	});
});
