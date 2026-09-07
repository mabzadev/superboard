import { verifySiteOperatorRequest } from "@superboard/contracts/site-operator";
import { expect, test, vi } from "vitest";

import { proxyOperatorApiRequest } from "../src/lib/operator-api-proxy.js";

test("proxies an operator request through the private API binding without leaking cookies", async () => {
	const fetch = vi.fn(async (request: Request) =>
		Response.json({ method: request.method, body: await request.json() }),
	);
	const response = await proxyOperatorApiRequest({
		request: new Request("https://site.example.test/api/v1/core/reports", {
			method: "POST",
			headers: {
				Origin: "https://site.example.test",
				"X-EmDash-Request": "1",
				Cookie: "emdash-session=secret",
				Authorization: "Bearer legacy",
				"X-SuperBoard-Site-Context": "forged-context",
				"X-SuperBoard-Site-Signature": "forged-signature",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "Weekly" }),
		}),
		operator: { id: "emdash-owner", role: 50 },
		env: {
			SUPERBOARD_INSTANCE_ID: "vocostar",
			API_SERVICE: { fetch },
			SITE_OPERATOR_BRIDGE_TOKEN: "site-bridge-secret",
		},
		command_authority: async ({ dispatch }) => dispatch(),
	});
	expect(response.status).toBe(200);
	const forwarded = fetch.mock.calls[0]?.[0] as Request;
	expect(forwarded.url).toBe("https://api.internal/api/v1/core/reports");
	expect(forwarded.headers.get("Cookie")).toBeNull();
	expect(forwarded.headers.get("Authorization")).toBeNull();
	expect(forwarded.headers.get("X-SuperBoard-Site-Operator")).toBeNull();
	expect(forwarded.headers.get("X-SuperBoard-Internal-Token")).toBeNull();
	expect(await verifySiteOperatorRequest(forwarded, "vocostar", "site-bridge-secret")).toEqual({
		operator_id: "emdash-owner",
		instance_id: "vocostar",
		role: 50,
	});
});

test("fails closed when a mutation cannot first commit to the EmDash command repository", async () => {
	const fetch = vi.fn(async () => Response.json({ ok: true }));
	const response = await proxyOperatorApiRequest({
		request: new Request("https://site.example.test/api/v1/core/reports", {
			method: "POST",
			headers: {
				Origin: "https://site.example.test",
				"X-EmDash-Request": "1",
				"Idempotency-Key": "operation-analytics-1",
			},
			body: "{}",
		}),
		operator: { id: "emdash-owner", role: 50 },
		env: {
			SUPERBOARD_INSTANCE_ID: "vocostar",
			API_SERVICE: { fetch },
			SITE_OPERATOR_BRIDGE_TOKEN: "site-bridge-secret",
		},
	});
	expect(response.status).toBe(503);
	await expect(response.json()).resolves.toEqual({
		error: { code: "COMMAND_REPOSITORY_UNAVAILABLE" },
	});
	expect(fetch).not.toHaveBeenCalled();
});

test("fails closed without a private binding, token or same-origin mutation", async () => {
	await expect(
		proxyOperatorApiRequest({
			request: new Request("https://site.example.test/api/v1/status"),
			operator: { id: "emdash-owner", role: 50 },
			env: {},
		}),
	).resolves.toMatchObject({ status: 503 });
	await expect(
		proxyOperatorApiRequest({
			request: new Request("https://site.example.test/api/v1/status", {
				method: "POST",
				headers: { Origin: "https://evil.example" },
			}),
			operator: { id: "emdash-owner", role: 50 },
			env: {
				SUPERBOARD_INSTANCE_ID: "vocostar",
				API_SERVICE: { fetch: vi.fn() },
				SITE_OPERATOR_BRIDGE_TOKEN: "site-bridge-secret",
			},
		}),
	).resolves.toMatchObject({ status: 403 });
});

test("rejects missing CSRF and insufficient operator permission before dispatch", async () => {
	const fetch = vi.fn(async () => Response.json({ ok: true }));
	const env = {
		SUPERBOARD_INSTANCE_ID: "vocostar",
		API_SERVICE: { fetch },
		SITE_OPERATOR_BRIDGE_TOKEN: "bridge-secret",
	};
	const request = () =>
		new Request("https://site.test/api/v1/core/command", {
			method: "POST",
			headers: { Origin: "https://site.test" },
			body: "{}",
		});
	const csrf = await proxyOperatorApiRequest({
		request: request(),
		operator: { id: "operator", role: 50 },
		env,
	});
	expect(csrf.status).toBe(403);
	expect(await csrf.json()).toEqual({ error: { code: "CSRF_HEADER_REQUIRED" } });
	const permission = await proxyOperatorApiRequest({
		request: request(),
		operator: { id: "operator", role: 30 },
		env,
	});
	expect(permission.status).toBe(403);
	expect(await permission.json()).toEqual({ error: { code: "OPERATOR_REQUIRED" } });
	expect(fetch).not.toHaveBeenCalled();
});
