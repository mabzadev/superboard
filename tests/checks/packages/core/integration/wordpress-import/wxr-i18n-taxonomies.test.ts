import type { Kysely } from "kysely";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { importContent } from "../../../../../../packages/core/src/astro/routes/api/import/wordpress/execute.js";
import type {
	EmDashHandlers,
	EmDashManifest,
} from "../../../../../../packages/core/src/astro/types.js";
import { parseWxrString } from "../../../../../../packages/core/src/cli/wxr/parser.js";
import { TaxonomyRepository } from "../../../../../../packages/core/src/database/repositories/taxonomy.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setI18nConfig } from "../../../../../../packages/core/src/i18n/config.js";
import {
	mirrorTermsToLocales,
	preImportWxrTaxonomies,
} from "../../../../../../packages/core/src/import/wxr-taxonomies.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";
import { handlersFromRuntime, createTestRuntime } from "../../utils/mcp-runtime.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

interface Harness {
	db: Kysely<Database>;
	emdash: EmDashHandlers;
	manifest: EmDashManifest;
}

async function setup(): Promise<Harness> {
	const db = await setupTestDatabase();
	const registry = new SchemaRegistry(db);

	await registry.createCollection({
		slug: "post",
		label: "Posts",
		labelSingular: "Post",
	});
	await registry.createField("post", { slug: "title", label: "Title", type: "string" });
	await registry.createField("post", {
		slug: "content",
		label: "Content",
		type: "portableText",
	});
	await registry.createField("post", { slug: "excerpt", label: "Excerpt", type: "text" });

	await db
		.updateTable("_emdash_taxonomy_defs")
		.set({ collections: JSON.stringify(["post"]) })
		.where("name", "in", ["category", "tag"])
		.execute();

	const runtime = createTestRuntime(db);
	const emdash = handlersFromRuntime(runtime);
	const manifest = await emdash.getManifest();
	return { db, emdash, manifest };
}

async function runImport(
	harness: Harness,
	wxrText: string,
	opts: { locale?: string; skipExisting?: boolean } = {},
) {
	const wxrData = await parseWxrString(wxrText);
	const plan = await preImportWxrTaxonomies(
		harness.db,
		wxrData.posts,
		wxrData.categories,
		wxrData.tags,
		wxrData.terms,
		opts.locale,
	);

	const postLocales = new Set<string>();
	for (const post of wxrData.posts) {
		if (post.locale) postLocales.add(post.locale);
	}
	if (postLocales.size > 0) {
		await mirrorTermsToLocales(harness.db, plan, postLocales, opts.locale);
	}

	const result = await importContent(
		wxrData.posts,
		{
			postTypeMappings: { post: { collection: "post", enabled: true } },
			skipExisting: opts.skipExisting ?? false,
		},
		harness.emdash,
		harness.manifest,
		new Map(),
		opts.locale,
		undefined,
		plan,
	);

	return { wxrData, plan, result };
}

