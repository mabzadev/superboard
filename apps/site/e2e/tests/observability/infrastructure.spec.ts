import type { Page, Response as BrowserResponse } from "@playwright/test";
import { z } from "zod";

import { test, expect } from "../../fixtures/base-fixtures.js";
import { evidence, ready, unwrap } from "../../fixtures/site-api.js";

const schema = z.object({
	status: z.string(),
	catalog: z.object({ status: z.literal("ok") }),
	generatedAt: z.string().datetime(),
	environment: z.string(),
	deployment: z.object({
		target: z.string().min(1),
		release: z.string(),
		publicRouting: z.string(),
	}),
	metricAvailability: z.object({
		mode: z.literal("managed"),
		historicalMetrics: z.literal("unavailable"),
	}),
	metrics: z.object({
		projects: z.number().int().positive(),
		instances: z.number().int().positive(),
		users: z.null(),
	}),
	endpoints: z.record(z.string(), z.string().nullable()),
	services: z
		.array(
			z.object({
				id: z.string(),
				status: z.string(),
				workerName: z.string().nullable().optional(),
				detail: z.unknown().optional(),
			}),
		)
		.min(1),
	dataStores: z
		.array(
			z.object({
				id: z.string(),
				kind: z.string(),
				status: z.string(),
				schema: z
					.object({
						status: z.string(),
						expectedMigration: z.string(),
						latestMigration: z.string().nullable(),
					})
					.nullable()
					.optional(),
			}),
		)
		.min(1),
	runtime: z
		.object({
			error: z.string().optional(),
			rows: z.array(
				z.object({
					service: z.string(),
					eventType: z.string(),
					outcome: z.string(),
					invocations: z.number(),
					exceptions: z.number(),
				}),
			),
		})
		.nullable(),
	custom: z.object({ status: z.string() }),
});
type Infrastructure = z.infer<typeof schema>;
function statusResponse(response: BrowserResponse) {
	const pathname = new URL(response.url()).pathname;
	return (
		response.request().method() === "GET" &&
		(pathname === "/api/v1/platform/status" ||
			pathname.endsWith("/supbrd-plugmod-observability.data_source.platform_status"))
	);
}
async function assertVisibleStatus(page: Page, value: Infrastructure) {
	const main = page.locator("main");
	const card = (title: string) =>
		main.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) });
	await expect(card("Platform").locator("p").last()).toHaveText(value.status);
	await expect(card("Projects").locator("p").last()).toHaveText(
		new Intl.NumberFormat().format(value.metrics.projects),
	);
	await expect(card("Users").locator("p").last()).toHaveText("Unavailable");
	const runtime = card("Cloudflare runtime");
	if (!value.runtime) await expect(runtime).toContainText("Observability binding is disabled.");
	else if (value.runtime.error) await expect(runtime).toContainText(value.runtime.error);
	else if (value.runtime.rows.length === 0)
		await expect(runtime).toContainText("No invocation has been recorded in this window.");
	else {
		for (const row of value.runtime.rows) {
			const cells = runtime
				.getByRole("row")
				.filter({ has: page.getByRole("cell", { name: row.service, exact: true }) })
				.filter({ has: page.getByRole("cell", { name: row.eventType, exact: true }) })
				.filter({ has: page.getByRole("cell", { name: row.outcome, exact: true }) });
			await expect(cells).toContainText(new Intl.NumberFormat().format(row.invocations));
		}
	}
	const expectedInvocations =
		!value.runtime || value.runtime.error
			? "Unavailable"
			: new Intl.NumberFormat().format(
					value.runtime.rows.reduce((sum, row) => sum + row.invocations, 0),
				);
	await expect(card("Invocations (60 min)").locator("p").last()).toHaveText(expectedInvocations);
	const endpoints = card("Endpoints");
	const configured = Object.values(value.endpoints).filter(
		(url): url is string => typeof url === "string",
	);
	expect(configured.length).toBeGreaterThan(0);
	for (const url of configured)
		await expect(endpoints.getByRole("link", { name: url, exact: true })).toHaveAttribute(
			"href",
			url,
		);
	expect(value.services.some((service) => service.id === "dashboard")).toBe(false);
	expect(value.services.some((service) => service.id === "site")).toBe(true);
	expect(value.dataStores.some((store) => store.id === "dashboard-cache")).toBe(false);
	const workers = card("Workers");
	for (const service of value.services) {
		const panel = workers.locator('[data-slot="card-content"] > div').filter({
			has: page.locator("strong").filter({
				hasText: new RegExp(`^${service.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
			}),
		});
		await expect(panel.locator('[data-slot="badge"]').first()).toHaveText(service.status);
		if (service.workerName) await expect(panel).toContainText(service.workerName);
	}
	const stores = card("Data stores");
	const d1 = value.dataStores.find(
		(store) => store.kind === "D1" && store.schema?.expectedMigration,
	);
	expect(d1, "A real D1 schema report is required").toBeDefined();
	const storePanel = stores
		.locator('[data-slot="card-content"] > div')
		.filter({ has: page.locator("strong").filter({ hasText: d1!.id }) });
	await expect(storePanel).toContainText(`Expected: ${d1!.schema!.expectedMigration}`);
	await expect(storePanel).toContainText(`Applied: ${d1!.schema!.latestMigration ?? "none"}`);
	await expect(
		main.getByText(`Target ${value.deployment.target} · Environment ${value.environment}`, {
			exact: false,
		}),
	).toBeVisible();
	return workers;
}

test("Infrastructure displays real health, target endpoints and metrics then refreshes its observation", async ({
	authenticatedPage: page,
}) => {
	const firstResponse = page.waitForResponse(statusResponse);
	await ready(page, "/infrastructure");
	await expect(page.getByRole("heading", { name: "Infrastructure", exact: true })).toBeVisible();
	const first = await firstResponse;
	expect(first.ok()).toBe(true);
	const initial = schema.parse(unwrap(await first.json()));
	await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
	await expect(page.getByText("Status unavailable", { exact: true })).toHaveCount(0);
	await assertVisibleStatus(page, initial);
	const refreshedResponse = page.waitForResponse(statusResponse);
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	const refreshed = await refreshedResponse;
	expect(refreshed.ok()).toBe(true);
	const current = schema.parse(unwrap(await refreshed.json()));
	expect(Date.parse(current.generatedAt)).toBeGreaterThan(Date.parse(initial.generatedAt));
	await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
	await assertVisibleStatus(page, current);
	const unavailable = current.services
		.filter((service) => service.status !== "ok")
		.map((service) => ({ id: service.id, status: service.status }));
	await test.info().attach("observed-infrastructure", {
		contentType: "application/json",
		body: JSON.stringify({
			generated_at: current.generatedAt,
			target: current.deployment.target,
			projects: current.metrics.projects,
			historical_users: "unavailable",
			runtime_error: current.runtime?.error ?? null,
			custom_status: current.custom.status,
			services: current.services.map(({ id, status }) => ({ id, status })),
			data_stores: current.dataStores.map(({ id, kind, status }) => ({ id, kind, status })),
		}),
	});
	await evidence(
		"supbrd-plugmod-observability",
		"superboard.infrastructure",
		[current.deployment.target, ...current.dataStores.map((store) => store.id)],
		`Compared rendered health badges, project count, explicit unavailable historical metrics, configured endpoint links and a real D1 schema with canonical Worker responses, then clicked Refresh and verified a newer response. Non-healthy or disabled services remained explicit: ${JSON.stringify(unavailable)}. External Custom status: ${current.custom.status}.`,
	);
});
