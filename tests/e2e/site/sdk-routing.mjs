import assert from "node:assert/strict";

import { chromium } from "@playwright/test";

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	for (const language of ["en", "fr"]) {
		await page.goto(`http://127.0.0.1:4411/?lang=${language}`);
		await page.getByRole("button", { name: language === "fr" ? "Envoyer" : "Send" }).click();
		await page.waitForFunction(() => document.querySelector("output").textContent === "202");
		const results = await page.evaluate(async () => {
			const paths = [
				"/api/v1/data/events",
				"/sdk/api/v1/users",
				"/in/api/v1/users",
				"/sdk/internal/collection/v1/events",
				"/sdk/v1/data/files",
				"/sdk/v1/analytics/remote-config/resolve",
			];
			return Promise.all(paths.map(async (path) => ({ path, status: (await fetch(path)).status })));
		});
		for (const result of results) assert.equal(result.status, 404, result.path);
		console.log(
			`${language}: collection accepted with plugins disabled; custom, shortlink and administrative boundaries verified`,
		);
	}
	const count = await page.evaluate(async () => (await (await fetch("/count")).json()).count);
	assert.equal(count, 2);
	console.log("Two SDK events persisted in the real SQLite journal.");
} finally {
	await browser.close();
}
