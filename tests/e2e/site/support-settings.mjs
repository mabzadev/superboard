import assert from "node:assert/strict";

import { chromium, expect as playwrightExpect } from "@playwright/test";

const expect = playwrightExpect.configure({ timeout: 30000 });

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const diagnostic = new URL("/_emdash/api/superboard/plugins/supbrd-plug-support/diagnostic", origin)
	.href;
const health = diagnostic.replace(/diagnostic$/, "health");
const deliveryOperation = /\/(?:send|replay|test)(?:\?|$)/u;
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const errors = [];
	const deliveries = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		if (route.request().method() === "POST" && deliveryOperation.test(route.request().url())) {
			deliveries.push(route.request().url());
			return route.abort("blockedbyclient");
		}
		return route.continue();
	});
	const firstRead = page.waitForResponse((r) => r.url().includes("data_source.support_settings"));
	await page.goto(new URL("/_emdash/api/auth/dev-bypass?redirect=/support/settings", origin).href);
	const requestUrl = new URL((await firstRead).url());
	const endpoint = new URL(JSON.parse(requestUrl.searchParams.get("request")).path, origin).href;
	const read = async () => {
		const response = await context.request.get(endpoint);
		assert.equal(response.status(), 200);
		return (await response.json()).data;
	};
	const mutate = async (url, method, data) => {
		const response = await context.request.fetch(url, {
			method,
			data,
			headers: {
				Origin: origin.origin,
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
			},
		});
		assert.ok(response.ok(), await response.text());
	};
	const original = (await read()).settings;

	const hydrate = async () => {
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(page.getByRole("tab", { name: "Configuration", exact: true })).toBeVisible();
	};
	const open = async (tab, locale) => {
		await page.goto(new URL(`/support/settings?tab=${tab}&lang=${locale}`, origin).href);
		await hydrate();
		if (tab === "general")
			await expect(
				page.getByRole("button", {
					name: locale === "fr" ? "Enregistrer les paramètres" : "Save settings",
					exact: true,
				}),
			).toBeEnabled();
	};
	try {
		for (const locale of ["en", "fr"]) {
			const fr = locale === "fr";
			await open("general", locale);
			await expect(page.getByRole("tab")).toHaveCount(9);
			await expect(
				page.getByLabel(fr ? "Fonctionnalités (JSON)" : "Feature flags", { exact: true }),
			).not.toBeVisible();
			await expect(page.locator('aside a[href*="/support/settings"]')).toHaveCount(1);
			await expect(page.locator('aside a[href*="/support/configuration"]')).toHaveCount(0);
			const general = page.getByRole("tab", { name: fr ? "Général" : "General", exact: true });
			await general.focus();
			await general.press("ArrowRight");
			await expect(page.getByRole("tab", { name: "Notifications", exact: true })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await general.click();
			const business = page.getByLabel(fr ? "Nom de l’entreprise" : "Business name", {
				exact: true,
			});
			await expect(business).toHaveValue(original.business_name);
			const name = `issue84-${locale}`;
			await business.fill(name);
			await page
				.getByLabel(fr ? "Taille maximale en octets" : "Attachment limit in bytes", { exact: true })
				.fill("1048577");
			await page
				.getByLabel(fr ? "Format de date" : "Date format", { exact: true })
				.fill("DD.MM.YYYY");
			await page
				.getByLabel(fr ? "Types de contenu autorisés" : "Allowed content types", { exact: true })
				.fill("image/gif, application/pdf");
			await page
				.getByText(fr ? "Paramètres avancés" : "Advanced settings", { exact: true })
				.click();
			await page
				.getByLabel(fr ? "Fonctionnalités (JSON)" : "Feature flags", { exact: true })
				.fill('{"custom_feature":false,"captain":true}');
			const saved = page.waitForResponse((r) =>
				r.url().includes("command.update_support_settings"),
			);
			await page
				.getByRole("button", {
					name: fr ? "Enregistrer les paramètres" : "Save settings",
					exact: true,
				})
				.click();
			const saveResponse = await saved;
			assert.ok(saveResponse.ok());

			await expect.poll(async () => (await read()).settings.business_name).toBe(name);
			const stored = (await read()).settings;
			assert.equal(stored.business_name, name);
			assert.equal(stored.attachment_max_bytes, 1048577);
			assert.equal(stored.features.custom_feature, false);
			assert.deepEqual(stored.allowed_content_types, ["image/gif", "application/pdf"]);
			assert.equal(stored.date_format, "DD.MM.YYYY");
			await page.reload();
			await hydrate();
			await expect(business).toHaveValue(name);
			await open("notifications", locale);
			const preferencesUrl = endpoint.replace(/\/settings$/u, "/notifications/preferences");
			const preferencesResponse = await context.request.get(preferencesUrl);
			assert.equal(preferencesResponse.status(), 200);
			const preferences = (await preferencesResponse.json()).data;
			try {
				const audio = page.getByRole("switch", {
					name: fr ? "Sons des notifications" : "Notification sounds",
					exact: true,
				});
				await expect(audio).toBeEnabled();
				await expect(audio).toBeChecked({ checked: preferences.audio_enabled });
				await audio.setChecked(!preferences.audio_enabled);
				const preferenceSave = page.waitForResponse(
					(response) => response.url() === preferencesUrl && response.request().method() === "PUT",
				);
				await page
					.getByRole("button", {
						name: fr ? "Enregistrer les préférences" : "Save preferences",
						exact: true,
					})
					.click();
				assert.ok((await preferenceSave).ok());
				const reread = await context.request.get(preferencesUrl);
				assert.equal((await reread.json()).data.audio_enabled, !preferences.audio_enabled);
				await page.reload();
				await hydrate();
				await expect(audio).toBeChecked({ checked: !preferences.audio_enabled });
			} finally {
				await mutate(preferencesUrl, "PUT", preferences);
			}
			for (const path of ["channels", "workforce", "automations", "integrations"]) {
				await page.goto(new URL(`/support/${path}?lang=${locale}`, origin).href);
				await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
				await expect(
					page.getByRole("link", {
						name: fr ? "Ouvrir les paramètres" : "Open settings",
						exact: true,
					}),
				).toHaveCount(0);
				await expect(page.locator("main h1")).toHaveCount(1);
			}

			await open("configuration", locale);
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
			assert.equal(inventory.pluginId, "supbrd-plug-support");
			assert.ok(
				inventory.workers.some((worker) => worker.service === "support" && worker.physicalName),
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
				inventory.workers.find((worker) => worker.service === "support").physicalName,
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
			await page.goto(new URL(`/support/configuration?lang=${locale}`, origin).href);
			await page.waitForURL((url) => url.pathname === "/support/settings");
			await hydrate();
			assert.equal(new URL(page.url()).searchParams.get("tab"), "general");
			await mutate(endpoint, "PATCH", original);
			console.log(
				`${locale}: menu, keyboard, settings and notification save/reload/API read, clean functional pages, legacy URL, diagnostic pagination and failure recovery passed`,
			);
		}
	} finally {
		await mutate(endpoint, "PATCH", original);
	}
	const anonymous = await browser.newContext();
	for (const [url, method] of [
		[endpoint, "GET"],
		[endpoint, "PATCH"],
		[endpoint + "/entities", "POST"],
		[diagnostic, "GET"],
		[health, "POST"],
	]) {
		const response = await anonymous.request.fetch(url, {
			method,
			headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			data: method === "GET" ? undefined : {},
		});
		assert.equal(response.status(), 401);
	}
	const denied = await anonymous.request.get(new URL("/support/settings", origin).href, {
		maxRedirects: 0,
	});
	assert.equal(denied.status(), 302);
	assert.deepEqual(deliveries, []);
	assert.deepEqual(errors, []);
	console.log("Anonymous reads/writes denied, no sends, original settings restored.");
} finally {
	await browser.close();
}