describe("WXR import: WPML translations (#1080)", () => {
	let harness: Harness;

	beforeEach(async () => {
		harness = await setup();
	});

	afterEach(async () => {
		await teardownTestDatabase(harness.db);
	});

	it("imports each translation under its own locale and links them via translation_group", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[en]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[ar]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });

		expect(result.errors).toEqual([]);
		expect(result.imported).toBe(2);

		const rows = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id", "slug", "locale", "translation_group"])
			.execute();
		expect(rows).toHaveLength(2);

		const enRow = rows.find((r) => r.locale === "en");
		const arRow = rows.find((r) => r.locale === "ar");
		expect(enRow).toBeDefined();
		expect(arRow).toBeDefined();
		expect(enRow?.slug).toBe("hello");
		expect(arRow?.slug).toBe("hello");

		expect(enRow?.translation_group).toBeDefined();
		expect(enRow?.translation_group).toBe(arRow?.translation_group);
	});

	it("links translations correctly when they arrive in non-canonical order", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[news]]></wp:category_nicename>
      <wp:cat_name><![CDATA[News]]></wp:cat_name>
    </wp:category>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[ar]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[en]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });

		expect(result.errors).toEqual([]);
		expect(result.imported).toBe(2);

		const rows = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id", "locale", "translation_group"])
			.execute();
		expect(rows).toHaveLength(2);
		const enRow = rows.find((r) => r.locale === "en");
		const arRow = rows.find((r) => r.locale === "ar");
		expect(enRow?.translation_group).toBeDefined();
		expect(enRow?.translation_group).toBe(arRow?.translation_group);

		const repo = new TaxonomyRepository(harness.db);
		const enTerms = await repo.getTermsForEntry("post", enRow!.id, "category", "en");
		const arTerms = await repo.getTermsForEntry("post", arRow!.id, "category", "ar");
		expect(enTerms.map((t) => t.slug)).toEqual(["news"]);
		expect(arTerms.map((t) => t.slug)).toEqual(["news"]);
	});

	it("falls back to the upload-wide locale when a post has no WPML/Polylang metadata", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <item>
      <title>Mono</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>mono</wp:post_name>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "fr" });

		expect(result.imported).toBe(1);
		const rows = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["locale"])
			.execute();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.locale).toBe("fr");
	});

	it("mirrors terms into each translation's locale so per-locale lookups work", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[patents]]></wp:category_nicename>
      <wp:cat_name><![CDATA[Patents]]></wp:cat_name>
    </wp:category>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="patents"><![CDATA[Patents]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[en]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[7]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="patents"><![CDATA[Patents]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[ar]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[7]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });

		expect(result.errors).toEqual([]);
		expect(result.imported).toBe(2);

		const repo = new TaxonomyRepository(harness.db);

		const enRow = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id"])
			.where("locale", "=", "en")
			.executeTakeFirstOrThrow();
		const enTerms = await repo.getTermsForEntry("post", enRow.id, "category", "en");
		expect(enTerms.map((t) => t.slug)).toContain("patents");

		const arRow = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id"])
			.where("locale", "=", "ar")
			.executeTakeFirstOrThrow();
		const arTerms = await repo.getTermsForEntry("post", arRow.id, "category", "ar");
		expect(arTerms).toHaveLength(1);
		expect(arTerms[0]?.slug).toBe("patents");
		expect(arTerms[0]?.locale).toBe("ar");
	});

	it("preserves inherited assignments for taxonomies the translation doesn't override", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[news]]></wp:category_nicename>
      <wp:cat_name><![CDATA[News]]></wp:cat_name>
    </wp:category>
    <wp:category>
      <wp:term_id>6</wp:term_id>
      <wp:category_nicename><![CDATA[events]]></wp:category_nicename>
      <wp:cat_name><![CDATA[Events]]></wp:cat_name>
    </wp:category>
    <wp:tag>
      <wp:term_id>100</wp:term_id>
      <wp:tag_slug><![CDATA[breaking]]></wp:tag_slug>
      <wp:tag_name><![CDATA[Breaking]]></wp:tag_name>
    </wp:tag>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <category domain="post_tag" nicename="breaking"><![CDATA[Breaking]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[en]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[7]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="events"><![CDATA[Events]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[ar]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[7]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });
		expect(result.errors).toEqual([]);

		const repo = new TaxonomyRepository(harness.db);

		const arRow = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id"])
			.where("locale", "=", "ar")
			.executeTakeFirstOrThrow();

		const arCategories = await repo.getTermsForEntry("post", arRow.id, "category", "ar");
		expect(arCategories.map((t) => t.slug)).toEqual(["events"]);

		const arTags = await repo.getTermsForEntry("post", arRow.id, "tag", "ar");
		expect(arTags.map((t) => t.slug)).toEqual(["breaking"]);
	});

	it("inherits anchor's full term set when translation has no per-item assignments", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[news]]></wp:category_nicename>
      <wp:cat_name><![CDATA[News]]></wp:cat_name>
    </wp:category>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[en]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[7]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[ar]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[7]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });
		expect(result.errors).toEqual([]);

		const repo = new TaxonomyRepository(harness.db);
		const arRow = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id"])
			.where("locale", "=", "ar")
			.executeTakeFirstOrThrow();
		const arCategories = await repo.getTermsForEntry("post", arRow.id, "category", "ar");
		expect(arCategories.map((t) => t.slug)).toEqual(["news"]);
	});

	it("applies translated taxonomy assignments to the shared content group", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[news]]></wp:category_nicename>
      <wp:cat_name><![CDATA[News]]></wp:cat_name>
    </wp:category>
    <wp:category>
      <wp:term_id>6</wp:term_id>
      <wp:category_nicename><![CDATA[events]]></wp:category_nicename>
      <wp:cat_name><![CDATA[Events]]></wp:cat_name>
    </wp:category>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[en]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[7]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="events"><![CDATA[Events]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[ar]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[7]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });
		expect(result.errors).toEqual([]);

		const repo = new TaxonomyRepository(harness.db);

		const enRow = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id"])
			.where("locale", "=", "en")
			.executeTakeFirstOrThrow();
		const enTerms = await repo.getTermsForEntry("post", enRow.id, "category", "en");
		const enTermSlugs = enTerms.map((t) => t.slug);

		const arRow = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id"])
			.where("locale", "=", "ar")
			.executeTakeFirstOrThrow();
		const arTerms = await repo.getTermsForEntry("post", arRow.id, "category", "ar");
		const arTermSlugs = arTerms.map((t) => t.slug);

		expect(enTermSlugs).toEqual(["events"]);
		expect(arTermSlugs).toEqual(["events"]);
	});
});

