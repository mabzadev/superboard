import assert from "node:assert/strict";

import { chromium, expect as baseExpect } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 30000 });
const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
const collection = `data_test_${Date.now()}`;
const errors = [];
const taxonomy = `tags_${Date.now()}`;
let taxonomyCreated = false;
const headers = { Origin: origin.origin, "X-EmDash-Request": "1" };
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on("pageerror", (error) => errors.push(error.message));
const go = async (tab, lang = "en") => {
	await page.goto(new URL(`/data/content?tab=${tab}&lang=${lang}`, origin).href);
	await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
	await expect(
		page.getByRole("tab", { name: lang === "fr" ? "Collections" : "Collections", exact: true }),
	).toBeVisible();
};
const tab = async (name) => page.getByRole("tab", { name, exact: true }).click();
const button = (name) => page.getByRole("button", { name, exact: true });
let created = false;
try {
	await page.goto(new URL("/_emdash/api/auth/dev-bypass?redirect=/data/content", origin).href);
	await go("collections");
	await page.getByLabel("Collection name", { exact: true }).fill(collection);
	await page.getByLabel("Slug", { exact: true }).first().fill(collection);
	created = true;
	await button("Create collection").click();
	await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue(
		collection,
	);
	created = true;
	await page.getByLabel("Field name", { exact: true }).fill("Title");
	await page.getByLabel("Slug", { exact: true }).last().fill("title");
	await page.getByRole("button", { name: "Add field", exact: true }).last().click();
	await expect(button("Title · string")).toBeVisible();
	await tab("Taxonomies");
	await page.getByLabel("Taxonomy name", { exact: true }).fill("Browser categories");
	await page.getByLabel("Taxonomy identifier", { exact: true }).fill(taxonomy);
	await page.getByRole("checkbox", { name: collection, exact: true }).check();
	taxonomyCreated = true;
	await button("Create taxonomy").click();
	await expect(page.getByRole("combobox", { name: "Taxonomies", exact: true })).toHaveValue(
		taxonomy,
	);
	await page.getByLabel("Term name", { exact: true }).fill("Browser tag");
	await page.getByRole("button", { name: "Add term", exact: true }).last().click();
	await expect(button("Browser tag")).toBeVisible();
	await tab("Documents");
	await page.getByRole("combobox", { name: "Collection", exact: true }).selectOption(collection);
	await button("New document").click();
	await page.getByLabel("Slug", { exact: true }).fill("browser-test");
	await page.getByLabel("Title", { exact: true }).fill("Data browser document");
	await button("Create document").click();
	await expect(page.getByRole("tab", { name: "Publication", exact: true })).toBeVisible();
	await tab("Publication");
	await button("Publish").click();
	await tab("Publication");
	await expect(button("Unpublish")).toBeEnabled();
	await tab("Fields");
	await page.getByLabel("Title", { exact: true }).fill("Data updated document");
	await button("Save").click();
	await tab("Revisions");
	await button("Compare with published version").click();
	await expect(page.getByText("Published version", { exact: true })).toBeVisible();
	await expect(page.getByText('"Data updated document"', { exact: false }).first()).toBeVisible();
	await tab("Categories and tags");
	await page.getByRole("checkbox", { name: "Browser tag", exact: true }).check();
	await button("Save categories and tags").click();
	await expect(button("Save categories and tags")).toBeDisabled();
	await tab("Publication");
	await page
		.getByLabel("Publication date", { exact: true })
		.fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
	await button("Schedule").click();
	await expect(button("Cancel schedule")).toBeVisible();
	await button("Cancel schedule").click();
	await expect(button("Cancel schedule")).toHaveCount(0);
	await tab("Translations");
	await page.getByLabel("Translation language", { exact: true }).fill("fr");
	await button("Create translation").click();
	await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Data updated document");
	await tab("Publication");
	await Promise.all([
		page.waitForResponse(
			(response) => response.url().includes("/duplicate") && response.request().method() === "POST",
		),
		button("Duplicate").click(),
	]);
	await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
		"Data updated document (Copy)",
	);
	await tab("Publication");
	await button("Move to trash").click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Confirm", exact: true }).click();
	await tab("Trash");
	await button("Restore").click();
	await expect(page.getByText("No documents", { exact: true })).toBeVisible();
	for (const lang of ["en", "fr"]) {
		for (const view of ["documents", "trash", "collections", "taxonomies"]) {
			await go(view, lang);
			await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
			await expect(page.getByRole("alert")).toHaveCount(0);
		}
	}
	for (const lang of ["en", "fr"]) {
		await page.goto(new URL(`/data/files?lang=${lang}`, origin).href);
		await expect(
			page.getByRole("textbox", {
				name: lang === "fr" ? "Rechercher dans cette page" : "Search this page",
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("combobox", {
				name: lang === "fr" ? "Type de fichier" : "File type",
				exact: true,
			}),
		).toBeVisible();
	}
	for (const section of ["content", "files"]) {
		await page.goto(new URL(`/system/${section}`, origin).href);
		await expect(page).toHaveURL(new RegExp(`/data/${section}`));
	}
	assert.deepEqual(errors, []);
	console.log(
		"Data: collection/field creation, typed editing, publication, revision comparison, taxonomy assignment, scheduling, duplication, translation, trash/restore and four views in FR/EN passed.",
	);
} finally {
	if (taxonomyCreated) {
		const response = await context.request.delete(
			new URL(`/_emdash/api/taxonomies/${taxonomy}?locale=en`, origin).href,
			{ headers },
		);
		assert.ok([200, 404].includes(response.status()), await response.text());
	}
	if (created) {
		const response = await context.request.delete(
			new URL(`/_emdash/api/schema/collections/${collection}?force=true`, origin).href,
			{ headers },
		);
		assert.ok([200, 404].includes(response.status()), await response.text());
	}
	await browser.close();
}
