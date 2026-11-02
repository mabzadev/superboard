import { Role } from "@emdash-cms/auth";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as getById } from "../../../../../../packages/core/src/astro/routes/api/admin/bylines/[id]/index.js";
import { POST as createByline } from "../../../../../../packages/core/src/astro/routes/api/admin/bylines/index.js";
import { resetBylineFieldDefsCacheForTests } from "../../../../../../packages/core/src/bylines/field-defs-cache.js";
import { BylineRepository } from "../../../../../../packages/core/src/database/repositories/byline.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { BylineSchemaRegistry } from "../../../../../../packages/core/src/schema/byline-registry.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

interface BuildOpts {
	db: Kysely<Database>;
	request: Request;
	params?: { id: string };
	user: { id: string; role: (typeof Role)[keyof typeof Role] } | null;
}

function buildContext(opts: BuildOpts): APIContext {
	return {
		params: opts.params ?? {},
		url: new URL(opts.request.url),
		request: opts.request,
		locals: {
			emdash: { db: opts.db, config: {} },
			user: opts.user,
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub for tests
	} as unknown as APIContext;
}

function postReq(body: unknown): Request {
	return new Request("http://localhost/_emdash/api/admin/bylines", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-EmDash-Request": "1",
		},
		body: JSON.stringify(body),
	});
}

function getReq(id: string): Request {
	return new Request(`http://localhost/_emdash/api/admin/bylines/${id}`, {
		method: "GET",
		headers: { "X-EmDash-Request": "1" },
	});
}

const adminUser = { id: "admin-1", role: Role.ADMIN };

const baseCreate = {
	slug: "jane-doe",
	displayName: "Jane Doe",
	isGuest: true,
};

