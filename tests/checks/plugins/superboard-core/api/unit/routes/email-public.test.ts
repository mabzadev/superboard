import { verifyInternalProjectContextRequest } from "@superboard/contracts/project-context";
import { resolveRegisteredRoute } from "@superboard/contracts/route-registry";
import { describe, expect, it, vi } from "vitest";

import { app } from "../../../../../../../packages/plugins/superboard-core/api/src/index.js";
import {
	proxyEmailPublicApi,
	resolveEmailTemplateSource,
} from "../../../../../../../packages/plugins/superboard-core/api/src/routes/email-public";
import type { Env } from "../../../../../../../packages/plugins/superboard-core/api/src/types";

const KEY = `sb_email_${"a".repeat(64)}`;

describe("public transactional email API gateway", () => {
	it("exposes /v1/email/send and message routes on the SDK surface", () => {
		expect(resolveRegisteredRoute(app, "POST", "sdk", "/v1/email/send")).toMatchObject({
			executionPath: "/api/v1/email/send",
			route: { pluginId: "superboard-email", access: "sdk-key" },
		});
		expect(resolveRegisteredRoute(app, "GET", "sdk", "/v1/email/messages/abc")?.executionPath).toBe(
			"/api/v1/email/messages/abc",
		);
		expect(
			resolveRegisteredRoute(app, "POST", "sdk", "/v1/email/messages/abc/cancel")?.executionPath,
		).toBe("/api/v1/email/messages/abc/cancel");
		expect(
			resolveRegisteredRoute(app, "POST", "sdk", "/internal/v1/email/template-source"),
		).toBeNull();
	});

	it("rejects requests without a well-formed server key before reaching the Email Worker", async () => {
		const fetch = vi.fn();
		const env = { EMAIL_SERVICE: { fetch }, EMAIL_INTERNAL_TOKEN: "internal" } as unknown as Env;
		for (const authorization of [undefined, "Bearer og_app_123", `Basic ${KEY}`]) {
			const response = await proxyEmailPublicApi(
				env,
				new Request("https://sdk.example.test/v1/email/send", {
					method: "POST",
					headers: authorization ? { authorization } : {},
					body: "{}",
				}),
				"/internal/v1/public/send",
			);
			expect(response.status).toBe(401);
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it("forwards only the key, idempotency key and body with internal authentication", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				Response.json(
					{ id: "m-1", status: "queued" },
					{ status: 202, headers: { "set-cookie": "x=1" } },
				),
			);
		const env = { EMAIL_SERVICE: { fetch }, EMAIL_INTERNAL_TOKEN: "internal" } as unknown as Env;
		const response = await proxyEmailPublicApi(
			env,
			new Request("https://sdk.example.test/v1/email/send", {
				method: "POST",
				headers: {
					authorization: `Bearer ${KEY}`,
					"content-type": "application/json",
					"idempotency-key": "order-1",
					"x-internal-token": "attacker",
					cookie: "session=secret",
				},
				body: JSON.stringify({ to: "a@example.net" }),
			}),
			"/internal/v1/public/send",
		);
		expect(response.status).toBe(202);
		expect(response.headers.get("set-cookie")).toBeNull();
		const forwarded = fetch.mock.calls[0][0] as Request;
		expect(forwarded.url).toBe("https://email.internal/internal/v1/public/send");
		expect(forwarded.method).toBe("POST");
		expect(forwarded.headers.get("x-internal-token")).toBe("internal");
		expect(forwarded.headers.get("x-superboard-email-key")).toBe(KEY);
		expect(forwarded.headers.get("idempotency-key")).toBe("order-1");
		expect(forwarded.headers.get("authorization")).toBeNull();
		expect(forwarded.headers.get("cookie")).toBeNull();
		await expect(forwarded.json()).resolves.toEqual({ to: "a@example.net" });
	});

	it("rejects oversized bodies from their declared length", async () => {
		const fetch = vi.fn();
		const response = await proxyEmailPublicApi(
			{ EMAIL_SERVICE: { fetch }, EMAIL_INTERNAL_TOKEN: "internal" } as unknown as Env,
			new Request("https://sdk.example.test/v1/email/send", {
				method: "POST",
				headers: { authorization: `Bearer ${KEY}`, "content-length": String(16 * 1024 * 1024) },
				body: "{}",
			}),
			"/internal/v1/public/send",
		);
		expect(response.status).toBe(413);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe("Email Worker template callback", () => {
	it("requires the email internal token", async () => {
		const response = await resolveEmailTemplateSource(
			{ EMAIL_INTERNAL_TOKEN: "internal" } as unknown as Env,
			new Request("https://api.internal/internal/v1/email/template-source", {
				method: "POST",
				headers: { "x-internal-token": "wrong" },
				body: JSON.stringify({ project_id: 1, template_id: "welcome" }),
			}),
		);
		expect(response.status).toBe(401);
	});

	it("reads the published template from Marketing with a signed read-only project context", async () => {
		const marketing = vi
			.fn()
			.mockResolvedValue(
				Response.json({ data: { revision: 4, document: { purpose: "notification" } } }),
			);
		const env = {
			EMAIL_INTERNAL_TOKEN: "internal",
			MODULE_INTERNAL_TOKEN: "module-secret",
			MARKETING_MODULE: { fetch: marketing },
			DB: {
				prepare: () => ({
					bind: () => ({ first: async () => ({ id: 12, instance_id: 3, is_test: 0 }) }),
				}),
			},
		} as unknown as Env;
		const response = await resolveEmailTemplateSource(
			env,
			new Request("https://api.internal/internal/v1/email/template-source", {
				method: "POST",
				headers: { "x-internal-token": "internal", "content-type": "application/json" },
				body: JSON.stringify({ project_id: 12, template_id: "welcome" }),
			}),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			data: { revision: 4, document: { purpose: "notification" } },
		});
		const request = marketing.mock.calls[0][0] as Request;
		expect(new URL(request.url).pathname).toBe("/internal/v1/studio/templates/welcome/published");
		const verified = await verifyInternalProjectContextRequest(
			request,
			["module-secret"],
			"marketing",
		);
		expect(verified).toMatchObject({
			ok: true,
			context: {
				projectId: 12,
				projectRef: "3-prod",
				role: "admin",
				operatorId: "email-api",
				method: "GET",
			},
		});
	});
});
