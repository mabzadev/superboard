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

interface CookieJar {
	jar: Map<string, CookieRecord>;
	cookies: AstroCookies;
}

function createCookieJar(initial: Record<string, string> = {}): CookieJar {
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

function buildAdminRequest(body: unknown): Request {
	return new Request("http://localhost/_emdash/api/setup/admin", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function buildVerifyRequest(body: unknown): Request {
	return new Request("http://localhost/_emdash/api/setup/admin/verify", {
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

const adminBody = { email: "real@admin.example", name: "Real Admin" };
const attackerBody = { email: "attacker@evil.example", name: "Attacker" };

const bogusCredential = {
	credential: {
		id: "AA",
		rawId: "AA",
		type: "public-key" as const,
		response: {
			clientDataJSON: "AA",
			attestationObject: "AA",
		},
	},
};

describe("POST /setup/admin — session nonce binding", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("sets a HttpOnly nonce cookie on the response and stores it with setup state", async () => {
		const { jar, cookies } = createCookieJar();

		const res = await postAdmin(buildContext(db, buildAdminRequest(adminBody), cookies));
		expect(res.status).toBe(200);

		const cookie = jar.get("emdash_setup_nonce");
		expect(cookie).toBeDefined();
		expect(cookie!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(cookie!.options.httpOnly).toBe(true);
		expect(cookie!.options.sameSite).toBe("strict");
		expect(cookie!.options.path).toBe("/_emdash/");

		const options = new OptionsRepository(db);
		const setupState = await options.get<{ email: string; nonce: string }>("emdash:setup_state");
		expect(setupState).toBeDefined();
		expect(setupState?.email).toBe("real@admin.example");
		expect(setupState?.nonce).toBe(cookie!.value);
	});

	it("sets Secure on the nonce cookie when the public origin is HTTPS, even if the internal request URL is HTTP", async () => {
		const { jar, cookies } = createCookieJar();
		const request = buildAdminRequest(adminBody);
		const ctx = buildContext(db, request, cookies);
		(ctx as { url: URL }).url = new URL("http://internal.localhost/_emdash/api/setup/admin");
		(ctx.locals as { emdash: { config: { siteUrl: string } } }).emdash.config = {
			siteUrl: "https://public.example.com",
		};

		const res = await postAdmin(ctx);
		expect(res.status).toBe(200);

		const cookie = jar.get("emdash_setup_nonce");
		expect(cookie).toBeDefined();
		expect(cookie!.options.secure).toBe(true);
	});

	it("omits Secure on the nonce cookie when the public origin is HTTP (local dev)", async () => {
		const { jar, cookies } = createCookieJar();
		const res = await postAdmin(buildContext(db, buildAdminRequest(adminBody), cookies));
		expect(res.status).toBe(200);

		const cookie = jar.get("emdash_setup_nonce");
		expect(cookie).toBeDefined();
		expect(cookie!.options.secure).toBe(false);
	});

	it("rejects /admin/verify when no nonce cookie is present", async () => {
		const { cookies: adminCookies } = createCookieJar();
		const adminRes = await postAdmin(buildContext(db, buildAdminRequest(adminBody), adminCookies));
		expect(adminRes.status).toBe(200);

		const { cookies: noCookies } = createCookieJar();
		const verifyRes = await postAdminVerify(
			buildContext(db, buildVerifyRequest(bogusCredential), noCookies),
		);
		expect(verifyRes.status).toBe(400);
		const body = (await verifyRes.json()) as { error?: { code?: string } };
		expect(body.error?.code).toBe("INVALID_STATE");
	});

	it("rejects /admin/verify when the nonce cookie does not match the stored nonce", async () => {
		const { cookies: adminCookies } = createCookieJar();
		const adminRes = await postAdmin(buildContext(db, buildAdminRequest(adminBody), adminCookies));
		expect(adminRes.status).toBe(200);

		const { cookies: attackerCookies } = createCookieJar({
			emdash_setup_nonce: "obviously-wrong-value",
		});
		const verifyRes = await postAdminVerify(
			buildContext(db, buildVerifyRequest(bogusCredential), attackerCookies),
		);
		expect(verifyRes.status).toBe(400);
		const body = (await verifyRes.json()) as { error?: { code?: string } };
		expect(body.error?.code).toBe("INVALID_STATE");
	});

	it("blocks the email-hijack attack: attacker overwrites setup_state but cannot complete verify", async () => {
		const { jar: adminJar, cookies: adminCookies } = createCookieJar();
		const firstRes = await postAdmin(buildContext(db, buildAdminRequest(adminBody), adminCookies));
		expect(firstRes.status).toBe(200);
		const adminNonce = adminJar.get("emdash_setup_nonce")!.value;

		const { jar: attackerJar, cookies: attackerCookies } = createCookieJar();
		const attackerRes = await postAdmin(
			buildContext(db, buildAdminRequest(attackerBody), attackerCookies),
		);
		expect(attackerRes.status).toBe(200);
		const attackerNonce = attackerJar.get("emdash_setup_nonce")!.value;
		expect(attackerNonce).not.toBe(adminNonce);

		const verifyRes = await postAdminVerify(
			buildContext(db, buildVerifyRequest(bogusCredential), adminCookies),
		);
		expect(verifyRes.status).toBe(400);
		const body = (await verifyRes.json()) as { error?: { code?: string } };
		expect(body.error?.code).toBe("INVALID_STATE");
	});

	it("allows a legitimate admin to retry /setup/admin and reuse the new cookie", async () => {
		const { jar, cookies } = createCookieJar();
		const first = await postAdmin(buildContext(db, buildAdminRequest(adminBody), cookies));
		expect(first.status).toBe(200);
		const nonceA = jar.get("emdash_setup_nonce")!.value;

		const second = await postAdmin(buildContext(db, buildAdminRequest(adminBody), cookies));
		expect(second.status).toBe(200);
		const nonceB = jar.get("emdash_setup_nonce")!.value;
		expect(nonceB).not.toBe(nonceA);

		const options = new OptionsRepository(db);
		const setupState = await options.get<{ nonce: string }>("emdash:setup_state");
		expect(setupState?.nonce).toBe(nonceB);
	});
});
