import { Role, requestSignup, validateSignupToken, completeSignup } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetEnvCache } from "../../../../../../packages/core/src/api/public-url.js";
import { onRequest } from "../../../../../../packages/core/src/astro/middleware/auth.js";
import { POST } from "../../../../../../packages/core/src/astro/routes/api/auth/signup/register-options.js";
import { createChallengeStore } from "../../../../../../packages/core/src/auth/challenge-store.js";
import { OptionsRepository } from "../../../../../../packages/core/src/database/repositories/options.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("virtual:emdash/auth", () => ({ authenticate: async () => null }));

const TOKEN_PATTERN = /token=([A-Za-z0-9_-]+)/u;

describe("signup registration options", () => {
	let db: Kysely<Database>;
	let token: string;
	const setupState = { step: "complete", siteTitle: "Existing site" };

	beforeEach(async () => {
		db = await setupTestDatabase();
		_resetEnvCache();
		const adapter = createKyselyAdapter(db);
		await adapter.createUser({ email: "owner@allowed.com", role: Role.ADMIN, emailVerified: true });
		await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);
		const options = new OptionsRepository(db);
		await options.set("emdash:setup_complete", true);
		await options.set("emdash:setup_state", setupState);
		token = "";
		await requestSignup(
			{
				baseUrl: "https://signup.example.com",
				siteName: "Existing site",
				email: async (message) => {
					token = TOKEN_PATTERN.exec(message.text)?.[1] ?? "";
				},
			},
			adapter,
			"new@allowed.com",
		);
		if (!token) throw new Error("Signup token was not issued");
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
		_resetEnvCache();
	});

	function context(body: unknown, origin = "https://signup.example.com") {
		const request = new Request("http://localhost:4321/_emdash/api/auth/signup/register-options", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: origin },
			body: JSON.stringify(body),
		});
		return {
			request,
			url: new URL(request.url),
			locals: { emdash: { db, config: { siteUrl: "https://signup.example.com" } } },
		} as Parameters<typeof POST>[0];
	}

	it("creates the signup challenge on an initialized site without changing setup or creating an account", async () => {
		const requestContext = context({ token, name: "New author", email: "forged@example.com" });
		const response = await onRequest(requestContext, () => POST(requestContext));
		expect(response?.status).toBe(200);
		const value = (await response!.json()) as {
			data: {
				options: {
					challenge: string;
					user: { name: string; displayName: string };
					rp: { id: string };
				};
			};
		};
		expect(value.data.options.user).toMatchObject({
			name: "new@allowed.com",
			displayName: "New author",
		});
		expect(value.data.options.rp.id).toBe("signup.example.com");
		expect(await createChallengeStore(db).get(value.data.options.challenge)).toMatchObject({
			type: "registration",
		});
		const adapter = createKyselyAdapter(db);
		expect(await validateSignupToken(adapter, token)).toMatchObject({
			email: "new@allowed.com",
			role: Role.AUTHOR,
		});
		expect(await adapter.countUsers()).toBe(1);
		expect(await new OptionsRepository(db).get("emdash:setup_state")).toEqual(setupState);
		expect(await new OptionsRepository(db).get("emdash:setup_complete")).toBe(true);
	});

	it("rejects invalid and expired tokens before generating a challenge", async () => {
		expect((await POST(context({ token: "invalid" }))).status).toBe(404);
		await expect(completeSignup(createKyselyAdapter(db), "invalid", {})).rejects.toMatchObject({
			code: "invalid_token",
		});
		await db
			.updateTable("auth_tokens")
			.set({ expires_at: "2000-01-01T00:00:00.000Z" })
			.where("email", "=", "new@allowed.com")
			.execute();
		expect((await POST(context({ token }))).status).toBe(410);
		expect(await db.selectFrom("auth_challenges").selectAll().execute()).toEqual([]);
	});

	it("rejects a signup whose account already exists", async () => {
		await createKyselyAdapter(db).createUser({
			email: "new@allowed.com",
			role: Role.AUTHOR,
			emailVerified: true,
		});
		expect((await POST(context({ token }))).status).toBe(409);
		expect(await db.selectFrom("auth_challenges").selectAll().execute()).toEqual([]);
	});

	it("keeps public signup CSRF protection without requiring a session", async () => {
		const requestContext = context({ token }, "https://attacker.example");
		const response = await onRequest(requestContext, () => POST(requestContext));
		expect(response?.status).toBe(403);
		expect(await db.selectFrom("auth_challenges").selectAll().execute()).toEqual([]);
	});
});
