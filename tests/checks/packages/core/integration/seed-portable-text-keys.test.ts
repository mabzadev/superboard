import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateContentData } from "../../../../../packages/core/src/api/handlers/validation.js";
import type { Database } from "../../../../../packages/core/src/database/types.js";
import { applySeed } from "../../../../../packages/core/src/seed/apply.js";
import type { SeedFile } from "../../../../../packages/core/src/seed/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../utils/test-db.js";

const WORKSPACE_ROOT = resolve(import.meta.dirname, "../../../../..");

const TEMPLATE_SEEDS = [
	"templates/blog/seed/seed.json",
	"templates/blog-cloudflare/seed/seed.json",
	"templates/portfolio/seed/seed.json",
	"templates/portfolio-cloudflare/seed/seed.json",
	"templates/starter/seed/seed.json",
	"templates/starter-cloudflare/seed/seed.json",
	"templates/marketing/seed/seed.json",
	"templates/marketing-cloudflare/seed/seed.json",
] as const;

function loadSeed(rel: string): SeedFile {
	const abs = resolve(WORKSPACE_ROOT, rel);
	return JSON.parse(readFileSync(abs, "utf8")) as SeedFile;
}

function collectionsWithContent(seed: SeedFile): string[] {
	if (!seed.content) return [];
	const out: string[] = [];
	for (const [slug, entries] of Object.entries(seed.content)) {
		if (Array.isArray(entries) && entries.length > 0) out.push(slug);
	}
	return out;
}

describe("shipped template seeds survive the autosave validator (issue #867)", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	for (const rel of TEMPLATE_SEEDS) {
		it(`${rel}: every seeded entry round-trips through validateContentData`, async () => {
			const seed = loadSeed(rel);

			await applySeed(db, seed, {
				includeContent: true,
				skipMediaDownload: true,
			});

			const slugs = collectionsWithContent(seed);
			if (slugs.length === 0) {
				return;
			}

			for (const slug of slugs) {
				const tableName = `ec_${slug}`;
				const rows = await db
					// biome-ignore lint/suspicious/noExplicitAny: dynamic content table
					.selectFrom(tableName as any)
					.selectAll()
					.where("deleted_at", "is", null)
					// biome-ignore lint/suspicious/noExplicitAny: dynamic content table
					.execute();

				expect(rows.length, `expected at least one row in ${tableName}`).toBeGreaterThan(0);

				for (const row of rows as Array<Record<string, unknown>>) {
					const data: Record<string, unknown> = {};
					for (const [k, v] of Object.entries(row)) {
						if (
							k === "id" ||
							k === "slug" ||
							k === "status" ||
							k === "author_id" ||
							k === "primary_byline_id" ||
							k === "created_at" ||
							k === "updated_at" ||
							k === "published_at" ||
							k === "scheduled_at" ||
							k === "deleted_at" ||
							k === "version" ||
							k === "live_revision_id" ||
							k === "draft_revision_id" ||
							k === "locale" ||
							k === "translation_group"
						) {
							continue;
						}
						if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
							try {
								data[k] = JSON.parse(v);
								continue;
							} catch {}
						}
						data[k] = v;
					}

					const result = await validateContentData(db, slug, data, { partial: true });
					if (!("ok" in result) || !result.ok) {
						const message = result.ok ? "(unexpected)" : result.error.message;
						throw new Error(
							`${rel}: row in ${tableName} (slug=${row.slug as string}) failed validation: ${message}`,
						);
					}
				}
			}
		});
	}
});
