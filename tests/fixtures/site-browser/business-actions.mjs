import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { parse } from "jsonc-parser";
import { expect } from "@playwright/test";

import { root } from "../../../scripts/cloudflare/target.mjs";

const execute = promisify(execFile);
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const STATISTICS_DATA_SOURCE = "supbrd-plugmod-marketing.data_source.marketing_statistics";

export async function readServedReleaseId(page) {
	return page.evaluate(
		() => document.querySelector('meta[name="superboard-release-id"]')?.getAttribute("content") || "",
	);
}

async function waitForPublishedFront(page) {
	await page
		.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])')
		.waitFor({ timeout: 60000 });
	await page.locator("main h1, main input, main table, main form").first().waitFor({ timeout: 60000 });
}

function queryParameter(response, name) {
	const url = new URL(response.url());
	if (url.searchParams.has(name)) return url.searchParams.get(name);
	const envelope = url.searchParams.get("request");
	if (!envelope) return null;
	try {
		const parsed = JSON.parse(envelope);
		const inner = new URL(parsed.path ?? "", "https://adapter.internal");
		return inner.searchParams.get(name);
	} catch {
		return null;
	}
}

function actionRecord(action, locale, releaseId, expected, observed, success, error) {
	return {
		action,
		locale,
		release_id: releaseId,
		expected,
		observed,
		success,
		...(error ? { error } : {}),
	};
}

async function searchUserAction(page, { origin, locale, releaseId, users }) {
	const expectation = "Search finds a known fixture user and excludes another known fixture user";
	const initialResponse = page.waitForResponse((response) => {
		const { pathname } = new URL(response.url());
		return pathname.includes("/application-users/projects/") && pathname.endsWith("/users");
	});
	await page.goto(new URL(`/auth/users?lang=${locale}`, origin).href);
	const initial = await initialResponse;
	assert.equal(initial.status(), 200, "Initial application user listing must succeed");
	const listed = (await initial.json()).data ?? [];
	const fixtures =
		users === "discover"
			? listed.filter((user) => user.email?.endsWith("@example.test"))
			: listed.filter((user) => users.some((fixture) => fixture.id === user.id));
	assert.ok(
		fixtures.length >= 2,
		`User search requires two identifiable fixture users; the listing exposes ${listed.length} user(s)`,
	);
	const [matched, excluded] = fixtures;
	await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
	const searchInput = page.locator("main").getByRole("textbox").first();
	await searchInput.fill(matched.email);
	assert.equal(
		await searchInput.inputValue(),
		matched.email,
		"The search field must retain the fixture email before submission",
	);
	const filteredResponse = page.waitForResponse(
		(response) => queryParameter(response, "q") === matched.email,
	);
	await page
		.locator("main")
		.getByRole("button", { name: locale === "fr" ? "Rechercher" : "Search", exact: true })
		.click();
	const filtered = await filteredResponse;
	assert.equal(filtered.status(), 200, "Filtered application user query must succeed");
	const results = (await filtered.json()).data ?? [];
	assert.ok(
		results.some((user) => user.id === matched.id),
		"Filtered listing must contain the searched fixture user",
	);
	assert.ok(
		results.every((user) => user.id !== excluded.id),
		"Filtered listing must exclude the nonmatching fixture user",
	);
	await expect(page.locator("main tbody tr").filter({ hasText: matched.email })).toHaveCount(1);
	await expect(page.locator("main tbody tr").filter({ hasText: excluded.email })).toHaveCount(0);
	return actionRecord(
		"search_user",
		locale,
		releaseId,
		expectation,
		`The real query for ${matched.email} returned and rendered the matching fixture while excluding ${excluded.email}`,
		true,
	);
}

