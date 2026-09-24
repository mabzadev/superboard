import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const packages = JSON.parse(
	await readFile(
		new URL("../../../scripts/config/superboard-plugin-packages.json", import.meta.url),
		"utf8",
	),
);
const packageDirectory = Object.fromEntries(
	packages.packages.map((item) => [item.id, item.directory]),
);
const settings = [
	["auth", "supbrd-plug-identity"],
	["data", "supbrd-plug-data"],
	["monetization", "supbrd-plug-commerce"],
	["communication", "supbrd-plug-communication"],
	["acquisition", "supbrd-plug-journeys"],
	["support", "supbrd-plug-support"],
	["analytics", "supbrd-plug-analytics"],
];
const results = [];
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/superboard-system/home", origin).href,
	);
	await page.waitForURL((url) => url.pathname === "/superboard-system/home");
	for (const locale of ["en", "fr"]) {
		for (const [path, pluginId] of settings) {
			const url = new URL(`/${path}/settings?lang=${locale}`, origin).href;
			console.log(`Checking ${url}`);
			const errors = [];
			const onError = (error) => errors.push(error.message);
			const onResponse = (response) => {
				if (response.status() >= 400 && new URL(response.url()).origin === origin.origin)
					errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
			};
			page.on("pageerror", onError);
			page.on("response", onResponse);
			let releaseId;
			let health;
			let checkedApiRoutes = 0;
			let checkedServices = [];
			try {
				let response = await page.goto(url);
				if (!response) response = await page.reload();
				assert.equal(response?.status(), 200);
				await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
				await expect(page.locator("main h1").first()).toBeVisible();
				releaseId = await page
					.locator('meta[name="superboard-release-id"]')
					.getAttribute("content");
				assert.ok(releaseId);
				const configuration = page
					.getByRole("tab", { name: "Configuration", exact: true })
					.or(page.getByRole("button", { name: "Configuration", exact: true }))
					.first();
				await configuration.focus();
				await configuration.press("Enter");
				await expect(
					page.getByText(locale === "fr" ? "Cycle de vie du plugin" : "Plugin Lifecycle", {
						exact: true,
					}),
				).toBeVisible();
				const endpoint = new URL(`/_emdash/api/superboard/plugins/${pluginId}/diagnostic`, origin)
					.href;
				const diagnosticResponse = await context.request.get(endpoint, { timeout: 30000 });
				assert.equal(diagnosticResponse.status(), 200);
				const diagnostic = await diagnosticResponse.json();
				assert.equal(diagnostic.pluginId, pluginId);
				assert.ok(diagnostic.routes.views.length > 0);
				await expect(
					page.getByText(
						locale === "fr" ? "Services et Workers associés" : "Associated Services & Workers",
						{ exact: true },
					),
				).toBeVisible();
				const healthResponse = page.waitForResponse(
					(item) =>
						item.url().includes("/plugins/") &&
						item.url().endsWith("/health") &&
						item.request().method() === "POST",
				);
				await page
					.getByRole("button", {
						name: locale === "fr" ? "Vérifier à nouveau" : "Re-check Health",
						exact: true,
					})
					.click();
				const checked = await healthResponse;
				assert.equal(checked.status(), 200);
				health = await checked.json();
				assert.ok(health.checkedAt);
				assert.ok(
					["ready", "unavailable", "unknown", "expired", "degraded"].includes(health.status),
				);
				const refreshed = health.diagnostic;
				assert.ok(
					[pluginId, packageDirectory[pluginId]].includes(refreshed?.pluginId),
					`Health re-check must identify the ${pluginId} package, got ${refreshed?.pluginId}`,
				);
				const labels =
					locale === "fr"
						? {
								ready: "Disponible",
								unavailable: "Indisponible",
								unknown: "Inconnu",
								expired: "Périmé",
							}
						: {
								ready: "Ready",
								unavailable: "Unavailable",
								unknown: "Unknown",
								expired: "Expired",
							};
				const workerTable = page.getByRole("table", {
					name: locale === "fr" ? "Services et Workers associés" : "Associated Services & Workers",
					exact: true,
				});
				for (const worker of refreshed.workers) {
					assert.ok(worker.health, `Missing service health for ${worker.service}`);
					const row = workerTable
						.getByRole("row")
						.filter({ has: page.getByRole("cell", { name: worker.service, exact: true }) });
					await expect(row).toContainText(labels[worker.health.status]);
					if (worker.health.checkedAt)
						await expect(row.locator("time")).toHaveAttribute("datetime", worker.health.checkedAt);
					if (worker.physicalName) await expect(row).toContainText(worker.physicalName);
				}
				checkedServices = refreshed.workers.map((worker) => ({
					service: worker.service,
					status: worker.health.status,
					checkedAt: worker.health.checkedAt,
				}));
				const routeLabel = locale === "fr" ? "Routes API" : "API Routes";
				await page
					.getByRole("button", {
						name: `${routeLabel} (${refreshed.routes.api.length})`,
						exact: true,
					})
					.click();
				if (refreshed.routes.api.length) {
					const table = page.getByRole("table", { name: routeLabel, exact: true });
					const observed = [];
					const next = page.getByRole("button", {
						name: locale === "fr" ? "Suivant" : "Next",
						exact: true,
					});
					while (observed.length < refreshed.routes.api.length) {
						await expect(table.getByRole("row").nth(1).getByRole("cell").nth(1)).toHaveText(
							refreshed.routes.api[observed.length].path,
						);
						const rows = table.getByRole("row");
						for (let index = 1; index < (await rows.count()); index++)
							observed.push(await rows.nth(index).getByRole("cell").allTextContents());
						assert.ok(observed.length <= refreshed.routes.api.length);
						if (observed.length < refreshed.routes.api.length) {
							await expect(next).toBeEnabled();
							await next.click();
						}
					}
					assert.deepEqual(
						observed,
						refreshed.routes.api.map((route) => [
							route.method,
							route.path,
							route.worker ?? labels.unknown,
							route.url ?? labels.unknown,
						]),
					);
					checkedApiRoutes = observed.length;
				}
				assert.deepEqual(errors, []);
			} catch (error) {
				errors.push(error.message);
			} finally {
				page.off("pageerror", onError);
				page.off("response", onResponse);
			}
			const result = {
				url,
				locale,
				pluginId,
				releaseId,
				health: health ? { status: health.status, checkedAt: health.checkedAt } : null,
				checkedApiRoutes,
				checkedServices,
				errors,
			};
			results.push(result);
			console.log(JSON.stringify(result));
		}
	}
} finally {
	await browser.close();
	if (process.env.SUPERBOARD_SETTINGS_REPORT)
		await writeFile(process.env.SUPERBOARD_SETTINGS_REPORT, JSON.stringify({ results }, null, 2), {
			mode: 0o600,
		});
}
assert.equal(results.length, settings.length * 2);
assert.equal(
	results.filter((result) => result.errors.length).length,
	0,
	"Settings validation failed; inspect the per-page results.",
);
