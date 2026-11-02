import type { APIContext, AstroCookies } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as postAdminVerify } from "../../../../../../packages/core/src/astro/routes/api/setup/admin-verify.js";
import { POST as postAdmin } from "../../../../../../packages/core/src/astro/routes/api/setup/admin.js";
import { OptionsRepository } from "../../../../../../packages/core/src/database/repositories/options.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

interface CookieRecord {
	value: string;
	options: Record<string, unknown>;
}

function createCookieJar(initial: Record<string, string> = {}): {
	jar: Map<string, CookieRecord>;
	cookies: AstroCookies;
} {
	const jar = new Map<string, CookieRecord>();
	for (const [name, value] of Object.entries(initial)) {
		jar.set(name, { value, options: {} });
	}

	const cookies = {
		get(name: string) {
			const record = jar.get(name);
			if (!record) return undefined;
			return { value: record.value };
		},
		set(name: string, value: string, options: Record<string, unknown> = {}) {
			jar.set(name, { value, options });
		},
		delete(name: string) {
			jar.delete(name);
		},
		has(name: string) {
			return jar.has(name);
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub
	} as unknown as AstroCookies;

	return { jar, cookies };
}

function buildRequest(path: string, body: unknown): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function buildContext(db: Kysely<Database>, request: Request, cookies: AstroCookies): APIContext {
	return {
		params: {},
		url: new URL(request.url),
		request,
		cookies,
		locals: {
			emdash: {
				db,
				config: {},
				storage: undefined,
			},
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub
	} as unknown as APIContext;
}

const adminBody = { email: "recovered@admin.example", name: "Recovered Admin" };

async function insertUser(db: Kysely<Database>): Promise<void> {
	await db
		.insertInto("users")
		.values({
			id: "existing1",
			email: "existing@admin.example",
			name: "Existing Admin",
			role: 50,
			email_verified: 1,
		})
		.execute();
}

describe("POST /setup/admin — recovery when setup_complete but no users exist", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("allows starting admin registration when setup_complete is true but users is empty", async () => {
		const options = new OptionsRepository(db);
		await options.set("emdash:setup_complete", true);

		const { cookies } = createCookieJar();
		const res = await postAdmin(
			buildContext(db, buildRequest("/_emdash/api/setup/admin", adminBody), cookies),
		);

		expect(res.status).toBe(200);
	});

	it('accepts the string "true" flag variant the same way', async () => {
		const options = new OptionsRepository(db);
		await options.set("emdash:setup_complete", "true");

		const { cookies } = createCookieJar();
		const res = await postAdmin(
			buildContext(db, buildRequest("/_emdash/api/setup/admin", adminBody), cookies),
		);

		expect(res.status).toBe(200);
	});

	it("lets /setup/admin/verify past the setup-complete guard in the same state", async () => {
		const options = new OptionsRepository(db);
		await options.set("emdash:setup_complete", true);

		const { cookies } = createCookieJar();
		const adminRes = await postAdmin(
			buildContext(db, buildRequest("/_emdash/api/setup/admin", adminBody), cookies),
		);
		expect(adminRes.status).toBe(200);

		const verifyRes = await postAdminVerify(
			buildContext(
				db,
				buildRequest("/_emdash/api/setup/admin/verify", {
					credential: {
						id: "AA",
						rawId: "AA",
						type: "public-key",
						response: { clientDataJSON: "AA", attestationObject: "AA" },
					},
				}),
				cookies,
			),
		);

		const body = (await verifyRes.json()) as { error?: { code?: string } };
		expect(body.error?.code).not.toBe("SETUP_COMPLETE");
	});

	it("still rejects with SETUP_COMPLETE when setup is complete AND a user exists", async () => {
		const options = new OptionsRepository(db);
		await options.set("emdash:setup_complete", true);
		await insertUser(db);

		const { cookies } = createCookieJar();
		const res = await postAdmin(
			buildContext(db, buildRequest("/_emdash/api/setup/admin", adminBody), cookies),
		);

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { code?: string } };
		expect(body.error?.code).toBe("SETUP_COMPLETE");
	});

	it("still rejects with ADMIN_EXISTS when a user exists without the complete flag", async () => {
		await insertUser(db);

		const { cookies } = createCookieJar();
		const res = await postAdmin(
			buildContext(db, buildRequest("/_emdash/api/setup/admin", adminBody), cookies),
		);

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { code?: string } };
		expect(body.error?.code).toBe("ADMIN_EXISTS");
	});
});