describe("WXR import: taxonomy ingest (#1061)", () => {
	let harness: Harness;

	beforeEach(async () => {
		harness = await setup();
	});

	afterEach(async () => {
		await teardownTestDatabase(harness.db);
	});

	it("creates taxonomy terms from <wp:category> / <wp:tag> defs and links per-post assignments", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[patents]]></wp:category_nicename>
      <wp:cat_name><![CDATA[Patents]]></wp:cat_name>
    </wp:category>
    <wp:tag>
      <wp:term_id>497</wp:term_id>
      <wp:tag_slug><![CDATA[microwave]]></wp:tag_slug>
      <wp:tag_name><![CDATA[Microwave]]></wp:tag_name>
    </wp:tag>
    <item>
      <title>Filed Patent</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>filed-patent</wp:post_name>
      <category domain="category" nicename="patents"><![CDATA[Patents]]></category>
      <category domain="post_tag" nicename="microwave"><![CDATA[Microwave]]></category>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });

		expect(result.errors).toEqual([]);
		expect(result.imported).toBe(1);

		const repo = new TaxonomyRepository(harness.db);
		const categories = await repo.findByName("category");
		const tags = await repo.findByName("tag");
		expect(categories.some((c) => c.slug === "patents")).toBe(true);
		expect(tags.some((t) => t.slug === "microwave")).toBe(true);

		const post = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id"])
			.executeTakeFirst();
		expect(post).toBeDefined();
		const assigned = await repo.getTermsForEntry("post", post!.id);
		const assignedSlugs = assigned.map((t) => `${t.name}:${t.slug}`);
		expect(assignedSlugs).toContain("category:patents");
		expect(assignedSlugs).toContain("tag:microwave");
	});

	it("surfaces custom taxonomies in missingTaxonomies when no EmDash def exists", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:term>
      <wp:term_id>10</wp:term_id>
      <wp:term_taxonomy>genre</wp:term_taxonomy>
      <wp:term_slug><![CDATA[sci-fi]]></wp:term_slug>
      <wp:term_name><![CDATA[Science Fiction]]></wp:term_name>
    </wp:term>
    <item>
      <title>Dune</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>dune</wp:post_name>
      <category domain="genre" nicename="sci-fi"><![CDATA[Science Fiction]]></category>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });

		expect(result.errors).toEqual([]);
		expect(result.imported).toBe(1);
		expect(result.taxonomies?.missingTaxonomies).toContain("genre");

		const def = await harness.db
			.selectFrom("_emdash_taxonomy_defs")
			.select(["name"])
			.where("name", "=", "genre")
			.executeTakeFirst();
		expect(def).toBeUndefined();
	});

	it("strips Polylang's `language` customTaxonomy so it isn't attached as a content taxonomy", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <item>
      <title>Bonjour</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>bonjour</wp:post_name>
      <category domain="language" nicename="fr"><![CDATA[Français]]></category>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "fr" });

		expect(result.errors).toEqual([]);
		expect(result.taxonomies?.missingTaxonomies ?? []).not.toContain("language");
		expect(result.taxonomies?.assignments).toBe(0);
	});

	it("reports newly-created and re-used terms separately in result.taxonomies", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[news]]></wp:category_nicename>
      <wp:cat_name><![CDATA[News]]></wp:cat_name>
    </wp:category>
    <item>
      <title>A</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>a</wp:post_name>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
    </item>
  </channel>
