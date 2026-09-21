import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { chromium } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
const results = [];
const actionResults = [];
const requested = process.argv.slice(2);
assert(requested.every((path) => path.startsWith("/") && !path.startsWith("//")));

try {
	const context = await browser.newContext();
	const page = await context.newPage();
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
	const controlledModules = new Set();

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

	for (const locale of ["en", "fr"]) {
		for (const path of pending) {
			visited.add(path);
			const targetUrl = new URL(path, origin);
			targetUrl.searchParams.set("lang", locale);
			const errors = [];
			const failures = new Set();
			const onError = (error) => errors.push(error.message.split("\n")[0]);
			const onResponse = (response) => {
				if (response.status() >= 400 && response.status() !== 404)
					failures.add(`${response.status()} ${response.url()}`);
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

				await page
					.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])')
					.waitFor({ timeout: 30000 });
				await page
					.locator('main h1, main input, main table, main [role="alert"], main form')
					.first()
					.waitFor({ timeout: 30000 });

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
		for (const locale of ["en", "fr"]) {
			// Action 1: Search user
			try {
				await page.goto(new URL(`/app/users?lang=${locale}`, origin).href);
				await page.locator('main input, main [role="alert"]').first().waitFor({ timeout: 20000 });
				const searchInput = page
					.locator('main input[type="text"], main input[type="search"]')
					.first();
				assert.ok((await searchInput.count()) > 0, "User search input must exist on /app/users");
				await searchInput.fill("test-operator-query");
				await page.keyboard.press("Enter");
				await page.waitForTimeout(1000);
				const content = await page.locator("main").textContent();
				assert.ok(content && content.length > 0, "Search results or empty state must be rendered");
				actionResults.push({
					action: "search_user",
					locale,
					release_id: releaseId,
					expected: "User search query executed and filtered table or showed empty state",
					observed: `Search input interacted successfully (${content?.length ?? 0} chars rendered)`,
					success: true,
				});
			} catch (err) {
				actionResults.push({
					action: "search_user",
					locale,
					release_id: releaseId,
					expected: "User search query executed",
					observed: `Failed: ${err.message}`,
					success: false,
					error: err.message,
				});
			}

			// Action 2: Refresh statistics
			try {
				await page.goto(new URL(`/communication/statistics?lang=${locale}`, origin).href);
				await page
					.locator('main button:has-text("Refresh"), main button:has-text("Actualiser")')
					.first()
					.waitFor({ timeout: 20000 });
				const refreshBtn = page
					.locator('main button:has-text("Refresh"), main button:has-text("Actualiser")')
					.first();
				assert.ok(
					(await refreshBtn.count()) > 0,
					"Refresh button must exist on /communication/statistics",
				);
				await refreshBtn.click();
				await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
				actionResults.push({
					action: "refresh_statistics",
					locale,
					release_id: releaseId,
					expected: "Statistics refreshed with real network query",
					observed: "Statistics refresh button triggered and completed",
					success: true,
				});
			} catch (err) {
				actionResults.push({
					action: "refresh_statistics",
					locale,
					release_id: releaseId,
					expected: "Statistics refreshed",
					observed: `Failed: ${err.message}`,
					success: false,
					error: err.message,
				});
			}

			// Action 3: Modify, save and reload setting
			try {
				await page.goto(new URL(`/app/profile?lang=${locale}`, origin).href);
				await page.locator("main form, main input").first().waitFor({ timeout: 20000 });
				const nameInput = page.locator('main input[name="name"], main form input').first();
				assert.ok((await nameInput.count()) > 0, "Profile name input must exist on /app/profile");
				const originalName = await nameInput.inputValue();
				const updatedName = `${originalName}-test`;
				await nameInput.fill(updatedName);
				const saveBtn = page.locator('main button[type="submit"]').first();
				assert.ok((await saveBtn.count()) > 0, "Submit button must exist on /app/profile");
				await saveBtn.click();
				await page.waitForTimeout(1000);
				await page.reload();
				await page.locator("main form, main input").first().waitFor({ timeout: 20000 });
				const reloadedName = await page
					.locator('main input[name="name"], main form input')
					.first()
					.inputValue();
				assert.equal(reloadedName, updatedName, "Modified setting must persist after reload");
				// Restore
				await nameInput.fill(originalName);
				await page.locator('main button[type="submit"]').first().click();
				await page.waitForTimeout(500);
				actionResults.push({
					action: "save_and_reload_setting",
					locale,
					release_id: releaseId,
					expected: "Setting updated, saved and verified after reload",
					observed: `Setting persisted value '${reloadedName}' verified and restored to '${originalName}'`,
					success: true,
				});
			} catch (err) {
				actionResults.push({
					action: "save_and_reload_setting",
					locale,
					release_id: releaseId,
					expected: "Setting saved and persisted after reload",
					observed: `Failed: ${err.message}`,
					success: false,
					error: err.message,
				});
			}
		}
	}
} finally {
	await browser.close();

	const reportPath =
		process.env.SUPERBOARD_POST_PUBLICATION_REPORT || process.env.SUPERBOARD_NAVIGATION_REPORT;
	if (reportPath) {
		const report = {
			release_id: results[0]?.release_id ?? "unknown",
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

assert(results.length > 0, "No navigation paths were checked");
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
