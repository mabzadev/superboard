import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { chromium } from "@playwright/test";

import { runPublishedBusinessActions } from "../../fixtures/site-browser/business-actions.mjs";
import { AdminPage } from "../../fixtures/emdash-browser/admin.ts";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
const results = [];
const actionResults = [];
const controlledModules = new Set();
const actionsOnly = process.env.SUPERBOARD_NAVIGATION_ACTIONS_ONLY === "1";
let servedReleaseId;
const requested = process.argv.slice(2);
assert(requested.every((path) => path.startsWith("/") && !path.startsWith("//")));

try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	page.setDefaultNavigationTimeout(30000);
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/superboard-system/home", origin).href,
	);
	await page.locator(".native-front-controls").waitFor({ timeout: 30000 });

	const releaseId = await page.evaluate(() => {
		return (
			document.querySelector('meta[name="superboard-release-id"]')?.getAttribute("content") || ""
		);
	});
	assert.ok(releaseId && releaseId !== "unknown", "Active Front Release ID must be present in DOM");
	servedReleaseId = releaseId;
	console.log(`Verified active Front Release: ${releaseId}`);

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

	page.on("response", (res) => {
		const url = res.url();
		if (
			url.includes("/_superboard/") ||
			url.includes("/packages/plugins/") ||
			url.includes("/plugins/")
		) {
			controlledModules.add(new URL(url).pathname);
		}
	});

	async function discover() {
		if (requested.length || new URL(page.url()).pathname.startsWith("/_emdash/admin")) return;
		for (const href of await page
			.locator('aside a[href], main nav a[href], a[href^="/app/"], a[href^="/settings"]')
			.evaluateAll((elements) =>
				elements.map((element) => element.getAttribute("href")).filter(Boolean),
			)) {
			const target = new URL(href, origin);
			if (target.origin === origin.origin && !visited.has(target.pathname))
				pending.add(target.pathname);
		}
	}

	await discover();
	if (actionsOnly) pending.clear();

	for (const locale of ["en", "fr"]) {
		for (const path of pending) {
			visited.add(path);
			const targetUrl = new URL(path, origin);
			targetUrl.searchParams.set("lang", locale);
			const errors = [];
			const failures = new Set();
			const onError = (error) => errors.push(error.message.split("\n")[0]);
			const onResponse = (response) => {
				if (response.status() >= 400) failures.add(`${response.status()} ${response.url()}`);
			};
			page.on("pageerror", onError);
			page.on("response", onResponse);
			let status;
			try {
				const link = page.locator(`a[href=${JSON.stringify(path)}]`).first();
				if ((await link.count()) && locale === "en") {
					for (const group of await link.locator("xpath=ancestor::details").all()) {
						if (!(await group.evaluate((element) => element.open)))
							await group.locator(":scope > summary").click();
					}
					const [response] = await Promise.all([page.waitForNavigation(), link.click()]);
					status = response?.status();
				} else {
					status = (await page.goto(targetUrl.href))?.status();
				}

				if (path.startsWith("/_emdash/admin")) {
					await new AdminPage(page).waitForHydration();
					await page.getByRole("heading", { name: "Communication", exact: true }).waitFor();
				} else {
					await page
						.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])')
						.waitFor({ timeout: 30000 });
					await page
						.locator('main h1, main input, main table, main [role="alert"], main form')
						.first()
						.waitFor({ timeout: 30000 });
				}

				if (["/project-settings", "/app/libraries"].includes(path))
					assert(
						await page.locator('main nav a[href="/app/android-setup"]').count(),
						"Settings navigation is missing",
					);
				await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

				// Verify paywalls statistics view renders statistics, NOT editor
				if (path === "/acquisition/paywalls/statistics" || path === "/paywalls/statistics") {
					const hasSaveButton = await page
						.locator('button:has-text("Save paywall"), button:has-text("Enregistrer le paywall")')
						.count();
					assert.equal(hasSaveButton, 0, "Paywalls statistics must not render the editor form");
					const statsText = await page.locator("main").textContent();
					assert.ok(
						statsText && statsText.length > 0,
						"Paywalls statistics must render statistics content",
					);
				}

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

			const rawAlerts = await page.locator('[role="alert"]').allTextContents();
			const criticalAlerts = rawAlerts.filter((text) =>
				[
					"View is not registered",
					"Plugin client unavailable",
					"Erreur de View",
					"ROUTE_VIEW_NOT_LOADABLE",
				].some((msg) => text.includes(msg)),
			);
			if (criticalAlerts.length > 0) {
				errors.push(...criticalAlerts);
			}

			const headings = await page.locator("main h1").allTextContents();
			if (["/products/purchases", "/monetization/purchases"].includes(path)) {
				const expected = locale === "fr" ? "Achats" : "Purchases";
				if (!headings.includes(expected))
					errors.push(`Missing localized purchase heading: ${expected}`);
			}
			page.off("pageerror", onError);
			page.off("response", onResponse);

			const result = {
				path,
				locale,
				release_id: releaseId,
				status,
				headings,
				errors,
				failures: [...failures],
				alerts: criticalAlerts,
			};
			results.push(result);
			console.log(JSON.stringify(result));
		}
	}

	// Execute Representative Business Actions
	if (!requested.length) {
		const records = await runPublishedBusinessActions(context, { origin, releaseId });
		actionResults.push(...records);
	}
} finally {
	await browser.close();

	const reportPath =
		process.env.SUPERBOARD_POST_PUBLICATION_REPORT || process.env.SUPERBOARD_NAVIGATION_REPORT;
	if (reportPath) {
		const report = {
			release_id: servedReleaseId ?? "unknown",
			timestamp: new Date().toISOString(),
			controlled_imports: [...controlledModules],
			rendered_pages: results,
			actions: actionResults,
			errors: [
				...results.flatMap((r) => r.errors),
				...actionResults.filter((a) => !a.success).map((a) => a.error),
			],
		};
		await writeFile(reportPath, JSON.stringify(report, null, 2), {
			mode: 0o600,
		});
	}
}

assert(
	results.length > 0 || (actionsOnly && actionResults.length === 6),
	"No navigation paths or complete action suite were checked",
);
const failedPages = results.filter(
	(r) => r.status !== 200 || r.errors.length || r.failures.length || r.alerts.length,
);
assert.equal(
	failedPages.length,
	0,
	`Some navigation destinations failed: ${JSON.stringify(failedPages, null, 2)}`,
);

const failedActions = actionResults.filter((a) => !a.success);
assert.equal(
	failedActions.length,
	0,
	`Some business actions failed: ${JSON.stringify(failedActions, null, 2)}`,
);
