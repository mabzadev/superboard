import { expect, test } from "@playwright/test";

test("a frontend language chosen before login survives the redirect", async ({
	request,
	baseURL,
}) => {
	const redirect = await request.get("/?lang=fr", { maxRedirects: 0 });
	expect(redirect.status()).toBe(302);
	expect((await request.get("/_emdash/api/auth/dev-bypass")).status()).toBe(200);
	try {
		const front = await request.get("/superboard-system/home", {
			headers: { "Accept-Language": "en" },
		});
		expect((await front.text()).match(/<html lang="([^"]+)"/u)?.[1]).toBe("fr");
	} finally {
		await request.post("/_emdash/api/auth/logout", {
			headers: { Origin: new URL(baseURL!).origin, "X-EmDash-Request": "1" },
			data: {},
		});
	}
});

test("a frontend language choice survives navigation, reload, and a stale Identity locale", async ({
	request,
	baseURL,
}) => {
	expect((await request.get("/_emdash/api/auth/dev-bypass")).status()).toBe(200);
	try {
		const selected = await request.get("/superboard-system/home?lang=fr", {
			headers: { "Accept-Language": "en" },
		});
		expect(selected.status()).toBe(200);
		expect((await selected.text()).match(/<html lang="([^"]+)"/u)?.[1]).toBe("fr");
		for (const path of ["/superboard-system/home", "/identity/en/dashboard", "/analytics"]) {
			const response = await request.get(path, { headers: { "Accept-Language": "en" } });
			expect(response.status()).toBe(200);
			expect((await response.text()).match(/<html lang="([^"]+)"/u)?.[1], path).toBe("fr");
		}
		await request.get("/superboard-system/home?lang=en");
		const switched = await request.get("/superboard-system/home", {
			headers: { "Accept-Language": "fr" },
		});
		expect((await switched.text()).match(/<html lang="([^"]+)"/u)?.[1]).toBe("en");
	} finally {
		await request.post("/_emdash/api/auth/logout", {
			headers: { Origin: new URL(baseURL!).origin, "X-EmDash-Request": "1" },
			data: {},
		});
	}
});
