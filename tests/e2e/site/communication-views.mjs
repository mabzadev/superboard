import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const paths = [
	"campaigns",
	"in-app-messages",
	"marketing-email",
	"notifications",
	"channels",
	"statistics",
	"email",
	"journeys",
	"settings",
];
const browser = await chromium.launch();
const results = [];
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
	const errors = [];
	const failures = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("response", (response) => {
		if (response.status() >= 400 && new URL(response.url()).origin === origin.origin)
			failures.push({ status: response.status(), path: new URL(response.url()).pathname });
	});
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/superboard-system/home", origin).href,
	);
	for (const locale of ["fr", "en"]) {
		await page.goto(new URL(`/superboard-system/home?lang=${locale}`, origin).href);
		for (const path of paths) {
			errors.length = 0;
			failures.length = 0;
			const destination = `/communication/${path}`;
			const link = page.getByRole("complementary").locator(`a[href="${destination}"]`);
			await expect(link).toHaveCount(1);
			for (const group of await link.locator("xpath=ancestor::details").all())
				if (!(await group.evaluate((el) => el.open)))
					await group.locator(":scope > summary").click();
			const [response] = await Promise.all([page.waitForNavigation(), link.click()]);
			assert.equal(response.status(), 200, destination);
			await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
			await page.locator('main h1, main input, main [role="alert"]').first().waitFor();
			await page.waitForLoadState("networkidle");
			const result = {
				path: destination,
				locale,
				headings: await page.locator("main h1").allTextContents(),
				text: await page.locator("main").innerText(),
				buttons: await page.locator("main button").allTextContents(),
				alerts: await page.locator('main [role="alert"]').allTextContents(),
				errors: [...errors],
				failures: [...failures],
			};
			results.push(result);
			console.log(
				JSON.stringify({
					path: destination,
					locale,
					headings: result.headings,
					alerts: result.alerts,
					errors: result.errors,
					failures: result.failures,
				}),
			);
		}
	}
} finally {
	await browser.close();
	await writeFile(
		process.env.SUPERBOARD_COMMUNICATION_REPORT ?? "/tmp/communication-views.json",
		JSON.stringify(results, null, 2),
	);
}
assert.equal(results.length, 18);
assert.equal(
	results.filter(
		(row) =>
			row.errors.length || row.failures.length || row.alerts.length || row.headings.length !== 1,
	).length,
	0,
	"Communication views contain errors; inspect report",
);