</rss>`;

		const { result: first } = await runImport(harness, wxr, { locale: "en" });
		expect(first.taxonomies?.termsCreated.category).toBe(1);
		expect(first.taxonomies?.termsReused.category ?? 0).toBe(0);

		const second = await runImport(
			harness,
			wxr
				.replace("<wp:post_id>1</wp:post_id>", "<wp:post_id>2</wp:post_id>")
				.replace("<wp:post_name>a</wp:post_name>", "<wp:post_name>b</wp:post_name>"),
			{ locale: "en" },
		);
		expect(second.result.taxonomies?.termsCreated.category ?? 0).toBe(0);
		expect(second.result.taxonomies?.termsReused.category).toBe(1);
	});

	it("resolves seeded taxonomy defs via locale fallback chain (#1087 review HIGH #1)", async () => {
		setI18nConfig({ defaultLocale: "en", locales: ["en", "ar"] });
		try {
			const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[akhbar]]></wp:category_nicename>
      <wp:cat_name><![CDATA[Akhbar]]></wp:cat_name>
    </wp:category>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello-ar</wp:post_name>
      <category domain="category" nicename="akhbar"><![CDATA[Akhbar]]></category>
    </item>
  </channel>
</rss>`;

			const { result } = await runImport(harness, wxr, { locale: "ar" });

			expect(result.errors).toEqual([]);
			expect(result.taxonomies?.missingTaxonomies ?? []).not.toContain("category");
			const repo = new TaxonomyRepository(harness.db);
			const arabicCategories = await repo.findByName("category", { locale: "ar" });
			expect(arabicCategories.some((t) => t.slug === "akhbar")).toBe(true);
		} finally {
			setI18nConfig(null);
		}
	});

	it("captures per-item category text body as the term label (#1087 review LOW #8)", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="breaking-news"><![CDATA[Breaking News]]></category>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });
		expect(result.errors).toEqual([]);

		const repo = new TaxonomyRepository(harness.db);
		const term = await repo.findBySlug("category", "breaking-news");
		expect(term).toBeDefined();
		expect(term?.label).toBe("Breaking News");
	});

	it("preserves inherited taxonomy when translation's only assignment is filtered out by collections (#1087 review MEDIUM #4)", async () => {
		await harness.db
			.updateTable("_emdash_taxonomy_defs")
			.set({ collections: JSON.stringify(["editorials"]) })
			.where("name", "=", "category")
			.execute();

		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[news]]></wp:category_nicename>
      <wp:cat_name><![CDATA[News]]></wp:cat_name>
    </wp:category>
    <wp:category>
      <wp:term_id>6</wp:term_id>
      <wp:category_nicename><![CDATA[events]]></wp:category_nicename>
      <wp:cat_name><![CDATA[Events]]></wp:cat_name>
    </wp:category>
    <wp:tag>
      <wp:term_id>100</wp:term_id>
      <wp:tag_slug><![CDATA[breaking]]></wp:tag_slug>
      <wp:tag_name><![CDATA[Breaking]]></wp:tag_name>
    </wp:tag>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <category domain="post_tag" nicename="breaking"><![CDATA[Breaking]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[en]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>trid</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="events"><![CDATA[Events]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[ar]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>trid</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });
		expect(result.errors).toEqual([]);
		expect(result.imported).toBe(2);

		const repo = new TaxonomyRepository(harness.db);
		const arRow = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["id"])
			.where("locale", "=", "ar")
			.executeTakeFirstOrThrow();

		const arCategories = await repo.getTermsForEntry("post", arRow.id, "category", "ar");
		expect(arCategories).toHaveLength(0);

		const arTags = await repo.getTermsForEntry("post", arRow.id, "tag", "ar");
		expect(arTags.map((t) => t.slug)).toEqual(["breaking"]);
	});

	it("fails closed when a pre-existing locale row has an incompatible translation_group", async () => {
		const repo = new TaxonomyRepository(harness.db);

		const enRow = await repo.create({
			name: "category",
			slug: "news",
			label: "News",
			locale: "en",
		});
		await repo.create({
			name: "category",
			slug: "news",
			label: "Akhbar",
			locale: "ar",
		});

		const en = await repo.findById(enRow.id);
		const arRow = await repo.findBySlug("category", "news", "ar");
		expect(en?.translationGroup).not.toBe(arRow?.translationGroup);

		setI18nConfig({ defaultLocale: "en", locales: ["en", "ar"] });
		try {
			const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:category>
      <wp:term_id>5</wp:term_id>
      <wp:category_nicename><![CDATA[news]]></wp:category_nicename>
      <wp:cat_name><![CDATA[News]]></wp:cat_name>
    </wp:category>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[en]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>trid</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello-ar</wp:post_name>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[ar]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>trid</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

			await expect(runImport(harness, wxr, { locale: "en" })).rejects.toMatchObject({
				name: "WxrTaxonomyConflictError",
				publicMessage: expect.stringMatching(/translation group/i) as unknown as string,
			});
		} finally {
			setI18nConfig(null);
		}
	});

	it("uses WPML `trid` rather than `_icl_translation_id` as the group key (#1087 review MEDIUM #2)", async () => {
		const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <item>
      <title>Hello</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello-en</wp:post_name>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[en]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[100]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>trid</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Mərhəba</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <wp:post_name>hello-ar</wp:post_name>
      <wp:postmeta>
        <wp:meta_key>_icl_lang_code</wp:meta_key>
        <wp:meta_value><![CDATA[ar]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_icl_translation_id</wp:meta_key>
        <wp:meta_value><![CDATA[101]]></wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>trid</wp:meta_key>
        <wp:meta_value><![CDATA[42]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

		const { result } = await runImport(harness, wxr, { locale: "en" });
		expect(result.errors).toEqual([]);
		expect(result.imported).toBe(2);

		const rows = await harness.db
			.selectFrom("ec_post" as keyof Database)
			.select(["locale", "translation_group"])
			.execute();
		expect(rows).toHaveLength(2);
		const groups = new Set(rows.map((r) => r.translation_group));
		expect(groups.size).toBe(1);
	});
});
