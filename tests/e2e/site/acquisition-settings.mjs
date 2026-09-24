import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const hydrate = async () => {
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(page.getByRole("tab", { name: "Configuration", exact: true })).toBeVisible();
	};
	const open = async (path) => {
		await page.goto(new URL(path, origin).href);
		await hydrate();
	};
	await open("/_emdash/api/auth/dev-bypass?redirect=/acquisition/settings");
	const read = async (resource) => {
		const result = await context.request.get(
			new URL(`/api/v1/flows/projects/1-prod/${resource}`, origin).href,
		);
		assert.equal(result.status(), 200, await result.text());
		const body = await result.json();
		return body.data ?? body;
	};
	for (const locale of ["en", "fr"]) {
		const fr = locale === "fr";
		await open(`/acquisition/settings?lang=${locale}`);
		const menu = page.locator('a[href*="/acquisition/settings"]').first();
		await expect(menu).toBeVisible();
		await expect(menu).toHaveText(fr ? "Paramètres" : "Settings");
		const envTab = page.getByRole("tab", {
			name: fr ? "Environnements" : "Environments",
			exact: true,
		});
		await envTab.focus();
		await envTab.press("ArrowRight");
		await expect(page.getByRole("tab", { name: "SDK", exact: true })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		assert.equal(new URL(page.url()).searchParams.get("tab"), "sdk");
		await envTab.click();
		await page
			.getByRole("button", { name: fr ? "Nouvel environnement" : "New environment", exact: true })
			.click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("combobox").click();
		await page.getByRole("option", { name: "Production", exact: true }).click();
		await expect(dialog.getByRole("switch")).toBeDisabled();
		await expect(dialog.getByRole("switch")).not.toBeChecked();
		await dialog.getByRole("combobox").click();
		await page
			.getByRole("option", { name: fr ? "Développement" : "Development", exact: true })
			.click();
		const name = `issue83-${locale}-${Date.now()}`;
		await dialog.locator("input").nth(0).fill(name);
		await dialog.locator("input").nth(1).fill(name);
		const saved = page.waitForResponse(
			(r) => r.url().includes(".command.create_environment") && r.request().method() === "POST",
		);
		await dialog.getByRole("button", { name: fr ? "Créer" : "Create", exact: true }).click();
		assert.equal((await saved).status(), 201);
		await dialog.waitFor({ state: "hidden" });
		await page.reload();
		await hydrate();
		await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
		const environments = await read("environments");
		assert.ok(environments.items.some((env) => env.key === name && env.kind === "development"));
		await page.getByRole("tab", { name: "SDK", exact: true }).click();
		await page.locator("main").getByRole("combobox").click();
		await page.getByRole("option", { name, exact: true }).click();
		await expect(page.locator("pre code")).toContainText(`environment: "${name}"`);
		await page.getByRole("tab", { name: "React", exact: true }).click();
		await expect(page.locator("pre code")).toContainText(`environment="${name}"`);
		await page
			.getByRole("tab", { name: fr ? "Localisation" : "Localization", exact: true })
			.click();
		await page
			.getByRole("button", { name: fr ? "Nouveau groupe" : "New group", exact: true })
			.click();
		const inputs = page.locator('main [role="tabpanel"][data-state="active"] input');
		await inputs.nth(0).fill(name);
		await inputs.nth(1).fill("fr-CH");
		await page.getByPlaceholder("en, fr, de").fill("en, fr, fr-CH");
		await page.getByPlaceholder("fr-CH:fr, fr:en").fill("fr-CH:fr, fr:en");
		const localized = page.waitForResponse(
			(r) => r.url().includes(".command.save_localization") && r.request().method() === "POST",
		);
		await page
			.getByRole("button", { name: fr ? "Enregistrer" : "Save changes", exact: true })
			.click();
		assert.ok((await localized).ok());
		await page.reload();
		await hydrate();
		await page.getByRole("button", { name, exact: true }).click();
		await expect(inputs.nth(1)).toHaveValue("fr-CH");
		await expect(page.getByPlaceholder("fr-CH:fr, fr:en")).toHaveValue("fr-CH:fr, fr:en");
		const languages = await read("localization");
		assert.deepEqual(languages.items.find((group) => group.name === name).fallbacks, {
			"fr-CH": "fr",
			fr: "en",
		});
		for (const tab of ["environments", "localization", "sdk"]) {
			await open(`/flows/settings/${tab}?lang=${locale}`);
			await page.waitForURL((url) => url.pathname === "/acquisition/settings");
			await hydrate();
			assert.equal(new URL(page.url()).searchParams.get("tab"), tab);
			assert.equal(new URL(page.url()).searchParams.get("lang"), locale);
		}
		await page.getByRole("tab", { name: "Configuration", exact: true }).click();
		await expect(
			page.getByText(fr ? "Cycle de vie du plugin" : "Plugin Lifecycle", { exact: true }),
		).toBeVisible();
		const health = new URL("/_emdash/api/superboard/plugins/supbrd-plug-journeys/health", origin)
			.href;
		const checked = page.waitForResponse(health);
		await page
			.getByRole("button", { name: fr ? "Vérifier à nouveau" : "Re-check Health", exact: true })
			.click();
		const result = await (await checked).json();
		assert.ok(result.checkedAt);
		assert.ok(result.diagnostic.workers.every((worker) => worker.physicalName));
		const routeLabel = fr ? "Routes API" : "API Routes";
		await page
			.getByRole("button", {
				name: `${routeLabel} (${result.diagnostic.routes.api.length})`,
				exact: true,
			})
			.click();
		const seen = [];
		const table = page.getByRole("table", { name: routeLabel, exact: true });
		while (seen.length < result.diagnostic.routes.api.length) {
			await expect(table.getByRole("row").nth(1).getByRole("cell").nth(1)).toHaveText(
				result.diagnostic.routes.api[seen.length].path,
			);
			for (const row of (await table.getByRole("row").all()).slice(1))
				seen.push(await row.getByRole("cell").nth(1).innerText());
			if (seen.length < result.diagnostic.routes.api.length)
				await page.getByRole("button", { name: fr ? "Suivant" : "Next", exact: true }).click();
		}
		assert.deepEqual(
			seen,
			result.diagnostic.routes.api.map((route) => route.path),
		);
		await page.route(health, (route) => route.abort("failed"));
		await page
			.getByRole("button", { name: fr ? "Vérifier à nouveau" : "Re-check Health", exact: true })
			.click();
		const workers = page.getByRole("table", {
			name: fr ? "Services et Workers associés" : "Associated Services & Workers",
			exact: true,
		});
		await expect(workers).toContainText(fr ? "Inconnu" : "Unknown");
		await expect(workers).toContainText(result.diagnostic.workers[0].physicalName);
		await page.unroute(health);
		const diagnostic = health.replace(/health$/, "diagnostic");
		await page.route(diagnostic, (route) => route.abort("failed"));
		await page.reload();
		await hydrate();
		await expect(
			page.getByText(fr ? "Échec du chargement du diagnostic" : "Failed to load diagnostic", {
				exact: true,
			}),
		).toBeVisible();
		await page.unroute(diagnostic);
		await page.getByRole("button", { name: fr ? "Réessayer" : "Retry", exact: true }).click();
		await expect(workers).toBeVisible();
		console.log(
			`${locale}: menu, keyboard, environment creation, SDK selection, saved language/fallback rules, reload/API reread, legacy links, ${seen.length} diagnostic routes and health failure verified.`,
		);
	}
	const anonymous = await browser.newContext();
	for (const [path, method] of [
		["environments", "GET"],
		["environments", "POST"],
		["localization", "GET"],
		["localization", "PUT"],
	]) {
		const response = await anonymous.request.fetch(
			new URL(`/api/v1/flows/projects/1-prod/${path}`, origin).href,
			{ method, headers: { Origin: origin.origin, "X-EmDash-Request": "1" } },
		);
		assert.equal(response.status(), 401);
	}
	assert.deepEqual(errors, []);
	console.log(
		"Anonymous settings APIs denied. Created test environments and language groups remain in the local development instance.",
	);
} finally {
	await browser.close();
}
