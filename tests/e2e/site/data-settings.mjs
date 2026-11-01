import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
const pluginsLinkName = /^(Open in Plugins|Ouvrir dans Plugins)$/;
const pluginsLinkHref = /^\/_emdash\/admin\/plugins-manager\/superboard-data\/configuration$/;
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const endpoint = new URL("/_emdash/api/admin/plugins/supbrd-plug-data/settings", origin).href;
const diagnostic = new URL("/_emdash/api/superboard/plugins/supbrd-plug-data/diagnostic", origin)
	.href;
const health = diagnostic.replace(/diagnostic$/, "health");
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(new URL("/_emdash/api/auth/dev-bypass?redirect=/data/settings", origin).href);
	const read = async () => {
		const response = await context.request.get(endpoint);
		assert.equal(response.status(), 200);
		return (await response.json()).data.values;
	};
	const original = await read();
	const hydrate = async () => {
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(page.getByRole("link", { name: pluginsLinkName })).toBeVisible();
	};
	try {
		for (const locale of ["en", "fr"]) {
			await page.goto(new URL(`/data/settings?lang=${locale}`, origin).href);
			await hydrate();
			const contentTab = page.getByRole("tab", {
				name: locale === "fr" ? "Contenus" : "Content",
				exact: true,
			});
			await contentTab.focus();
			await contentTab.press("ArrowRight");
			await expect(
				page.getByRole("tab", { name: locale === "fr" ? "Fichiers" : "Files", exact: true }),
			).toHaveAttribute("aria-selected", "true");
			for (const [tab, updates] of [
				[
					"content",
					{
						default_locale: locale,
						required_locales: locale === "fr" ? "fr,en" : "en,fr",
						publishing_mode: locale === "fr" ? "direct" : "draft_review",
					},
				],
				[
					"files",
					{
						max_upload_bytes: locale === "fr" ? 3145728 : 2097152,
						allowed_content_types: locale === "fr" ? "image/jpeg" : "image/png,image/jpeg",
						signed_url_ttl_seconds: locale === "fr" ? 1200 : 900,
					},
				],
			]) {
				await page
					.getByRole("tab", {
						name:
							tab === "content"
								? locale === "fr"
									? "Contenus"
									: "Content"
								: locale === "fr"
									? "Fichiers"
									: "Files",
						exact: true,
					})
					.click();
				for (const [key, value] of Object.entries(updates)) {
					const field = page.locator(`#setting-${key}`);
					if (key === "publishing_mode") {
						await field.selectOption("");
						await field.selectOption(value);
					} else {
						await field.fill("");
						await field.fill(String(value));
					}
				}
				const saveButton = page.getByRole("button", {
					name: locale === "fr" ? "Enregistrer" : "Save changes",
					exact: true,
				});
				await expect(saveButton).toBeEnabled();
				const [saved] = await Promise.all([
					page.waitForResponse(
						(response) => response.url() === endpoint && response.request().method() === "PUT",
					),
					saveButton.click(),
				]);
				assert.equal(saved.status(), 200);
				const values = await read();
				const prefix = tab === "content" ? "superboard-content__" : "superboard-files__";
				for (const [key, value] of Object.entries(updates))
					assert.equal(values[prefix + key], value);
				await page.reload();
				await hydrate();
				for (const [key, value] of Object.entries(updates))
					await expect(page.locator(`#setting-${key}`)).toHaveValue(String(value));
			}
			// Plugin health and lifecycle are owned by the central Plugins page.
			await expect(page.getByRole("tab", { name: "Configuration", exact: true })).toHaveCount(0);
			await expect(
				page.getByRole("link", {
					name: locale === "fr" ? "Ouvrir dans Plugins" : "Open in Plugins",
					exact: true,
				}),
			).toHaveAttribute("href", pluginsLinkHref);
			const checked = await context.request.post(health, {
				headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			});
			assert.equal(checked.status(), 200, await checked.text());
			const result = await checked.json();
			assert.ok(result.checkedAt);
			const inventory = result.diagnostic;
			assert.equal(inventory.pluginId, "supbrd-plug-data");
			assert.ok(
				inventory.workers.some((worker) => worker.service === "files" && worker.physicalName),
			);
			for (const [path, tab, name] of [
				["content", "content", locale === "fr" ? "Paramètres des contenus" : "Content settings"],
				["files", "files", locale === "fr" ? "Paramètres des fichiers" : "File settings"],
			]) {
				await page.goto(new URL(`/data/${path}?lang=${locale}`, origin).href);
				await page.getByRole("link", { name, exact: true }).click();
				await hydrate();
				assert.equal(new URL(page.url()).searchParams.get("tab"), tab);
			}
			console.log(
				`${locale}: six settings saved, API reread/reload, keyboard, functional links, Plugins diagnostics link and health check (${inventory.routes.api.length} API routes in diagnostic) passed`,
			);
		}
	} finally {
		const response = await context.request.put(endpoint, {
			headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			data: { values: original },
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
			headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			data: method === "PUT" ? { values: {} } : undefined,
		});
		assert.equal(response.status(), 401);
	}
	const denied = await anonymous.request.get(new URL("/data/settings", origin).href, {
		maxRedirects: 0,
	});
	assert.equal(denied.status(), 302);
	assert.match(denied.headers().location, /login/);
	assert.deepEqual(errors, []);
	console.log("Anonymous page/settings/diagnostic/health refused; original values restored.");
} finally {
	await browser.close();
}