describe("POST /admin/bylines — customFields write surface", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		resetBylineFieldDefsCacheForTests();
		db = await setupTestDatabase();

		const registry = new BylineSchemaRegistry(db);
		await registry.createField({
			slug: "job_title",
			label: "Job title",
			type: "string",
			translatable: true,
		});
		await registry.createField({
			slug: "twitter_handle",
			label: "Twitter",
			type: "url",
			translatable: false,
		});
		await registry.createField({
			slug: "tier",
			label: "Tier",
			type: "select",
			translatable: true,
			validation: { options: ["bronze", "silver", "gold"] },
		});
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("POST writes customFields, GET reads them back", async () => {
		const createRes = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: {
						job_title: "Senior editor",
						twitter_handle: "https://twitter.com/jane",
						tier: "gold",
					},
				}),
				user: adminUser,
			}),
		);
		expect(createRes.status).toBe(201);
		const createJson = (await createRes.json()) as {
			data: { id: string; customFields?: Record<string, unknown> };
		};
		expect(createJson.data.customFields).toMatchObject({
			job_title: "Senior editor",
			twitter_handle: "https://twitter.com/jane",
			tier: "gold",
		});

		const getRes = await getById(
			buildContext({
				db,
				request: getReq(createJson.data.id),
				params: { id: createJson.data.id },
				user: adminUser,
			}),
		);
		expect(getRes.status).toBe(200);
		const getJson = (await getRes.json()) as {
			data: { customFields?: Record<string, unknown> };
		};
		expect(getJson.data.customFields).toMatchObject({
			job_title: "Senior editor",
			twitter_handle: "https://twitter.com/jane",
			tier: "gold",
		});
	});

	it("create without customFields still works (back-compat)", async () => {
		const res = await createByline(
			buildContext({
				db,
				request: postReq(baseCreate),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(201);
	});

	it("unknown customField slug → 400 VALIDATION_ERROR and no byline row created", async () => {
		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: { not_a_registered_field: "x" },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

		const repo = new BylineRepository(db);
		const found = await repo.findBySlug(baseCreate.slug);
		expect(found).toBeNull();
	});

	it("type mismatch (string expected, boolean sent) → 400 and no byline created", async () => {
		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: { job_title: true },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(400);

		const repo = new BylineRepository(db);
		expect(await repo.findBySlug(baseCreate.slug)).toBeNull();
	});

	it("select-choice mismatch → 400", async () => {
		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: { tier: "platinum" },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(400);
	});

	it("retry after a D1-style crash (bare row, no fields) completes the customFields", async () => {
		const repo = new BylineRepository(db);
		const orphan = await repo.create({
			slug: baseCreate.slug,
			displayName: baseCreate.displayName,
			isGuest: baseCreate.isGuest,
		});
		expect(orphan.customFields ?? {}).toEqual({});

		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: {
						job_title: "Senior editor",
						twitter_handle: "https://twitter.com/jane",
					},
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			data: { id: string; customFields?: Record<string, unknown> };
		};
		expect(json.data.id).toBe(orphan.id);
		expect(json.data.customFields).toMatchObject({
			job_title: "Senior editor",
			twitter_handle: "https://twitter.com/jane",
		});
	});

	it("retry with a different displayName still returns CONFLICT (recovery requires matching payload)", async () => {
		const repo = new BylineRepository(db);
		await repo.create({ slug: baseCreate.slug, displayName: "Original Name", isGuest: true });

		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					displayName: "Different Name",
					customFields: { job_title: "Editor" },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ error: { code: "CONFLICT" } });
	});

	it("retry where existing customField value differs from input returns CONFLICT (no overwrite)", async () => {
		const repo = new BylineRepository(db);
		const seeded = await repo.create({
			slug: baseCreate.slug,
			displayName: baseCreate.displayName,
			isGuest: true,
			customFields: { job_title: "Original Role" },
		});
		expect(seeded.customFields?.job_title).toBe("Original Role");

		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: { job_title: "Attempted Overwrite" },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(409);

		const reloaded = await repo.findById(seeded.id);
		expect(reloaded?.customFields?.job_title).toBe("Original Role");
	});

	it("retry completes a partial customFields write (D1 mid-loop crash recovery)", async () => {
		const repo = new BylineRepository(db);
		const partial = await repo.create({
			slug: baseCreate.slug,
			displayName: baseCreate.displayName,
			isGuest: true,
			customFields: { job_title: "Editor" },
		});
		expect(partial.customFields?.job_title).toBe("Editor");
		expect(partial.customFields?.twitter_handle).toBeUndefined();

		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: {
						job_title: "Editor",
						twitter_handle: "https://twitter.com/jane",
					},
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			data: { id: string; customFields?: Record<string, unknown> };
		};
		expect(json.data.id).toBe(partial.id);
		expect(json.data.customFields).toMatchObject({
			job_title: "Editor",
			twitter_handle: "https://twitter.com/jane",
		});
	});

	it("retry with a different bio (fixed-column mismatch) returns CONFLICT", async () => {
		const repo = new BylineRepository(db);
		await repo.create({
			slug: baseCreate.slug,
			displayName: baseCreate.displayName,
			isGuest: true,
			bio: "Original bio",
		});

		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					bio: "Different bio",
					customFields: { job_title: "Editor" },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(409);
	});

	it("retry with a different websiteUrl (fixed-column mismatch) returns CONFLICT", async () => {
		const repo = new BylineRepository(db);
		await repo.create({
			slug: baseCreate.slug,
			displayName: baseCreate.displayName,
			isGuest: true,
			websiteUrl: "https://example.com/original",
		});

		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					websiteUrl: "https://example.com/different",
					customFields: { job_title: "Editor" },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(409);
	});

	it("retry with translationOf pointing to a different group returns CONFLICT", async () => {
		const repo = new BylineRepository(db);
		const janeAnchor = await repo.create({
			slug: baseCreate.slug,
			displayName: baseCreate.displayName,
			locale: "fr",
		});
		const bobAnchor = await repo.create({
			slug: "bob-anchor",
			displayName: "Bob",
			locale: "en",
		});
		expect(janeAnchor.translationGroup).not.toBe(bobAnchor.translationGroup);

		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					slug: baseCreate.slug,
					displayName: baseCreate.displayName,
					isGuest: false,
					locale: "fr",
					translationOf: bobAnchor.id,
					customFields: { job_title: "Editor" },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(409);

		const reloaded = await repo.findById(janeAnchor.id);
		expect(reloaded?.customFields ?? {}).toEqual({});
	});

	it("retry without translationOf against a non-anchor row returns CONFLICT", async () => {
		const repo = new BylineRepository(db);
		const source = await repo.create({
			slug: "source-en",
			displayName: "Source",
			locale: "en",
		});
		const translation = await repo.create({
			slug: baseCreate.slug,
			displayName: baseCreate.displayName,
			locale: "fr",
			translationOf: source.id,
		});
		expect(translation.translationGroup).toBe(source.id);
		expect(translation.translationGroup).not.toBe(translation.id);

		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					slug: baseCreate.slug,
					displayName: baseCreate.displayName,
					isGuest: false,
					locale: "fr",
					customFields: { job_title: "Editor" },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(409);

		const reloaded = await repo.findById(translation.id);
		expect(reloaded?.customFields ?? {}).toEqual({});
	});

	it("retry where input omits a key the existing row stores returns CONFLICT", async () => {
		const repo = new BylineRepository(db);
		await repo.create({
			slug: baseCreate.slug,
			displayName: baseCreate.displayName,
			isGuest: true,
			customFields: {
				job_title: "Editor",
				twitter_handle: "https://twitter.com/jane",
			},
		});

		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: { job_title: "Editor" },
				}),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(409);
	});

	it("retry with no customFields in the payload returns CONFLICT (nothing to complete)", async () => {
		const repo = new BylineRepository(db);
		await repo.create({
			slug: baseCreate.slug,
			displayName: baseCreate.displayName,
			isGuest: true,
		});

		const res = await createByline(
			buildContext({
				db,
				request: postReq(baseCreate),
				user: adminUser,
			}),
		);
		expect(res.status).toBe(409);
	});

	it("returns 401 without a session", async () => {
		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: { job_title: "X" },
				}),
				user: null,
			}),
		);
		expect(res.status).toBe(401);
	});

	it("AUTHOR (below bylines:manage) → 403", async () => {
		const authorUser = { id: "author-1", role: Role.AUTHOR };
		const res = await createByline(
			buildContext({
				db,
				request: postReq({
					...baseCreate,
					customFields: { job_title: "X" },
				}),
				user: authorUser,
			}),
		);
		expect(res.status).toBe(403);
	});
});
