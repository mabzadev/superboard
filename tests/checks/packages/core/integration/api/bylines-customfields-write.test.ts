import { Role } from "@emdash-cms/auth";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	GET as getById,
	PUT as putById,
} from "../../../../../../packages/core/src/astro/routes/api/admin/bylines/[id]/index.js";
import { resetBylineFieldDefsCacheForTests } from "../../../../../../packages/core/src/bylines/field-defs-cache.js";
import { BylineRepository } from "../../../../../../packages/core/src/database/repositories/byline.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { BylineSchemaRegistry } from "../../../../../../packages/core/src/schema/byline-registry.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

interface BuildOpts {
	db: Kysely<Database>;
	request: Request;
	params: { id: string };
	user: { id: string; role: (typeof Role)[keyof typeof Role] } | null;
}

function buildContext(opts: BuildOpts): APIContext {
	return {
		params: opts.params,
		url: new URL(opts.request.url),
		request: opts.request,
		locals: {
			emdash: { db: opts.db, config: {} },
			user: opts.user,
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub for tests
	} as unknown as APIContext;
}

function putReq(id: string, body: unknown): Request {
	return new Request(`http://localhost/_emdash/api/admin/bylines/${id}`, {
		method: "PUT",
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
const editorUser = { id: "editor-1", role: Role.EDITOR };

const basePut = {
	slug: "jane-doe",
	displayName: "Jane Doe",
	bio: null,
	avatarMediaId: null,
	websiteUrl: null,
	userId: null,
	isGuest: true,
};

describe("PUT /admin/bylines/{id} — customFields write surface", () => {
	let db: Kysely<Database>;
	let bylineId: string;

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
			slug: "is_staff",
			label: "Staff",
			type: "boolean",
			translatable: true,
		});
		await registry.createField({
			slug: "tier",
			label: "Tier",
			type: "select",
			translatable: true,
			validation: { options: ["bronze", "silver", "gold"] },
		});

		const repo = new BylineRepository(db);
		const byline = await repo.create({
			slug: "jane-doe",
			displayName: "Jane Doe",
			isGuest: true,
		});
		bylineId = byline.id;
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("PUT writes customFields, GET reads them back", async () => {
		const putBody = {
			...basePut,
			customFields: {
				job_title: "Senior editor",
				twitter_handle: "https://twitter.com/jane",
				is_staff: true,
				tier: "gold",
			},
		};
		const putRes = await putById(
			buildContext({
				db,
				request: putReq(bylineId, putBody),
				params: { id: bylineId },
				user: adminUser,
			}),
		);
		expect(putRes.status).toBe(200);
		const putJson = (await putRes.json()) as {
			data: { customFields?: Record<string, unknown> };
		};
		expect(putJson.data.customFields).toMatchObject({
			job_title: "Senior editor",
			twitter_handle: "https://twitter.com/jane",
			is_staff: true,
			tier: "gold",
		});

		const getRes = await getById(
			buildContext({ db, request: getReq(bylineId), params: { id: bylineId }, user: adminUser }),
		);
		expect(getRes.status).toBe(200);
		const getJson = (await getRes.json()) as {
			data: { customFields?: Record<string, unknown> };
		};
		expect(getJson.data.customFields).toMatchObject({
			job_title: "Senior editor",
			twitter_handle: "https://twitter.com/jane",
			is_staff: true,
			tier: "gold",
		});
	});

	it("null customField value clears that slot", async () => {
		const writeRes = await putById(
			buildContext({
				db,
				request: putReq(bylineId, { ...basePut, customFields: { job_title: "Editor" } }),
				params: { id: bylineId },
				user: adminUser,
			}),
		);
		expect(writeRes.status).toBe(200);

		const clearRes = await putById(
			buildContext({
				db,
				request: putReq(bylineId, { ...basePut, customFields: { job_title: null } }),
				params: { id: bylineId },
				user: adminUser,
			}),
		);
		expect(clearRes.status).toBe(200);

		const getRes = await getById(
			buildContext({ db, request: getReq(bylineId), params: { id: bylineId }, user: adminUser }),
		);
		const getJson = (await getRes.json()) as {
			data: { customFields?: Record<string, unknown> };
		};
		expect(getJson.data.customFields).not.toHaveProperty("job_title");
	});

	it("unknown customField slug → 400 VALIDATION_ERROR", async () => {
		const res = await putById(
			buildContext({
				db,
				request: putReq(bylineId, {
					...basePut,
					customFields: { not_a_registered_field: "x" },
				}),
				params: { id: bylineId },
				user: adminUser,
			}),
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
	});

	it("reserved-slug write returns 400 (no registered field has that slug)", async () => {
		const res = await putById(
			buildContext({
				db,
				request: putReq(bylineId, {
					...basePut,
					customFields: { display_name: "X" },
				}),
				params: { id: bylineId },
				user: adminUser,
			}),
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
	});

	it("type mismatch (string expected, boolean sent) → 400", async () => {
		const res = await putById(
			buildContext({
				db,
				request: putReq(bylineId, {
					...basePut,
					customFields: { job_title: true },
				}),
				params: { id: bylineId },
				user: adminUser,
			}),
		);
		expect(res.status).toBe(400);
	});

	it("select-choice mismatch → 400", async () => {
		const res = await putById(
			buildContext({
				db,
				request: putReq(bylineId, {
					...basePut,
					customFields: { tier: "platinum" },
				}),
				params: { id: bylineId },
				user: adminUser,
			}),
		);
		expect(res.status).toBe(400);
	});

	it("returns 401 without a session", async () => {
		const res = await putById(
			buildContext({
				db,
				request: putReq(bylineId, { ...basePut, customFields: { job_title: "X" } }),
				params: { id: bylineId },
				user: null,
			}),
		);
		expect(res.status).toBe(401);
	});

	it("EDITOR can write customFields (bylines:manage = EDITOR)", async () => {
		const res = await putById(
			buildContext({
				db,
				request: putReq(bylineId, { ...basePut, customFields: { job_title: "Editor" } }),
				params: { id: bylineId },
				user: editorUser,
			}),
		);
		expect(res.status).toBe(200);
	});

	it("AUTHOR (below bylines:manage) → 403", async () => {
		const authorUser = { id: "author-1", role: Role.AUTHOR };
		const res = await putById(
			buildContext({
				db,
				request: putReq(bylineId, { ...basePut, customFields: { job_title: "X" } }),
				params: { id: bylineId },
				user: authorUser,
			}),
		);
		expect(res.status).toBe(403);
	});
});
