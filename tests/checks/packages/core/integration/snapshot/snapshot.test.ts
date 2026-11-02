import { sql } from "kysely";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Snapshot } from "../../../../../../packages/core/src/api/handlers/snapshot.js";
import { generateSnapshot } from "../../../../../../packages/core/src/api/handlers/snapshot.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabaseWithCollections } from "../../utils/test-db.js";

describe("generateSnapshot", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabaseWithCollections();
	});

	afterEach(async () => {
		await db.destroy();
	});

	it("returns empty tables when no content exists", async () => {
		const snapshot = await generateSnapshot(db);

		expect(snapshot.generatedAt).toBeTruthy();
		expect(typeof snapshot.generatedAt).toBe("string");

		expect(snapshot.schema).toHaveProperty("ec_post");
		expect(snapshot.schema).toHaveProperty("ec_page");
		expect(snapshot.schema.ec_post.columns).toContain("id");
		expect(snapshot.schema.ec_post.columns).toContain("title");
		expect(snapshot.schema.ec_post.columns).toContain("slug");
		expect(snapshot.schema.ec_post.columns).toContain("status");

		expect(snapshot.schema).toHaveProperty("_emdash_collections");
		expect(snapshot.schema).toHaveProperty("_emdash_fields");

		expect(snapshot.tables._emdash_collections).toHaveLength(2);
	});

	it("includes published content and excludes drafts by default", async () => {
		await sql`
			INSERT INTO ec_post (id, slug, status, title, content, created_at, updated_at, version)
			VALUES ('pub1', 'hello-world', 'published', 'Hello World', 'Content here', datetime('now'), datetime('now'), 1)
		`.execute(db);

		await sql`
			INSERT INTO ec_post (id, slug, status, title, content, created_at, updated_at, version)
			VALUES ('draft1', 'draft-post', 'draft', 'Draft Post', 'Draft content', datetime('now'), datetime('now'), 1)
		`.execute(db);

		const snapshot = await generateSnapshot(db);

		expect(snapshot.tables.ec_post).toHaveLength(1);
		expect(snapshot.tables.ec_post[0].slug).toBe("hello-world");
	});

	it("includes drafts when includeDrafts is true", async () => {
		await sql`
			INSERT INTO ec_post (id, slug, status, title, content, created_at, updated_at, version)
			VALUES ('pub1', 'hello-world', 'published', 'Hello World', 'Content', datetime('now'), datetime('now'), 1)
		`.execute(db);

		await sql`
			INSERT INTO ec_post (id, slug, status, title, content, created_at, updated_at, version)
			VALUES ('draft1', 'draft-post', 'draft', 'Draft Post', 'Draft', datetime('now'), datetime('now'), 1)
		`.execute(db);

		const snapshot = await generateSnapshot(db, { includeDrafts: true });

		expect(snapshot.tables.ec_post).toHaveLength(2);
	});

	it("excludes scheduled posts whose scheduled_at has passed", async () => {
		const pastIso = new Date(Date.now() - 1000).toISOString();
		await sql`
			INSERT INTO ec_post (id, slug, status, title, content, scheduled_at, created_at, updated_at, version)
			VALUES ('sch1', 'past-schedule', 'scheduled', 'Past', 'c', ${pastIso}, datetime('now'), datetime('now'), 1)
		`.execute(db);

		const snapshot = await generateSnapshot(db);
		const slugs = (snapshot.tables.ec_post ?? []).map((r) => r.slug);

		expect(slugs).not.toContain("past-schedule");
	});

	it("excludes soft-deleted content", async () => {
		await sql`
			INSERT INTO ec_post (id, slug, status, title, content, created_at, updated_at, version)
			VALUES ('pub1', 'live-post', 'published', 'Live', 'Content', datetime('now'), datetime('now'), 1)
		`.execute(db);

		await sql`
			INSERT INTO ec_post (id, slug, status, title, content, created_at, updated_at, deleted_at, version)
			VALUES ('del1', 'deleted-post', 'published', 'Deleted', 'Gone', datetime('now'), datetime('now'), datetime('now'), 1)
		`.execute(db);

		const snapshot = await generateSnapshot(db);

		expect(snapshot.tables.ec_post).toHaveLength(1);
		expect(snapshot.tables.ec_post[0].slug).toBe("live-post");
	});

	it("excludes auth and security tables", async () => {
		const snapshot = await generateSnapshot(db);

		expect(snapshot.schema).not.toHaveProperty("users");
		expect(snapshot.schema).not.toHaveProperty("sessions");
		expect(snapshot.schema).not.toHaveProperty("credentials");
		expect(snapshot.schema).not.toHaveProperty("challenges");
		expect(snapshot.schema).not.toHaveProperty("_emdash_api_tokens");
		expect(snapshot.schema).not.toHaveProperty("_emdash_oauth_tokens");
	});

	it("includes system tables needed for rendering", async () => {
		const snapshot = await generateSnapshot(db);

		expect(snapshot.schema).toHaveProperty("_emdash_collections");
		expect(snapshot.schema).toHaveProperty("_emdash_fields");
		expect(snapshot.schema).toHaveProperty("_emdash_migrations");
		expect(snapshot.schema).toHaveProperty("options");
	});

	it("includes column type info in schema", async () => {
		const snapshot = await generateSnapshot(db);

		const postSchema = snapshot.schema.ec_post;
		expect(postSchema).toBeDefined();
		expect(postSchema.types).toBeDefined();
		expect(postSchema.types!.id.toLowerCase()).toBe("text");
		expect(postSchema.types!.version.toLowerCase()).toBe("integer");
	});

	it("snapshot shape matches DO expectation", async () => {
		await sql`
			INSERT INTO ec_post (id, slug, status, title, content, created_at, updated_at, version)
			VALUES ('p1', 'test', 'published', 'Test', 'Body', datetime('now'), datetime('now'), 1)
		`.execute(db);

		const snapshot: Snapshot = await generateSnapshot(db);

		expect(snapshot).toHaveProperty("tables");
		expect(snapshot).toHaveProperty("schema");
		expect(snapshot).toHaveProperty("generatedAt");
		expect(typeof snapshot.generatedAt).toBe("string");

		for (const [tableName, rows] of Object.entries(snapshot.tables)) {
			expect(typeof tableName).toBe("string");
			expect(Array.isArray(rows)).toBe(true);
			for (const row of rows) {
				expect(typeof row).toBe("object");
			}
		}

		for (const [tableName, info] of Object.entries(snapshot.schema)) {
			expect(typeof tableName).toBe("string");
			expect(Array.isArray(info.columns)).toBe(true);
			if (info.types) {
				expect(typeof info.types).toBe("object");
			}
		}
	});

	it("filters options table to safe rendering prefixes only", async () => {
		await sql`INSERT INTO options (name, value) VALUES ('site:title', '"My Site"')`.execute(db);
		await sql`INSERT INTO options (name, value) VALUES ('site:tagline', '"Welcome"')`.execute(db);

		await sql`INSERT INTO options (name, value) VALUES ('plugin:smtp:api_key', '"sk-secret-123"')`.execute(
			db,
		);
		await sql`INSERT INTO options (name, value) VALUES ('plugin:seo:license', '"lic-456"')`.execute(
			db,
		);

		await sql`INSERT INTO options (name, value) VALUES ('emdash:setup_complete', 'true')`.execute(
			db,
		);
		await sql`INSERT INTO options (name, value) VALUES ('emdash:passkey_pending:user1', '{"challenge":"abc"}')`.execute(
			db,
		);

		const snapshot = await generateSnapshot(db);

		const optionsRows = snapshot.tables.options;
		expect(optionsRows).toBeDefined();
		expect(optionsRows).toHaveLength(2);

		const names = optionsRows.map((r) => r.name);
		expect(names).toContain("site:title");
		expect(names).toContain("site:tagline");
		expect(names).not.toContain("plugin:smtp:api_key");
		expect(names).not.toContain("plugin:seo:license");
		expect(names).not.toContain("emdash:setup_complete");
		expect(names).not.toContain("emdash:passkey_pending:user1");
	});

	it("discovers content tables dynamically", async () => {
		const snapshot = await generateSnapshot(db);

		expect(snapshot.schema).toHaveProperty("ec_post");
		expect(snapshot.schema).toHaveProperty("ec_page");

		expect(snapshot.schema.ec_post.columns).toContain("title");
		expect(snapshot.schema.ec_post.columns).toContain("content");
		expect(snapshot.schema.ec_page.columns).toContain("title");
		expect(snapshot.schema.ec_page.columns).toContain("content");
	});
});