async function refreshStatisticsAction(page, { origin, locale, releaseId, expected }) {
	const expectation = "Refresh triggers the real statistics data source and renders its measured buckets";
	const statisticsResponse = () =>
		page.waitForResponse((response) => response.url().includes(STATISTICS_DATA_SOURCE));
	const initial = statisticsResponse().catch(() => null);
	await page.goto(new URL(`/communication/statistics?lang=${locale}`, origin).href);
	const refreshButton = page
		.locator("main")
		.getByRole("button", { name: locale === "fr" ? "Actualiser" : "Refresh" })
		.first();
	await refreshButton.waitFor({ timeout: 60000 });
	await initial;
	const refreshed = statisticsResponse();
	await refreshButton.click();
	const response = await refreshed;
	assert.equal(response.status(), 200, "Statistics data source query must succeed");
	const payload = await response.json();
	const statistics = payload?.data?.data ?? payload?.data ?? payload;
	assert.ok(statistics?.totals, "Statistics payload must expose totals");
	if (typeof expected?.campaigns === "number")
		assert.equal(
			Number(statistics.totals.campaigns || 0),
			expected.campaigns,
			"Statistics totals must reflect the known campaign fixture",
		);
	const buckets = Array.isArray(statistics.series) ? statistics.series.length : 0;
	await expect(
		page.getByText(`${buckets} ${locale === "fr" ? "périodes mesurées" : "measured event buckets"}`, {
			exact: true,
		}),
	).toBeVisible();
	return actionRecord(
		"refresh_statistics",
		locale,
		releaseId,
		expectation,
		`The statistics API answered 200 with ${Number(statistics.totals.campaigns || 0)} campaign(s) and the rendered bucket count (${buckets}) matches its series`,
		true,
	);
}

async function saveAndReloadSettingAction(page, { origin, locale, releaseId, operatorId }) {
	const expectation = "A profile setting is saved through the real API and persists after reload";
	const profileSave = () =>
		page.waitForResponse(
			(response) =>
				response.request().method() === "PUT" &&
				new URL(response.url()).pathname === `/_emdash/api/admin/users/${operatorId}`,
		);
	await page.goto(new URL(`/auth/profile?lang=${locale}`, origin).href);
	const nameInput = page.locator('main input[name="name"]');
	await nameInput.waitFor({ timeout: 60000 });
	const originalName = await nameInput.inputValue();
	const updatedName = originalName ? `${originalName}-issue77` : "issue77-operator";

	async function save(name) {
		await nameInput.fill(name);
		const saved = profileSave();
		await page.locator('main button[type="submit"]').first().click();
		const response = await saved;
		assert.ok(
			response.status() >= 200 && response.status() < 300,
			`Profile save must be accepted by the service (HTTP ${response.status()})`,
		);
	}

	try {
		await save(updatedName);
		await page.reload();
		await nameInput.waitFor({ timeout: 60000 });
		assert.equal(
			await nameInput.inputValue(),
			updatedName,
			"Modified setting must persist after a full reload",
		);
	} finally {
		const restore = profileSave().catch(() => null);
		await nameInput.fill(originalName).catch(() => {});
		await page.locator('main button[type="submit"]').first().click().catch(() => {});
		await restore;
	}
	await page.reload();
	await nameInput.waitFor({ timeout: 60000 });
	assert.equal(
		await nameInput.inputValue(),
		originalName,
		"Original setting value must be restored",
	);
	return actionRecord(
		"save_and_reload_setting",
		locale,
		releaseId,
		expectation,
		"The save was accepted (2xx), the changed value survived a reload and the original value was restored",
		true,
	);
}

async function resolveOperatorId(page, origin) {
	await page.request.get(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/_emdash/api/auth/me", origin).href,
	);
	const response = await page.request.get(new URL("/_emdash/api/auth/me", origin).href);
	assert.ok(response.ok(), "Operator session is required for the business actions");
	const profile = await response.json();
	const operatorId = profile?.data?.user?.id ?? profile?.data?.id;
	assert.ok(operatorId, "Operator identity is required for the business actions");
	return operatorId;
}

