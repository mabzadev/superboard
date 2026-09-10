import { describe, expect, it, vi } from "vitest";

import webhookRoutes from "../../../../../../../packages/plugins/supbrd-core/api/src/routes/purchases-provider-webhooks";
import type { Env } from "../../../../../../../packages/plugins/supbrd-core/api/src/types";
import { createFakeD1 } from "../../helpers/fake-d1";

function envWithDb(db: D1Database, overrides: Partial<Env> = {}) {
	return {
		DB: db,
		ENVIRONMENT: "test",
		...overrides,
	} as Env;
}

describe("Purchases provider webhooks", () => {
	it("routes Apple V2 notifications to Billing only after project and environment validation", async () => {
		const fetch = vi.fn(async (request: Request) => {
			const body = (await request.json()) as Record<string, any>;
			expect(new URL(request.url).pathname).toBe("/internal/v1/provider-events/ingest");
			expect(body).toMatchObject({
				project_id: "10",
				store: "apple",
				environment: "production",
				job: {
					type: "billing.apple.notification",
					projectId: "10",
					environment: "production",
					signedPayload: "header.payload.signature",
				},
			});
			expect(body.external_event_id).toMatch(/^[a-f0-9]{64}$/);
			return Response.json({
				data: {
					event_id: "event-1",
					duplicate: false,
					queued: true,
					processed: false,
				},
			});
		});
		const db = createFakeD1((call) => {
			if (call.op === "first" && call.sql.includes("FROM projects WHERE id = ?")) {
				return { id: 10, is_test: 0 };
			}
			return undefined;
		});
		const response = await webhookRoutes.request(
			"/apple/production/10",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ signedPayload: "header.payload.signature" }),
			},
			envWithDb(db, {
				BILLING_EXECUTION_MODE: "service",
				BILLING: { fetch } as Fetcher,
			}),
		);

		expect(response.status).toBe(202);
		await expect(response.json()).resolves.toEqual({
			received: true,
			queued: true,
			duplicate: false,
			processed: false,
		});
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("rejects an Apple notification sent to the wrong project environment", async () => {
		const fetch = vi.fn();
		const db = createFakeD1((call) => {
			if (call.op === "first" && call.sql.includes("FROM projects WHERE id = ?")) {
				return { id: 10, is_test: 1 };
			}
			return undefined;
		});
		const response = await webhookRoutes.request(
			"/apple/production/10",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"cf-ray": "apple-environment-test",
				},
				body: JSON.stringify({ signedPayload: "header.payload.signature" }),
			},
			envWithDb(db, {
				BILLING_EXECUTION_MODE: "service",
				BILLING: { fetch } as Fetcher,
			}),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			code: "apple_project_not_found",
			message: "Apple notification target was not found",
			retryable: false,
			request_id: "apple-environment-test",
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});
