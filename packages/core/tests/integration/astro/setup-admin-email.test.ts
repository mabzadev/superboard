import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as sendSetupEmail } from "../../../src/astro/routes/api/setup/admin-email.js";
import { GET as verifySetupEmail } from "../../../src/astro/routes/api/setup/admin-email-verify.js";
import { OptionsRepository } from "../../../src/database/repositories/options.js";
import type { Database } from "../../../src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

function context(
	db: Kysely<Database>,
	request: Request,
	sent: Array<{ text: string }>,
	sessionValues: Map<string, unknown>,
): APIContext {
	return {
		params: {},
		url: new URL(request.url),
		request,
		locals: {
			emdash: {
				db,
				config: {},
				storage: undefined,
				email: {
					isAvailable: () => true,
					send: async (message: { text: string }) => {
						sent.push(message);
					},
				},
			},
		},
		session: {
			set: (key: string, value: unknown) => sessionValues.set(key, value),
		},
		redirect: (path: string) =>
			new Response(null, { status: 302, headers: { Location: path } }),
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- bounded route harness
	} as unknown as APIContext;
}

function withoutTransactions(db: Kysely<Database>): Kysely<Database> {
	return new Proxy(db, {
		get(target, property) {
			if (property === "transaction") {
				return () => ({
					execute: async () => {
						throw new Error("Transactions are not supported yet.");
					},
				});
			}
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

describe("email-verified administrator setup", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
		const options = new OptionsRepository(db);
		await options.set("emdash:setup_state", {
			step: "admin",
			title: "SuperBoard",
			tagline: "Development",
		});
		await options.set("emdash:site_title", "SuperBoard");
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("completes setup on transactionless databases such as D1", async () => {
		const sent: Array<{ text: string }> = [];
		const sessionValues = new Map<string, unknown>();
		const request = new Request("https://site.mbza.dev/_emdash/api/setup/admin/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "mabzadev@gmail.com", name: "Mabza" }),
		});
		await sendSetupEmail(context(db, request, sent, sessionValues));
		const link = sent[0]!.text.match(/https:\/\/\S+/u)?.[0];

		const verifyResponse = await verifySetupEmail(
			context(withoutTransactions(db), new Request(link!), sent, sessionValues),
		);

		expect(verifyResponse.headers.get("Location")).toBe("/_emdash/admin");
		expect(sessionValues.get("user")).toMatchObject({ id: expect.any(String) });
	});

	it("sends the setup link and creates a strongly reauthenticated admin after verification", async () => {
		const sent: Array<{ text: string }> = [];
		const sessionValues = new Map<string, unknown>();
		const request = new Request("https://site.mbza.dev/_emdash/api/setup/admin/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "mabzadev@gmail.com", name: "Mabza" }),
		});
		const sendResponse = await sendSetupEmail(context(db, request, sent, sessionValues));
		expect(sendResponse.status).toBe(200);
		expect(sent).toHaveLength(1);
		const link = sent[0]!.text.match(/https:\/\/\S+/u)?.[0];
		expect(link).toBeTruthy();

		const verifyRequest = new Request(link!);
		const verifyResponse = await verifySetupEmail(
			context(db, verifyRequest, sent, sessionValues),
		);
		expect(verifyResponse.status).toBe(302);
		expect(verifyResponse.headers.get("Location")).toBe("/_emdash/admin");
		expect(sessionValues.get("user")).toMatchObject({ id: expect.any(String) });
		expect(sessionValues.get("strongReauthentication")).toMatchObject({
			userId: expect.any(String),
			verifiedAt: expect.any(String),
		});

		const options = new OptionsRepository(db);
		expect(await options.get("emdash:setup_complete")).toBe(true);
		expect(await options.get("emdash:setup_state")).toBeNull();
		const user = await db.selectFrom("users").selectAll().executeTakeFirstOrThrow();
		expect(user).toMatchObject({
			email: "mabzadev@gmail.com",
			name: "Mabza",
			role: 50,
			email_verified: 1,
		});
	});

	it("rate-limits setup email sends before a user exists", async () => {
		const sent: Array<{ text: string }> = [];
		const sessionValues = new Map<string, unknown>();
		const makeRequest = () => {
			const request = new Request("https://site.mbza.dev/_emdash/api/setup/admin/email", {
				method: "POST",
				headers: { "content-type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
				body: JSON.stringify({ email: "mabzadev@gmail.com", name: "Mabza" }),
			});
			Object.defineProperty(request, "cf", { value: {} });
			return request;
		};
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const request = makeRequest();
			expect((await sendSetupEmail(context(db, request, sent, sessionValues))).status).toBe(200);
		}
		const request = makeRequest();
		expect((await sendSetupEmail(context(db, request, sent, sessionValues))).status).toBe(429);
		expect(sent).toHaveLength(3);
	});
});
