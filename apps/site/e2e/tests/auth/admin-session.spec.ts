import { expect, test } from "@playwright/test";

test("EmDash login and logout govern both the native back-office and the Superboard console", async ({
	request,
	baseURL,
}) => {
	const origin = new URL(baseURL!).origin;
	const privatePaths = ["/_emdash/admin", "/superboard-system/home", "/identity/en/dashboard"];
	for (const path of privatePaths) {
		const response = await request.get(path, { maxRedirects: 0 });
		expect(response.status()).toBe(302);
		expect(response.headers().location).toContain("/_emdash/admin/login");
	}

	const login = await request.get("/_emdash/api/auth/dev-bypass");
	expect(login.status()).toBe(200);
	const session = await request.get("/_emdash/api/auth/me");
	expect(session.status()).toBe(200);
	const { data: operator } = await session.json();
	expect(operator.role).toBe(50);

	try {
		const admin = await request.get("/_emdash/admin", { maxRedirects: 0 });
		expect(admin.status()).toBe(200);
		expect(admin.headers()["cache-control"]).toContain("no-store");
		expect(await admin.text()).toContain('id="admin-root"');

		const front = await request.get("/superboard-system/home", { maxRedirects: 0 });
		expect(front.status()).toBe(200);
		expect(front.headers()["cache-control"]).toContain("no-store");
		expect(await front.text()).toContain(operator.id);
	} finally {
		const logout = await request.post("/_emdash/api/auth/logout", {
			headers: { Origin: origin, "X-EmDash-Request": "1" },
			data: {},
		});
		expect(logout.status()).toBe(200);
	}

	expect((await request.get("/_emdash/api/auth/me")).status()).toBe(401);
	for (const path of privatePaths) {
		const response = await request.get(path, { maxRedirects: 0 });
		expect(response.status()).toBe(302);
		expect(response.headers().location).toContain("/_emdash/admin/login");
	}
});
