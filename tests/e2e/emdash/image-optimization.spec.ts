import { test, expect } from "../../fixtures/emdash-browser";

test.describe("image optimization", () => {
	test("renders an optimized image served by the wrapped image endpoint", async ({
		page,
		request,
	}) => {
		const img = page.locator("figure.emdash-image img").first();
		let src: string | null = null;
		let lastError: unknown;

		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				await page.goto("/posts/post-with-image");
				await expect(img).toBeVisible();
				await expect(img).toHaveJSProperty("naturalWidth", 1);
				src = await img.getAttribute("src");
				if (src) break;
			} catch (error) {
				lastError = error;
			}
			if (attempt < 4) await page.waitForTimeout(1000);
		}
		if (!src && lastError) throw lastError;
		expect(src, "image src should be optimized via Astro's image endpoint").toContain("/_image");

		const res = await request.get(src!);
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toMatch(/^image\//);
		expect((await res.body()).byteLength).toBeGreaterThan(0);
	});
});
