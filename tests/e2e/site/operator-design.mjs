import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const output = resolve("scratch/view-design");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
	const operator = await browser.newPage();
	await operator.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/monetization/products", origin).href,
	);
	await operator.locator("main h1").waitFor();
	await operator.getByRole("button", { name: /account menu|menu du compte/u }).click();
	await operator
		.getByRole("button", { name: /^(Light mode|Dark mode|Mode clair|Mode sombre)$/u })
		.click();
	const keys = await operator.evaluate(() =>
		Object.keys(localStorage).filter((key) => key.endsWith(":theme")),
	);
	assert(keys.length > 0);
	await operator.close();
	for (const locale of ["fr", "en"]) {
		for (const theme of ["light", "dark"]) {
			const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
			await context.addInitScript(
				({ keys: themeKeys, theme: value }) => {
					if (window.top !== window) return;
					for (const key of themeKeys) localStorage.setItem(key, value);
					localStorage.setItem("superboard-theme", value);
				},
				{ keys, theme },
			);
			const page = await context.newPage();
			for (const path of [
				"/login",
				"/register",
				"/register/with_email",
				"/reset_password",
				"/new_password",
				"/accept-invite",
			]) {
				await page.goto(new URL(`${path}?lang=${locale}`, origin).href);
				await page.getByRole("heading", { level: 1 }).first().waitFor();
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
				const size = await page
					.getByRole("heading", { level: 1 })
					.first()
					.evaluate((element) => getComputedStyle(element).fontSize);
				expect(size).toBe("22px");
				const screenshot = `guest-${locale}-${theme}-${path.replaceAll("/", "_")}.png`;
				await page.screenshot({ path: resolve(output, screenshot) });
				results.push({ path, locale, theme, screenshot });
			}
			await context.close();
		}
	}
} finally {
	await browser.close();
	await writeFile(resolve(output, "operator-report.json"), JSON.stringify(results, null, 2));
}
console.log(`${results.length} anonymous screens verified`);
