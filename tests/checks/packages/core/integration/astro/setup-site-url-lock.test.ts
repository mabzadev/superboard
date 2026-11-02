import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:emdash/seed", () => ({
	seed: {
		version: "1",
		settings: {},
		collections: [],
	},
	userSeed: null,
}));

import { POST as postSetup } from "../../../../../../packages/core/src/astro/routes/api/setup/index.js";
import { OptionsRepository } from "../../../../../../packages/core/src/database/repositories/options.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

function buildRequest(host: string, body: unknown): Request {
	return new Request(`http://${host}/_emdash/api/setup`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			host,
		},
		body: JSON.stringify(body),
	});
}

function buildContext(db: Kysely<Database>, request: Request): APIContext {
	return {
		params: {},
		url: new URL(request.url),
		request,
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

describe("POST /setup — site_url write-once lock", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("stores site_url from the first request", async () => {
		const res = await postSetup(
			buildContext(
				db,
				buildRequest("real-site.example", { title: "My Site", includeContent: false }),
			),
		);
		expect(res.status).toBe(200);

		const options = new OptionsRepository(db);
		expect(await options.get("emdash:site_url")).toBe("http://real-site.example");
	});

	it("does not overwrite site_url when a later setup call arrives with a spoofed Host", async () => {
		const first = await postSetup(
			buildContext(
				db,
				buildRequest("real-site.example", { title: "My Site", includeContent: false }),
			),
		);
		expect(first.status).toBe(200);

		const second = await postSetup(
			buildContext(
				db,
				buildRequest("attacker.example", { title: "My Site", includeContent: false }),
			),
		);
		expect(second.status).toBe(200);

		const options = new OptionsRepository(db);
		expect(await options.get("emdash:site_url")).toBe("http://real-site.example");
	});

	it("is atomic under concurrent setup POSTs with different Hosts", async () => {
		const [a, b] = await Promise.all([
			postSetup(
				buildContext(
					db,
					buildRequest("real-site.example", { title: "My Site", includeContent: false }),
				),
			),
			postSetup(
				buildContext(
					db,
					buildRequest("attacker.example", { title: "My Site", includeContent: false }),
				),
			),
		]);
		expect(a.status).toBe(200);
		expect(b.status).toBe(200);

		const options = new OptionsRepository(db);
		const stored = await options.get("emdash:site_url");
		expect(["http://real-site.example", "http://attacker.example"]).toContain(stored);

		const third = await postSetup(
			buildContext(db, buildRequest("other.example", { title: "My Site", includeContent: false })),
		);
		expect(third.status).toBe(200);
		expect(await options.get("emdash:site_url")).toBe(stored);
	});

	it("does not overwrite a legitimately-stored empty string", async () => {
		const options = new OptionsRepository(db);
		await options.set("emdash:site_url", "");

		const res = await postSetup(
			buildContext(
				db,
				buildRequest("attacker.example", { title: "My Site", includeContent: false }),
			),
		);
		expect(res.status).toBe(200);

		expect(await options.get("emdash:site_url")).toBe("");
	});
});
