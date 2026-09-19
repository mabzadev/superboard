import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { chromium } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
const results = [];
const requested = process.argv.slice(2);
assert(requested.every((path) => path.startsWith("/") && !path.startsWith("//")));
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/superboard-system/home", origin).href,
	);
	await page.locator(".native-front-controls").waitFor();
	for (const [retired, canonical] of [
		["/dashboard", "/analytics"],
		["/analytics/dashboards", "/analytics"],
		["/app/members", "/app/users"],
		["/app/members/", "/app/users"],
	]) {
		const response = await context.request.get(new URL(`${retired}?lang=fr`, origin).href, {
			maxRedirects: 0,
		});
		assert.equal(response.status(), 308, `${retired} must redirect to ${canonical}`);
		const destination = new URL(response.headers().location, origin);
		assert.equal(destination.pathname, canonical);
		assert.equal(destination.searchParams.get("lang"), "fr");
	}
	const pending = new Set(requested.length ? requested : ["/app/android-setup", "/app/ios-setup"]);
	const visited = new Set();
	async function discover() {
		if (requested.length) return;
		const links = await page
			.locator("aside a[href], main nav a[href]")
			.evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));
		for (const href of links) {
			if (!href || !href.startsWith("/") || href.startsWith("//")) continue;
			const url = new URL(href, origin);
			if (url.pathname.startsWith("/_emdash/") || url.pathname.startsWith("/api/")) continue;
			if (!visited.has(url.pathname)) pending.add(url.pathname);
		}
	}
	await discover();
	while (pending.size) {
		const path = pending.values().next().value;
		pending.delete(path);
		visited.add(path);
		const errors = [];
		const failures = new Set();
		const onError = (error) => errors.push(error.message);
		const onResponse = (response) => {
			const url = new URL(response.url());
			if (url.origin === origin.origin && response.status() >= 400)
				failures.add(`${response.status()} ${url.pathname}`);
		};
		page.on("pageerror", onError);
		page.on("response", onResponse);
		let status;
		try {
			const link = page.locator(`a[href=${JSON.stringify(path)}]`).first();
			if (await link.count()) {
				for (const group of await link.locator("xpath=ancestor::details").all()) {
					if (!(await group.evaluate((element) => element.open)))
						await group.locator(":scope > summary").click();
				}
				const [response] = await Promise.all([page.waitForNavigation(), link.click()]);
				status = response?.status();
			} else {
				status = (await page.goto(new URL(path, origin).href))?.status();
			}
			await page
				.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])')
				.waitFor({ timeout: 30000 });
			await page
				.locator('main h1, main input, main table, main [role="alert"]')
				.first()
				.waitFor({ timeout: 30000 });
			if (["/project-settings", "/app/libraries"].includes(path))
				assert(
					await page.locator('main nav a[href="/app/android-setup"]').count(),
					"Settings navigation is missing",
				);
			await page.waitForLoadState("networkidle", { timeout: 15000 });
			if (path === "/app/libraries") {
				for (const name of [
					"SuperBoard Flutter",
					"SuperBoard FlutterFlow",
					"SuperBoard Web",
					"SuperBoard Tauri",
				])
					await page.getByText(name, { exact: true }).waitFor();
				for (const name of [
					"SuperBoard iOS",
					"SuperBoard Android",
					"SuperBoard JavaScript",
					"SuperBoard React Native",
					"SuperBoard FlutterFlow Support",
					"SuperBoard Flows JavaScript",
				])
					assert.equal(
						await page.getByText(name, { exact: true }).count(),
						0,
						`${name} must not be listed as a standalone SDK`,
					);
			}

			assert.equal(
				await page
					.locator(
						'aside a[href="/app/members"], main nav a[href="/app/members"], aside a[href="/dashboard"], aside a[href="/analytics/dashboards"], main nav a[href="/dashboard"], main nav a[href="/analytics/dashboards"]',
					)
					.count(),
				0,
				"Retired pages must not remain in navigation",
			);
			if (["/app/android-setup", "/app/ios-setup"].includes(path)) {
				const steps = page.getByRole("button", { name: /^[1-6] /u });
				assert.equal(await steps.count(), 6);
				for (let index = 0; index < 6; index++) {
					await steps.nth(index).click();
					await page.getByText(new RegExp(`Step\\s+${index + 1}\\s+of\\s+6`, "u")).waitFor();
				}
			}
			await discover();
		} catch (error) {
			errors.push(error.message.split("\n")[0]);
		}
		const alerts = await page
			.locator(
				'[role="alert"].text-destructive:visible, [role="alert"]:not([data-slot="alert"]):visible',
			)
			.allTextContents();
		const headings = await page.locator("main h1").allTextContents();
		page.off("pageerror", onError);
		page.off("response", onResponse);
		const result = { path, status, headings, errors, failures: [...failures], alerts };
		results.push(result);
		console.log(JSON.stringify(result));
	}
} finally {
	await browser.close();
	if (process.env.SUPERBOARD_NAVIGATION_REPORT)
		await writeFile(process.env.SUPERBOARD_NAVIGATION_REPORT, JSON.stringify(results, null, 2), {
			mode: 0o600,
		});
}
assert(results.length > 0, "No navigation paths were checked");
assert.equal(
	results.filter((r) => r.status !== 200 || r.errors.length || r.failures.length || r.alerts.length)
		.length,
	0,
	"Some navigation destinations failed; inspect the per-page results",
);
