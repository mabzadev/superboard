import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const navigationFixture = `/@fs${fileURLToPath(new URL("../../../fixtures/site-browser/navigation-shell.tsx", import.meta.url))}`;

test.beforeEach(async ({ page }) => {
	await page.route("**/__navigation_fixture**", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<html><body><div id="navigation-fixture"></div><script type="module">
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
await import(${JSON.stringify(navigationFixture)});
</script></body></html>`,
		}),
	);
});

for (const [locale, users, collapse] of [
	["fr", "Utilisateurs et accès", "Réduire la navigation"],
	["en", "Users and access", "Collapse sidebar"],
] as const) {
	test(`the ${locale} navigation opens one section and reopens a reduced sidebar`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`/__navigation_fixture?lang=${locale}`);
		const section = page.locator("summary").filter({ has: page.getByText(users, { exact: true }) });
		await section.click();
		await expect(page.locator(".native-front-sidebar details[open]")).toHaveCount(1);
		await expect(page.locator(".native-front-sidebar [aria-current=page]")).toHaveCount(1);
		await page.getByRole("button", { name: collapse, exact: true }).click();
		await expect(section).toHaveAttribute("aria-expanded", "false");
		await section.click();
		await expect(section).toHaveAttribute("aria-expanded", "true");
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		expect(errors).toEqual([]);
	});
}

test("the French mobile navigation closes and restores focus with Escape", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/__navigation_fixture?lang=fr");
	const open = page.getByRole("button", { name: "Ouvrir la navigation", exact: true });
	await open.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(open).toBeFocused();
});
