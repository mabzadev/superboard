import type { APIContext } from "astro";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { Role, sendMagicLink } from "@emdash-cms/auth";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as verifyMagicLink } from "../../../src/astro/routes/api/auth/magic-link/verify.js";
import type { Database } from "../../../src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("magic-link strong reauthentication", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("marks a verified email login as recent strong reauthentication", async () => {
		const adapter = createKyselyAdapter(db);
		const user = await adapter.createUser({
			email: "mabzadev@gmail.com",
			name: "Mabza",
			role: Role.ADMIN,
			emailVerified: true,
		});
		let link = "";
		await sendMagicLink(
			{
				baseUrl: "https://site.mbza.dev",
				siteName: "SuperBoard",
				email: async (message) => {
					link = message.text.match(/https:\/\/\S+/u)?.[0] ?? "";
				},
			},
			adapter,
			user.email,
		);
		const values = new Map<string, unknown>();
		const request = new Request(link);
		const response = await verifyMagicLink({
			params: {},
			url: new URL(link),
			request,
			locals: { emdash: { db, config: {}, storage: undefined } },
			session: { set: (key: string, value: unknown) => values.set(key, value) },
			redirect: (path: string) =>
				new Response(null, { status: 302, headers: { Location: path } }),
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- bounded route harness
		} as unknown as APIContext);

		expect(response.headers.get("Location")).toBe("/_emdash/admin");
		expect(values.get("user")).toEqual({ id: user.id });
		expect(values.get("strongReauthentication")).toMatchObject({
			userId: user.id,
			verifiedAt: expect.any(String),
		});
	});
});
