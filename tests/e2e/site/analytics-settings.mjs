import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const diagnostic = new URL(
	"/_emdash/api/superboard/plugins/supbrd-plug-analytics/diagnostic",
	origin,
).href;
const health = diagnostic.replace(/diagnostic$/, "health");
const analyticsApplicationPattern = /\/api\/v1\/analytics\/projects\/([^/]+)\/applications/;
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const hydrate = async () => {
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(page.getByRole("tab", { name: "Configuration", exact: true })).toBeVisible();
	};
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/analytics/settings?tab=collection", origin)
			.href,
	);
	await hydrate();
	await page.getByRole("button", { name: "Save settings", exact: true }).waitFor();
	const project = await page.evaluate((pattern) => {
		const applicationRequest = new RegExp(pattern);
		const requests = performance.getEntriesByType("resource").map((entry) => entry.name);
		return requests.map((url) => url.match(applicationRequest)).find(Boolean)?.[1];
	}, analyticsApplicationPattern.source);
	assert.ok(project, "Observed project scope from Analytics application request");
	const base = new URL(`/api/v1/analytics/projects/${project}`, origin).href;
	const endpoint = `${base}/settings`;
	const read = async (path) => {
		const response = await context.request.get(base + path);
		assert.equal(response.status(), 200, await response.text());
		return (await response.json()).data;
	};
	const original = await read("/settings");
	try {
		for (const locale of ["en", "fr"]) {
			await page.goto(new URL(`/analytics/settings?lang=${locale}&tab=collection`, origin).href);
			await hydrate();
			const collectionName = locale === "fr" ? "Collecte des données" : "Data collection";
			const collection = page.getByRole("tab", { name: collectionName, exact: true });
			await expect(collection).toHaveAttribute("aria-selected", "true");
			const sidebarLink = page.locator('aside a[href*="/analytics/settings"]');
			await expect(sidebarLink).toHaveText(locale === "fr" ? "Paramètres" : "Settings");
			await collection.focus();
			await collection.press("ArrowRight");
			await expect(page.getByRole("tab", { name: "Webhooks", exact: true })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await collection.click();
			const zone = locale === "fr" ? "Europe/Paris" : "Europe/Zurich";
			const field = page.getByRole("textbox", {
				name: locale === "fr" ? "Fuseau horaire des rapports" : "Reporting timezone",
				exact: true,
			});
			await field.fill(zone);
			const saved = page.waitForResponse(
				(response) =>
					response.request().method() === "POST" &&
					response.url().includes("command.update_analytics_settings"),
			);
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Enregistrer les paramètres" : "Save settings",
					exact: true,
				})
				.click();
			assert.equal((await saved).status(), 200);
			assert.equal((await read("/settings")).timezone, zone);
			await page.reload();
			await hydrate();
			await expect(field).toHaveValue(zone);
			assert.equal((await read("/settings")).hot_retention_days, original.hot_retention_days);
			await page.getByRole("tab", { name: "Webhooks", exact: true }).click();
			const hookName = `issue85-${locale}-${crypto.randomUUID()}`;
			await page
				.getByRole("textbox", { name: locale === "fr" ? "Nom" : "Name", exact: true })
				.fill(hookName);
			await page
				.getByRole("textbox", {
					name: locale === "fr" ? "Adresse" : "Endpoint",
					exact: true,
				})
				.fill("https://example.com/issue85");
			await page
				.getByRole("textbox", { name: locale === "fr" ? "Événements" : "Events", exact: true })
				.fill("issue85.test");
			await page
				.getByLabel(locale === "fr" ? "Secret de signature" : "Signing secret", { exact: true })
				.fill(crypto.randomUUID());
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Ajouter un webhook" : "Add webhook",
					exact: true,
				})
				.click();
			await expect(page.getByText(hookName, { exact: true })).toBeVisible();
			const storedHook = (await read("/hooks")).items.find((item) => item.name === hookName);
			assert.ok(storedHook);
			assert.equal(storedHook.endpoint_url, "https://example.com/issue85");
			assert.equal(storedHook.secret, undefined);
			assert.equal(storedHook.secret_configured, true);
			try {
				await page.reload();
				await hydrate();
				await expect(page.getByText(hookName, { exact: true })).toBeVisible();
			} finally {
				const removed = await context.request.delete(`${base}/hooks/${storedHook.id}`, {
					headers: {
						Origin: origin.origin,
						"X-EmDash-Request": "1",
						"Idempotency-Key": crypto.randomUUID(),
					},
				});
				assert.equal(removed.status(), 200, await removed.text());
			}

			await page.getByRole("tab", { name: "Annotations", exact: true }).click();
			const annotationTitle = `issue85-${locale}-${crypto.randomUUID()}`;
			await page
				.getByRole("textbox", {
					name: locale === "fr" ? "Titre de l’annotation" : "Annotation title",
					exact: true,
				})
				.fill(annotationTitle);
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Ajouter maintenant" : "Add now",
					exact: true,
				})
				.click();
			await expect(page.getByText(annotationTitle, { exact: true })).toBeVisible();
			const storedAnnotation = (await read("/annotations")).items.find(
				(item) => item.title === annotationTitle,
			);
			assert.ok(storedAnnotation);
			try {
				await page.reload();
				await hydrate();
				await expect(page.getByText(annotationTitle, { exact: true })).toBeVisible();
			} finally {
				const removed = await context.request.delete(`${base}/annotations/${storedAnnotation.id}`, {
					headers: {
						Origin: origin.origin,
						"X-EmDash-Request": "1",
						"Idempotency-Key": crypto.randomUUID(),
					},
				});
				assert.equal(removed.status(), 200, await removed.text());
			}

			await page.getByRole("tab", { name: "Configuration", exact: true }).click();
			await expect(
				page.getByText(locale === "fr" ? "Cycle de vie du plugin" : "Plugin Lifecycle", {
					exact: true,
				}),
			).toBeVisible();
			const checked = page.waitForResponse(
				(response) => response.url() === health && response.request().method() === "POST",
			);
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Vérifier à nouveau" : "Re-check Health",
					exact: true,
				})
				.click();
			const result = await (await checked).json();
			assert.ok(result.checkedAt);
			const inventory = result.diagnostic;
			assert.equal(inventory.pluginId, "supbrd-plug-analytics");
			assert.ok(
				inventory.workers.some((worker) => worker.service === "analytics" && worker.physicalName),
			);
			const routeLabel = locale === "fr" ? "Routes API" : "API Routes";
			await page
				.getByRole("button", {
					name: `${routeLabel} (${inventory.routes.api.length})`,
					exact: true,
				})
				.click();
			const seen = [];
			const table = page.getByRole("table", { name: routeLabel, exact: true });
			while (seen.length < inventory.routes.api.length) {
				await expect(table.getByRole("row").nth(1).getByRole("cell").nth(1)).toHaveText(
					inventory.routes.api[seen.length].path,
				);
				const rows = table.getByRole("row");
				for (let index = 1; index < (await rows.count()); index++)
					seen.push(await rows.nth(index).getByRole("cell").allTextContents());
				if (seen.length < inventory.routes.api.length)
					await page
						.getByRole("button", { name: locale === "fr" ? "Suivant" : "Next", exact: true })
						.click();
			}
			assert.deepEqual(
				seen,
				inventory.routes.api.map((route) => [
					route.method,
					route.path,
					route.worker ?? (locale === "fr" ? "Inconnu" : "Unknown"),
					route.url ?? (locale === "fr" ? "Inconnu" : "Unknown"),
				]),
			);
			await page.route(health, (route) => route.abort("failed"));
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Vérifier à nouveau" : "Re-check Health",
					exact: true,
				})
				.click();
			const workers = page.getByRole("table", {
				name: locale === "fr" ? "Services et Workers associés" : "Associated Services & Workers",
				exact: true,
			});
			await expect(workers).toContainText(locale === "fr" ? "Inconnu" : "Unknown");
			await expect(workers).toContainText(
				inventory.workers.find((worker) => worker.service === "analytics").physicalName,
			);
			await page.unroute(health);
			await page.route(diagnostic, (route) => route.abort("failed"));
			await page.reload();
			await hydrate();
			await expect(
				page.getByText(
					locale === "fr" ? "Échec du chargement du diagnostic" : "Failed to load diagnostic",
					{ exact: true },
				),
			).toBeVisible();
			await page.unroute(diagnostic);
			await page
				.getByRole("button", { name: locale === "fr" ? "Réessayer" : "Retry", exact: true })
				.click();
			await expect(workers).toBeVisible();
			for (const [path, tab] of [
				["events", "collection"],
				["reports", "hooks"],
				["users", "applications"],
			]) {
				await page.goto(new URL(`/analytics/${path}?lang=${locale}`, origin).href);
				await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
				const link = page.locator(`main a[href*="/analytics/settings?tab=${tab}"]`);
				await link.click();
				await hydrate();
				assert.equal(new URL(page.url()).searchParams.get("tab"), tab);
				assert.equal(new URL(page.url()).searchParams.get("lang"), locale);
			}

			console.log(
				`${locale}: sidebar, tab URL/reload, keyboard, save/API reread, signed webhook and annotation reload, ${seen.length} diagnostic routes, health failure and retry passed`,
			);
		}
	} finally {
		const response = await context.request.put(endpoint, {
			headers: {
				Origin: origin.origin,
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
			},
			data: original,
		});
		assert.equal(response.status(), 200, await response.text());
	}
	const anonymous = await browser.newContext();
	for (const [url, method] of [
		[endpoint, "GET"],
		[endpoint, "PUT"],
		[diagnostic, "GET"],
		[health, "POST"],
	]) {
		const response = await anonymous.request.fetch(url, {
			method,
			headers: {
				Origin: origin.origin,
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
			},
			data: method === "PUT" ? {} : undefined,
		});
		assert.equal(response.status(), 401);
	}
	const deniedPage = await anonymous.request.get(new URL("/analytics/settings", origin).href, {
		maxRedirects: 0,
	});
	assert.equal(deniedPage.status(), 302);
	assert.ok(deniedPage.headers().location.includes("login"));
	assert.deepEqual(errors, []);
	console.log(
		"Anonymous settings and diagnostic access refused; original settings restored; retention unchanged.",
	);
} finally {
	await browser.close();
}
