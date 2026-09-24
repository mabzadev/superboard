import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const output = resolve("scratch/view-design");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/communication/marketing-email", origin).href,
	);
	for (const locale of ["fr", "en"]) {
		for (const theme of ["light", "dark"]) {
			await page.goto(new URL(`/communication/marketing-email?lang=${locale}`, origin).href);
			await page.getByRole("button", { name: /account menu|menu du compte/u }).click();
			if ((await page.locator("html").getAttribute("data-theme")) !== theme)
				await page
					.getByRole("button", { name: /^(Light mode|Dark mode|Mode clair|Mode sombre)$/u })
					.click();
			else await page.keyboard.press("Escape");
			const fr = locale === "fr";
			await page
				.locator("main nav")
				.getByRole("button", { name: fr ? "Modèles" : "Templates", exact: true })
				.click();
			const open = page
				.getByRole("button", { name: fr ? "Ouvrir l’éditeur" : "Open editor", exact: true })
				.first();
			await open.waitFor();
			await page
				.getByRole("button", { name: fr ? "Supprimer" : "Delete", exact: true })
				.first()
				.click();
			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			expect(await dialog.evaluate((element) => getComputedStyle(element).borderRadius)).toBe(
				"6px",
			);
			await page.screenshot({ path: resolve(output, `email-dialog-${locale}-${theme}.png`) });
			await dialog.getByRole("button", { name: fr ? "Annuler" : "Cancel", exact: true }).click();
			await expect(dialog).toHaveCount(0);
			await open.click();
			await expect(
				page.getByRole("textbox", { name: fr ? "Nom du modèle" : "Template name", exact: true }),
			).toBeVisible();
			const panels = fr
				? ["Contenu", "Style", "Langues", "Aperçu", "Historique"]
				: ["Content", "Design", "Languages", "Preview", "History"];
			for (const panel of panels) {
				await page.locator("main nav").getByRole("button", { name: panel, exact: true }).click();
				await expect(page.locator('main svg[role="status"]:visible')).toHaveCount(0);
				await expect(page.locator('main [data-kumo-component="Button"]')).toHaveCount(0);
				await page.screenshot({
					path: resolve(output, `email-editor-${locale}-${theme}-${panels.indexOf(panel)}.png`),
				});
			}
			console.log(`${locale}/${theme}: confirmation dialog and five editor panels`);
		}
	}
} finally {
	await browser.close();
}
