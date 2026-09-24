import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";
const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const notificationRead = (r) =>
	r.url().includes(".data_source.notifications") && r.request().method() === "POST";
const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/communication/in-app-messages", origin).href,
	);

	for (const locale of ["fr", "en"]) {
		const fr = locale === "fr";
		const ready = page.waitForResponse(notificationRead);
		await page.goto(new URL(`/communication/in-app-messages?lang=${locale}`, origin).href);
		assert.equal((await ready).status(), 200);
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(
			page.getByRole("heading", {
				name: fr ? "Messages dans l’application" : "In-app messages",
				exact: true,
			}),
		).toBeVisible();
		await page
			.getByRole("combobox", { name: fr ? "Lignes par page" : "Rows per page", exact: true })
			.click();
		const size = page.waitForResponse(
			(r) => notificationRead(r) && r.request().postDataJSON().body?.per_page === 10,
		);
		await page.getByRole("option", { name: "10", exact: true }).click();
		assert.equal((await size).status(), 200);
		const sorted = page.waitForResponse(
			(r) =>
				notificationRead(r) &&
				r.request().postDataJSON().body?.sort_by === "title" &&
				r.request().postDataJSON().body?.ascending === true,
		);
		await page.getByRole("button", { name: fr ? "Titre" : "Title", exact: true }).click();
		assert.equal((await sorted).status(), 200);
		await page
			.getByRole("button", { name: fr ? "Créer un message" : "Create Message", exact: true })
			.first()
			.click();
		const dialog = page.getByRole("dialog", {
			name: fr ? "Créer un message" : "Create Message",
			exact: true,
		});
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByPlaceholder(
				fr ? "Saisissez le titre du message" : "Enter the title of the message",
				{ exact: true },
			),
		).toBeVisible();
		await dialog.getByRole("button", { name: fr ? "Publier" : "Publish", exact: true }).click();
		await expect(
			dialog.getByText(fr ? "Le titre est obligatoire" : "Title is required", { exact: true }),
		).toBeVisible();
		await dialog
			.getByRole("button", { name: fr ? "Fermer la fenêtre" : "Close dialog", exact: true })
			.click();
		await expect(dialog).toHaveCount(0);
		const endpoint = "**/data-sources/*.data_source.notifications";
		await page.route(endpoint, (route) =>
			route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({ error: { message: "Unavailable" } }),
			}),
		);
		await page.reload();
		await expect(page.getByRole("alert")).toContainText(
			fr ? "Chargement impossible" : "Loading failed",
			{ timeout: 20000 },
		);
		await page.unroute(endpoint);
		const recovered = page.waitForResponse(notificationRead);
		await page
			.getByRole("alert")
			.getByRole("button", { name: fr ? "Réessayer" : "Retry", exact: true })
			.click();
		assert.equal((await recovered).status(), 200);
		await expect(page.getByRole("alert")).toHaveCount(0);
		const pageTwo = page.waitForResponse(notificationRead);
		await page.goto(new URL(`/communication/in-app-messages?lang=${locale}&page=2`, origin).href);
		await pageTwo;
		await page.getByRole("button", { name: fr ? "Actifs" : "Active", exact: true }).click();
		const filtered = page.waitForResponse(
			(r) => notificationRead(r) && r.request().postDataJSON().body?.archived === true,
		);
		await page.getByRole("checkbox", { name: fr ? "Archivés" : "Archived", exact: true }).check();
		const filterResponse = await filtered;
		assert.equal(
			filterResponse.request().postDataJSON().body.page,
			1,
			"A new filter must restart at the first page",
		);
		const secondPage = page.waitForResponse(notificationRead);
		await page.goto(new URL(`/communication/in-app-messages?lang=${locale}&page=2`, origin).href);
		await secondPage;
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await page
			.getByRole("heading", {
				name: fr ? "Messages dans l’application" : "In-app messages",
				exact: true,
			})
			.waitFor();
		await page.getByRole("combobox", { name: fr ? "Cible" : "Target", exact: true }).click();
		const targetFiltered = page.waitForResponse(
			(r) => notificationRead(r) && r.request().postDataJSON().body?.for_new_users === true,
		);
		await page
			.getByRole("checkbox", { name: fr ? "Nouveaux utilisateurs" : "New users", exact: true })
			.check();
		assert.equal((await targetFiltered).request().postDataJSON().body.page, 1);
		console.log(
			`${locale}: page size, sorting, filter pagination reset, message dialog validation and API failure/retry passed without publishing`,
		);
	}
	assert.deepEqual(errors, []);
} finally {
	await browser.close();
}
