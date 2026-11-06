import { Role, sendMagicLink } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as verifyMagicLink } from "../../../../../../packages/core/src/astro/routes/api/auth/magic-link/verify.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
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
				baseUrl: "https://site.mabza.dev",
				siteName: "SuperBoard",
				email: async (message) => {
					link = message.text.match(/https:\/\/\S+/u)?.[0] ?? "";
				},
			},
			adapter,
			user.email,
		);
		const values = new Map<string, unknown>();
		const token = new URL(link).searchParams.get("token");
		const request = new Request("https://site.mabza.dev/_emdash/api/auth/magic-link/verify", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token }),
		});
		const response = await verifyMagicLink({
			params: {},
			url: new URL(request.url),
			request,
			locals: { emdash: { db, config: {}, storage: undefined } },
			session: { set: (key: string, value: unknown) => values.set(key, value) },
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- bounded route harness
		} as unknown as APIContext);

		expect(response.status).toBe(200);
		expect(values.get("user")).toEqual({ id: user.id });
		expect(values.get("strongReauthentication")).toMatchObject({
			userId: user.id,
			verifiedAt: expect.any(String),
		});
	});
});
