import { expect, test, vi } from "vitest";

import { proxyOperatorApiRequest } from "../src/lib/operator-api-proxy.js";

test("proxies an operator request through the private API binding without leaking cookies", async () => {
	const fetch = vi.fn(async (request: Request) =>
		Response.json({ method: request.method, body: await request.json() }),
	);
	const response = await proxyOperatorApiRequest({
		request: new Request("https://site.example.test/api/v1/analytics/projects/vocostar/reports", {
			method: "POST",
			headers: {
				Origin: "https://site.example.test",
				Cookie: "emdash-session=secret",
				Authorization: "Bearer legacy",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "Weekly" }),
		}),
		operator_email: "MABZADEV@GMAIL.COM",
		env: { API_SERVICE: { fetch }, SITE_OPERATOR_BRIDGE_TOKEN: "site-bridge-secret" },
	});
	expect(response.status).toBe(200);
	const forwarded = fetch.mock.calls[0]?.[0] as Request;
	expect(forwarded.url).toBe("https://api.internal/api/v1/analytics/projects/vocostar/reports");
	expect(forwarded.headers.get("Cookie")).toBeNull();
	expect(forwarded.headers.get("Authorization")).toBeNull();
	expect(forwarded.headers.get("X-SuperBoard-Site-Operator")).toBe("mabzadev@gmail.com");
	expect(forwarded.headers.get("X-SuperBoard-Internal-Token")).toBe("site-bridge-secret");
});

test("fails closed without a private binding, token or same-origin mutation", async () => {
	await expect(
		proxyOperatorApiRequest({
			request: new Request("https://site.example.test/api/v1/status"),
			operator_email: "mabzadev@gmail.com",
			env: {},
		}),
	).resolves.toMatchObject({ status: 503 });
	await expect(
		proxyOperatorApiRequest({
			request: new Request("https://site.example.test/api/v1/status", {
				method: "POST",
				headers: { Origin: "https://evil.example" },
			}),
			operator_email: "mabzadev@gmail.com",
			env: {
				API_SERVICE: { fetch: vi.fn() },
				SITE_OPERATOR_BRIDGE_TOKEN: "site-bridge-secret",
			},
		}),
	).resolves.toMatchObject({ status: 403 });
});
