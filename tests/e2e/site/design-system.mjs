import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
	throw new Error("Design system checks require a local development server.");
}

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/monetization/products", origin).href,
	);
	for (const locale of ["en", "fr"]) {
		await page.goto(new URL(`/monetization/products?lang=${locale}`, origin).href);
		const french = locale === "fr";
		await expect(
			page.getByRole("heading", { name: french ? "Produits" : "Products", exact: true }),
		).toBeVisible();
		for (const theme of ["light", "dark"]) {
			await page.getByRole("button", { name: /account menu|menu du compte/u }).click();
			const toggle = page.getByRole("button", {
				name: /^(Light mode|Dark mode|Mode clair|Mode sombre)$/u,
			});
			await expect(toggle).toBeVisible();
			const current = await page.locator("html").getAttribute("data-theme");
			if (current !== theme) await toggle.click();
			else await page.keyboard.press("Escape");
			await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
			const spacing = await page
				.locator(".ds-page")
				.evaluate((element) => parseFloat(getComputedStyle(element).paddingInlineStart));
			expect(spacing).toBeGreaterThanOrEqual(16);
			const create = page.getByRole("button", {
				name: french ? "Nouveau produit iOS" : "New iOS product",
				exact: true,
			});
			const border = await create.evaluate((element) => {
				const style = getComputedStyle(element);
				return { border: style.borderTopColor, text: style.color, width: style.borderTopWidth };
			});
			expect(border.width).toBe("1px");
			expect(border.border).not.toBe(border.text);
			await create.click();
			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			const identifier = dialog.getByRole("textbox", {
				name: french ? "Identifiant" : "Identifier",
				exact: true,
			});
			await expect(identifier).toHaveValue("apple_");
			const field = await identifier.evaluate((element) => {
				const style = getComputedStyle(element);
				return { background: style.backgroundColor, outline: style.boxShadow, color: style.color };
			});
			expect(field.background).not.toBe("rgba(0, 0, 0, 0)");
			expect(field.outline).not.toBe("none");
			await dialog
				.getByRole("button", { name: french ? "Annuler" : "Cancel", exact: true })
				.click();
			await expect(dialog).toHaveCount(0);
			await page.reload();
			await expect(create).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
			console.log(
				`${locale}/${theme}: control borders, field surface, focus, dialog and theme persistence`,
			);
		}
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.locator(".native-front-mobile-open")).toBeVisible();
	await page.locator(".native-front-mobile-open").click();
	await expect(page.locator(".native-front-sidebar")).toBeVisible();
	await page.locator(".native-front-mobile-close").click();
	await expect(page.locator(".native-front-sidebar")).not.toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	expect(errors).toEqual([]);
	console.log("mobile: navigation opens/closes without page overflow; no browser exceptions");
} finally {
	await browser.close();
}
