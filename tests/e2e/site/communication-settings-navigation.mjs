import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/superboard-system/home", origin).href,
	);
	for (const locale of ["fr", "en"]) {
		await page.goto(new URL(`/superboard-system/home?lang=${locale}`, origin).href);
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		const sidebar = page.getByRole("complementary");
		const link = sidebar.locator('a[href="/communication/settings"]');
		await expect(link).toHaveCount(1);
		if (!(await link.isVisible()))
			await sidebar.getByText("Communication", { exact: true }).click();
		await expect(link).toHaveText(locale === "fr" ? "Paramètres" : "Settings");
		await link.click();
		await page.waitForURL((url) => url.pathname === "/communication/settings");
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(
			page.getByRole("heading", {
				name: locale === "fr" ? "Paramètres Communication" : "Communication settings",
				exact: true,
			}),
		).toBeVisible();
		await page.getByRole("tab", { name: "Configuration", exact: true }).click();
		await expect(
			page.getByText(locale === "fr" ? "Cycle de vie du plugin" : "Plugin Lifecycle", {
				exact: true,
			}),
		).toBeVisible();
		console.log(`${locale}: sidebar Settings link opens the Communication view and its diagnostic`);
	}
} finally {
	await browser.close();
}
