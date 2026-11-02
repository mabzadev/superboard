import { test, expect } from "../../fixtures/emdash-browser";

test("a component's scoped styles apply on a public content page", async ({ page }) => {
	const field = page.locator(".ec-comment-form-field").first();

	for (let attempt = 0; attempt < 5; attempt++) {
		await page.goto("/posts/first-post");
		if (await field.isVisible().catch(() => false)) break;
		await page.waitForTimeout(1000);
	}

	await expect(field).toHaveCSS("display", "flex");
});