const businessActions = [
	["search_user", searchUserAction],
	["refresh_statistics", refreshStatisticsAction],
	["save_and_reload_setting", saveAndReloadSettingAction],
];

export async function runPublishedBusinessActions(
	context,
	{ origin, releaseId, locales = ["en", "fr"], users = "discover", expected = {}, only },
) {
	const page = await context.newPage();
	page.setDefaultTimeout(60000);
	page.setDefaultNavigationTimeout(60000);
	const records = [];
	try {
		const operatorId = await resolveOperatorId(page, origin);
		const selected = only ? businessActions.filter(([name]) => only.includes(name)) : businessActions;
		assert.ok(selected.length, "At least one business action must be selected");
		for (const locale of locales) {
			for (const [name, run] of selected) {
				try {
					await page.goto("about:blank");
					await page.goto(new URL(`/superboard-system/home?lang=${locale}`, origin).href);
					await waitForPublishedFront(page);
					assert.equal(
						await readServedReleaseId(page),
						releaseId,
						"Business actions must run against the expected Release",
					);
					records.push(await run(page, { origin, locale, releaseId, users, expected, operatorId }));
				} catch (error) {
					records.push(
						actionRecord(
							name,
							locale,
							releaseId,
							"Representative action completes against the published Front",
							`Failed: ${error.message.split("\n")[0]}`,
							false,
							`${error.message.split("\n")[0]}\n${error.stack ?? ""}`,
						),
					);
				}
			}
		}
	} finally {
		await page.close();
	}
	return records;
}

async function alterPluginStore(instance, service, sql) {
	await execute(process.execPath, [
		wrangler,
		"d1",
		"execute",
		"DB",
		"--local",
		"--config",
		join(instance.directory, `${service}.jsonc`),
		"--persist-to",
		instance.state,
		"--command",
		sql,
	]);
}

function serviceOrigin(instance, service) {
	const child = instance.children.get(service);
	assert.ok(child && child.exitCode === null, `Service ${service} must still be running`);
	const portIndex = child.spawnargs.indexOf("--port");
	assert.ok(portIndex >= 0, `Service ${service} must expose its dev port`);
	return `http://127.0.0.1:${child.spawnargs[portIndex + 1]}`;
}

async function d1FirstRow(instance, service, sql) {
	const config = parse(await readFile(join(instance.directory, `${service}.jsonc`), "utf8"));
	const binding = config.d1_databases?.[0]?.binding;
	assert.ok(binding, `Service ${service} must expose a D1 binding`);
	const { stdout } = await execute(
		process.execPath,
		[
			wrangler,
			"d1",
			"execute",
			binding,
			"--local",
			"--config",
			join(instance.directory, `${service}.jsonc`),
			"--persist-to",
			instance.state,
			"--json",
			"--command",
			sql,
		],
		{ maxBuffer: 16 * 1024 * 1024 },
	);
	const rows = JSON.parse(stdout)[0]?.results ?? [];
	assert.ok(rows.length, `Query returned no rows: ${sql}`);
	return rows[0];
}

