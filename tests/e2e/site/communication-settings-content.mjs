import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";
const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	page.on("pageerror", (error) => console.error("Page error:", error.message));
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/communication/settings", origin).href,
	);
	const hydrate = async () => {
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
	};
	for (const locale of ["fr", "en"]) {
		for (const tab of ["delivery", "email"]) {
			await page.goto(new URL(`/communication/settings?lang=${locale}&tab=${tab}`, origin).href);
			await hydrate();
			await expect(page.getByRole("tabpanel")).toBeVisible();
			await expect(page.getByRole("tabpanel").locator('input[type="email"]')).toHaveCount(2);
			await expect(
				page.getByRole("tab", { name: locale === "fr" ? "Langues" : "Languages", exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByRole("tab", {
					name: locale === "fr" ? "Canaux marketing" : "Marketing channels",
					exact: true,
				}),
			).toHaveCount(0);
		}
		await page.goto(new URL(`/communication/settings?lang=${locale}&tab=languages`, origin).href);
		await page.waitForURL((url) => url.pathname === "/communication/marketing-email");
		await hydrate();
		await expect(
			page.getByLabel(locale === "fr" ? "Langues activées" : "Enabled languages", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByLabel(
				locale === "fr" ? "Intervalle marketing (heures)" : "Marketing frequency (hours)",
				{ exact: true },
			),
		).toBeVisible();
		await page
			.getByRole("button", { name: locale === "fr" ? "Envois" : "Deliveries", exact: true })
			.click();
		await expect(
			page.getByText(locale === "fr" ? "Tests de livraison" : "Delivery tests", { exact: true }),
		).toHaveCount(2);
		await expect(
			page.getByPlaceholder(locale === "fr" ? "Destinataire de test" : "Test recipient", {
				exact: true,
			}),
		).toHaveCount(2);
		await page.goto(new URL(`/communication/settings?lang=${locale}&tab=channels`, origin).href);
		await page.waitForURL((url) => url.pathname === "/communication/channels");
		await hydrate();
		await expect(
			page.getByPlaceholder(locale === "fr" ? "Notifications clients" : "Customer notifications", {
				exact: true,
			}),
		).toBeVisible();
		console.log(
			`${locale}: contextual settings restored to email/channels; delivery tests are only in delivery operations; old links redirect`,
		);
	}
} finally {
	await browser.close();
}
