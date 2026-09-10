import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { authMiddleware } from "../../../../../../../packages/plugins/supbrd-core/api/src/middleware/auth";

describe("Billing internal authentication", () => {
	it("accepts an API-authenticated actor only inside the private Billing execution domain", async () => {
		const app = new Hono<any>();
		app.use("*", authMiddleware as any);
		app.get("/actor", (c) => c.json({ actor: c.get("userId") }));
		const response = await app.request(
			"/actor",
			{
				headers: { "X-SuperBoard-Internal-Actor": "42" },
			},
			{
				CREDENTIAL_KEY_SCOPE: "billing",
				DB: {
					prepare: vi.fn(() => {
						throw new Error("DB authentication must not run");
					}),
				},
			},
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ actor: 42 });
	});

	it("rejects a forged internal actor header on the public API", async () => {
		const app = new Hono<any>();
		app.use("*", authMiddleware as any);
		app.get("/actor", (c) => c.json({ actor: c.get("userId") }));
		const response = await app.request(
			"/actor",
			{
				headers: { "X-SuperBoard-Internal-Actor": "42" },
			},
			{ CREDENTIAL_KEY_SCOPE: "api", DB: {} },
		);
		expect(response.status).toBe(401);
	});
});

describe("Site operator bridge authentication", () => {
	it("rejects the retired email bridge even with its shared token", async () => {
		const app = new Hono<any>();
		app.use("*", authMiddleware as any);
		app.get("/actor", (c) => c.json({ actor: c.get("userId") }));
		const response = await app.request(
			"/actor",
			{
				headers: {
					"X-SuperBoard-Site-Operator": "mabzadev@gmail.com",
					"X-SuperBoard-Internal-Token": "site-bridge-secret",
				},
			},
			{
				CREDENTIAL_KEY_SCOPE: "api",
				SITE_OPERATOR_BRIDGE_TOKEN: "site-bridge-secret",
				DB: {},
			},
		);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Invalid or expired token" });
	});

	it("rejects a forged Site operator header without the shared internal token", async () => {
		const app = new Hono<any>();
		app.use("*", authMiddleware as any);
		app.get("/actor", (c) => c.json({ actor: c.get("userId") }));
		const response = await app.request(
			"/actor",
			{
				headers: {
					"X-SuperBoard-Site-Operator": "mabzadev@gmail.com",
					"X-SuperBoard-Internal-Token": "forged",
				},
			},
			{
				CREDENTIAL_KEY_SCOPE: "api",
				SITE_OPERATOR_BRIDGE_TOKEN: "site-bridge-secret",
				DB: {},
			},
		);
		expect(response.status).toBe(401);
	});
});