export async function prepareBusinessActionFixtures(instance, request, { origin, projectRef }) {
	assert.ok(projectRef, "Production project reference is required to seed action fixtures");
	const apiOrigin = serviceOrigin(instance, "api");
	const apiInstanceRow = await d1FirstRow(
		instance,
		"api",
		"SELECT id, api_key FROM instances ORDER BY id LIMIT 1",
	);
	const identifier = new URL(apiOrigin).host;
	const instanceId = Number(apiInstanceRow.id);
	assert.ok(Number.isSafeInteger(instanceId) && instanceId > 0, "Instance id must be numeric");
	await alterPluginStore(
		instance,
		"api",
		`INSERT INTO applications (instance_id, platform, enabled) SELECT ${instanceId}, 'web', 1 WHERE NOT EXISTS (SELECT 1 FROM applications WHERE instance_id = ${instanceId} AND platform = 'web');
		 INSERT INTO web_configurations (application_id, site_url) SELECT id, '${apiOrigin}' FROM applications WHERE instance_id = ${instanceId} AND platform = 'web' AND NOT EXISTS (SELECT 1 FROM web_configurations WHERE application_id = (SELECT id FROM applications WHERE instance_id = ${instanceId} AND platform = 'web'));`,
	);
	const users = [];
	for (const index of [1, 2]) {
		const email = `issue77-fixture-${index}-${crypto.randomUUID().slice(0, 8)}@example.test`;
		const registered = await request.post(new URL("/auth/register", apiOrigin).href, {
			headers: {
				Origin: apiOrigin,
				"Content-Type": "application/json",
				"PROJECT-KEY": String(apiInstanceRow.api_key),
				PLATFORM: "web",
				IDENTIFIER: identifier,
			},
			data: {
				email,
				password: `issue77-password-${index}-aB9x`,
				name: `Issue 77 fixture ${index}`,
			},
		});
		assert.equal(
			registered.status(),
			201,
			`Registering fixture user through the public API failed: ${await registered.text()}`,
		);
		const value = await registered.json();
		assert.ok(value.user?.id, "Registration response must expose the created user");
		users.push({ id: value.user.id, email });
	}
	const campaign = await request.post(
		new URL(`/api/v1/marketing/projects/${encodeURIComponent(projectRef)}/campaigns`, origin).href,
		{
			headers: {
				Origin: origin,
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
				"X-SuperBoard-Plugin-Id": "supbrd-plugmod-marketing",
			},
			data: { name: "Issue 77 statistics fixture", subject: "Issue 77 known campaign" },
		},
	);
	assert.equal(
		campaign.status(),
		201,
		`Creating the known campaign fixture failed: ${await campaign.text()}`,
	);
	return { users, expected: { campaigns: 1 } };
}

export async function exerciseBusinessActionFaults(
	instance,
	context,
	{ origin, releaseId, expected },
	report,
	saveReport,
) {
	async function outcome(name, record, expectedOutcome) {
		report.push({ name, expected: expectedOutcome, result: record });
		await saveReport();
		console.log(`Action fault ${name} (${record.locale}): ${record.success ? "passed" : "failed"}`);
		assert.equal(record.success, expectedOutcome === "passed", `${name}: ${JSON.stringify(record)}`);
	}

	const page = await context.newPage();
	try {
		const operatorId = await resolveOperatorId(page, origin);
		const refused = await page.request.put(
			new URL(`/_emdash/api/admin/users/${operatorId}`, origin).href,
			{
				headers: { Origin: origin, "X-EmDash-Request": "1" },
				data: { name: "Issue 77 refusal probe", email: "issue77-not-an-email" },
			},
		);
		assert.ok(
			refused.status() >= 400,
			`A malformed profile update must be refused by the service (HTTP ${refused.status()})`,
		);
		const refusal = await refused.json();
		report.push({
			name: "save-refused",
			expected: "failed",
			result: { success: false, status: refused.status(), code: refusal.error?.code ?? "" },
		});
		await saveReport();

		await alterPluginStore(
			instance,
			"marketing",
			"ALTER TABLE email_events RENAME TO issue77_email_events",
		);
		try {
			const [damaged] = await runPublishedBusinessActions(context, {
				origin,
				releaseId,
				locales: ["en"],
				expected,
				only: ["refresh_statistics"],
			});
			await outcome("statistics-store-damaged", damaged, "failed");
		} finally {
			await alterPluginStore(
				instance,
				"marketing",
				"ALTER TABLE issue77_email_events RENAME TO email_events",
			);
		}
		const [restored] = await runPublishedBusinessActions(context, {
			origin,
			releaseId,
			locales: ["en"],
			expected,
			only: ["refresh_statistics"],
		});
		await outcome("statistics-store-restored", restored, "passed");
	} finally {
		await page.close();
	}
}
