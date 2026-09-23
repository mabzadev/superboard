import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium } from "@playwright/test";

import {
	exerciseBusinessActionFaults,
	prepareBusinessActionFixtures,
	runPublishedBusinessActions,
} from "../../fixtures/site-browser/business-actions.mjs";
import { createIsolatedInstance } from "../../fixtures/site-browser/isolated-instance.mjs";
import { exercisePublishedMenuFaults } from "../../fixtures/site-browser/published-menu-faults.mjs";
import { summarizePublishedMenu } from "../../fixtures/site-browser/published-menu-report.mjs";
import {
	checkPublishedPage,
	discoverPublishedLinks,
} from "../../fixtures/site-browser/published-menu.mjs";
import { publishedViewContracts } from "../../fixtures/site-browser/published-view-contracts.mjs";
import { createRealAuthState } from "../../fixtures/site-browser/real-auth.ts";

const reportPath = resolve(
	process.env.SUPERBOARD_PUBLISHED_MENU_REPORT ??
		`test-results/published-menu-${randomUUID()}.json`,
);
await mkdir(dirname(reportPath), { recursive: true });
const report = {
	started_at: new Date().toISOString(),
	status: "incomplete",
	activations: [],
	discovered: [],
	pages: [],
	faults: [],
	actions: [],
	action_faults: [],
	errors: [],
};
const saveReport = () => writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
await saveReport();
let instance;
let browser;
try {
	instance = await createIsolatedInstance();
	report.origin = instance.origin;
	report.isolated_directory = instance.directory;
	console.log(`Isolated instance: ${instance.origin}`);
	browser = await chromium.launch();
	const context = await browser.newContext({ baseURL: instance.origin });
	const page = await context.newPage();
	page.setDefaultTimeout(60000);
	await page.goto("/_emdash/api/setup/dev-bypass?redirect=/_emdash/api/auth/me");
	await page.waitForURL((url) => url.pathname === "/_emdash/api/auth/me");
	await createRealAuthState(page);
	const dismissed = await page.request.post("/_emdash/api/auth/me", {
		headers: { "X-EmDash-Request": "1" },
		data: { action: "dismissWelcome" },
	});
	assert.ok(dismissed.ok());
	const profile = await page.request.get("/_emdash/api/auth/me");
	report.operator_verified = profile.ok();
	assert.ok(report.operator_verified);
	const catalog = JSON.parse(
		await readFile(
			new URL("../../../scripts/config/superboard-plugin-packages.json", import.meta.url),
			"utf8",
		),
	);
	for (const plugin of catalog.packages) {
		const response = await page.request.post(
			`/_emdash/api/superboard/plugins/${plugin.id}/enable`,
			{
				headers: {
					Origin: instance.origin,
					"X-EmDash-Request": "1",
					"Idempotency-Key": crypto.randomUUID(),
				},
				timeout: 120000,
			},
		);
		const value = await response.json();
		report.activations.push({ plugin_id: plugin.id, http_status: response.status(), ...value });
		await saveReport();
		assert.ok(response.ok(), `Activation ${plugin.id}: ${JSON.stringify(value)}`);
		assert.equal(value.status, "active");
		assert.ok(value.release_id, "Activation must compile, approve and publish a Release Front");
		report.release_id = value.release_id;
	}
	const initialized = await page.request.post("/_emdash/api/superboard/operator-context", {
		headers: { Origin: instance.origin, "X-EmDash-Request": "1", "Idempotency-Key": randomUUID() },
		data: {},
	});
	assert.ok(initialized.ok(), await initialized.text());
	report.project_scope = await initialized.json();
	await page.goto("/superboard-system/home?lang=en", {
		waitUntil: "domcontentloaded",
		timeout: 120000,
	});
	await page
		.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])')
		.waitFor({ timeout: 120000 });
	assert.equal(
		await page.locator('meta[name="superboard-release-id"]').getAttribute("content"),
		report.release_id,
	);
	report.bootstrap = { url: page.url(), release_id: report.release_id };
	await saveReport();
	await exercisePublishedMenuFaults(
		instance,
		context,
		report.release_id,
		report.faults,
		saveReport,
	);
	for (const locale of ["en", "fr"]) {
		await page.goto(`/superboard-system/home?lang=${locale}`);
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		assert.equal(
			await page.locator('meta[name="superboard-release-id"]').getAttribute("content"),
			report.release_id,
		);
		const pending = new Map(
			(await discoverPublishedLinks(page, instance.origin)).map((link) => [link.href, link]),
		);
		assert.ok(pending.size, "Published menu is empty");
		report.discovered.push(...Array.from(pending.values(), (link) => ({ ...link, locale })));
		for (const [href] of pending) {
			const result = await checkPublishedPage(context, {
				origin: instance.origin,
				href,
				locale,
				releaseId: report.release_id,
				verify: publishedViewContracts[new URL(href, instance.origin).pathname],
			});
			report.pages.push(result);
			for (const discovered of result.links) {
				if (!pending.has(discovered.href)) {
					pending.set(discovered.href, discovered);
					report.discovered.push({ ...discovered, locale });
				}
			}
			console.log(`${locale} ${href}: ${result.status}`);
			await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
		}
	}
	assert.ok(report.pages.length);
	const projectScope =
		report.project_scope?.production_project_ref ??
		report.project_scope?.project_scope?.production_project_ref;
	const fixtures = await prepareBusinessActionFixtures(instance, page.request, {
		origin: instance.origin,
		projectRef: projectScope,
	});
	report.fixtures = {
		users: fixtures.users.map((user) => user.email),
		expected_campaigns: fixtures.expected.campaigns,
	};
	await saveReport();
	report.actions.push(
		...(await runPublishedBusinessActions(context, {
			origin: instance.origin,
			releaseId: report.release_id,
			users: fixtures.users,
			expected: fixtures.expected,
		})),
	);
	await saveReport();
	assert.ok(
		report.actions.length === 6 && report.actions.every((action) => action.success),
		`Representative business actions failed: ${JSON.stringify(report.actions, null, 2)}`,
	);
	await exerciseBusinessActionFaults(
		instance,
		context,
		{ origin: instance.origin, releaseId: report.release_id, expected: fixtures.expected },
		report.action_faults,
		saveReport,
	);
	assert.ok(
		summarizePublishedMenu(report).complete,
		"Published menu contains failures or unverified destinations; inspect the report",
	);
	report.status = "passed";
} catch (error) {
	report.errors.push(error.message);
	console.error(error.message);
	report.status = "failed";
	process.exitCode = 1;
} finally {
	const validated = report.status === "passed";
	if (validated) report.status = "incomplete";
	try {
		await saveReport();
	} catch (error) {
		report.errors.push(`Report write failed: ${error.message}`);
		report.status = "failed";
		process.exitCode = 1;
	}
	for (const cleanup of [() => browser?.close(), () => instance?.dispose()]) {
		try {
			await cleanup();
		} catch (error) {
			report.errors.push(`Cleanup failed: ${error.message}`);
			report.status = "failed";
			process.exitCode = 1;
		}
	}
	report.coverage = summarizePublishedMenu(report);
	if (validated && report.errors.length === 0) report.status = "passed";
	report.finished_at = new Date().toISOString();
	try {
		await saveReport();
	} catch (error) {
		console.error(`Report write failed: ${error.message}`);
		report.status = "failed";
		process.exitCode = 1;
	}
	console.log(`Published menu: ${report.status}; report: ${reportPath}`);
}
