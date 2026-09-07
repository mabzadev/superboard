import { requestSignup, Role, validateSignupToken } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onRequest } from "../../../src/astro/middleware/auth.js";
import { GET } from "../../../src/astro/routes/api/auth/signup/verify.js";
import type { Database } from "../../../src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("virtual:emdash/auth", () => ({ authenticate: async () => null }));

describe("signup email link navigation", () => {
	let db: Kysely<Database>;
	let verificationUrl: URL;
	beforeEach(async () => {
		db = await setupTestDatabase();
		const adapter = createKyselyAdapter(db);
		await adapter.createAllowedDomain("example.test", Role.AUTHOR);
		await requestSignup(
			{
				baseUrl: "https://site.example.test",
				siteName: "Site",
				email: async (message) => {
					const link = message.text.match(/https?:\/\/[^\s]+/u)?.[0];
					if (!link) throw new Error("Verification link missing");
					verificationUrl = new URL(link);
				},
			},
			adapter,
			"new@example.test",
		);
	});
	afterEach(async () => teardownTestDatabase(db));
	function context(accept: string, url = verificationUrl) {
		return {
			request: new Request(url, { headers: { Accept: accept } }),
			url,
			locals: { emdash: { db } },
		} as Parameters<typeof GET>[0];
	}
	it("opens the registration page when the recipient follows the actual email link", async () => {
		const response = await GET(context("text/html,application/xhtml+xml"));
		expect(response.status).toBe(302);
		const target = new URL(response.headers.get("Location")!, verificationUrl);
		expect(target.pathname).toBe("/_emdash/admin/signup");
		expect(target.searchParams.get("token")).toBe(verificationUrl.searchParams.get("token"));
		expect(
			await validateSignupToken(createKyselyAdapter(db), target.searchParams.get("token")!),
		).toMatchObject({ email: "new@example.test", role: Role.AUTHOR });
	});
	it("allows the anonymous recipient to open registration without exposing protected admin pages", async () => {
		for (const [path, status] of [
			["/_emdash/admin/signup", 200],
			["/_emdash/admin/signup/", 200],
			["/_emdash/admin/signup-settings", 302],
			["/_emdash/admin/users", 302],
		] as const) {
			const url = new URL(path, verificationUrl);
			const response = await onRequest(
				{
					url,
					request: new Request(url),
					locals: { emdash: { db, config: {} } },
					redirect: (location: string) =>
						new Response(null, { status: 302, headers: { Location: location } }),
				} as Parameters<typeof onRequest>[0],
				async () => new Response("Registration form"),
			);
			expect(response.status, path).toBe(status);
			if (status === 200) expect(await response.text()).toBe("Registration form");
		}
	});

	it("continues returning token metadata to the registration client", async () => {
		const response = await GET(context("application/json"));
		expect(response.status).toBe(200);
		expect(response.headers.has("Location")).toBe(false);
		expect(await response.json()).toMatchObject({
			success: true,
			data: { email: "new@example.test", role: Role.AUTHOR },
		});
	});
	it("rejects invalid links before redirecting to registration", async () => {
		const invalid = new URL(verificationUrl);
		invalid.searchParams.set("token", "invalid");
		const response = await GET(context("text/html", invalid));
		expect(response.status).toBe(404);
		expect(response.headers.has("Location")).toBe(false);
	});
});
