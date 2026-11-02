import { test, expect } from "../../fixtures/emdash-browser";

const TAILWIND_SIGNATURE = "tailwindcss v4";
const KUMO_SIGNATURE = "kumo";
const ADMIN_STYLESHEET_LINK = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/;

test.describe("admin CSS isolation", () => {
	test("public routes do not include the admin stylesheet", async ({ page }) => {
		await page.goto("/");

		const inlineStyles = await page.$$eval("style", (nodes) =>
			nodes.map((n) => n.textContent ?? ""),
		);
		const leaked = inlineStyles.find(
			(css) => css.includes(TAILWIND_SIGNATURE) && css.includes(KUMO_SIGNATURE),
		);
		expect(leaked, "admin Tailwind/Kumo theme leaked into a public route's inline <style>").toBe(
			undefined,
		);

		const linkedHrefs = await page.$$eval("link[rel='stylesheet']", (nodes) =>
			nodes.map((n) => n.getAttribute("href") ?? ""),
		);
		expect(linkedHrefs.some((href) => href.includes("admin"))).toBe(false);

		const textBase = await page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue("--text-base").trim(),
		);
		expect(textBase, "Kumo's --text-base bled onto the host :root").toBe("");
	});

	test("admin route still loads the admin stylesheet", async ({ request }) => {
		const response = await request.get("/_emdash/admin");
		const html = await response.text();

		const match = html.match(ADMIN_STYLESHEET_LINK);
		expect(match, "admin shell is missing its <link rel=stylesheet>").not.toBeNull();

		const cssResponse = await request.get(match![1]!);
		const css = await cssResponse.text();
		expect(css).toContain(TAILWIND_SIGNATURE);
		expect(css).toContain(KUMO_SIGNATURE);
	});
});
