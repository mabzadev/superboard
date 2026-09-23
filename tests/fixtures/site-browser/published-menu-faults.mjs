import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect } from "@playwright/test";

import { root } from "../../../scripts/cloudflare/target.mjs";
import { checkPublishedPage, discoverPublishedLinks } from "./published-menu.mjs";
import { publishedViewContracts } from "./published-view-contracts.mjs";

export async function exercisePublishedMenuFaults(
	instance,
	context,
	releaseId,
	report,
	saveReport,
) {
	const page = await context.newPage();
	const headers = { Origin: instance.origin, "X-EmDash-Request": "1" };
	const statistics = "/acquisition/paywalls/statistics";
	const verify = publishedViewContracts[statistics];
	const check = (href, locale, timeout, options = {}) =>
		checkPublishedPage(context, {
			origin: instance.origin,
			href,
			locale,
			releaseId,
			verify,
			timeout,
			...options,
		});
	async function outcome(name, result, expected) {
		report.push({ name, expected, result });
		await saveReport();
		console.log(`Fault check ${name} (${result.locale}): ${result.status}; expected ${expected}`);
		assert.equal(result.status, expected, `${name}: ${JSON.stringify(result.errors)}`);
	}
	try {
		for (const locale of ["en", "fr"]) {
			await outcome("statistics-empty", await check(statistics, locale), "passed");
			const missing = "/_emdash/admin/issue76-missing-view";
			const created = await page.request.post(
				`/_emdash/api/menus/superboard-admin/items?locale=${locale}`,
				{
					headers,
					data: { type: "custom", label: `Issue 76 ${locale}`, customUrl: missing },
				},
			);
			assert.equal(created.status(), 201, await created.text());
			const item = (await created.json()).data;
			try {
				await page.goto(`/superboard-system/home?lang=${locale}`);
				await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
				const links = await discoverPublishedLinks(page, instance.origin);
				assert.ok(
					links.some(({ href }) => href === missing),
					"Broken menu link must actually be discovered",
				);
				const result = await check(missing, locale);
				await outcome("missing-route", result, "failed");
				assert.equal(result.http_status, 200, "Exercise a missing route inside an HTTP 200 shell");
				assert.match(result.render_diagnostic ?? "", /not found|introuvable|404/iu);
			} finally {
				const deleted = await page.request.delete(
					`/_emdash/api/menus/superboard-admin/items/${item.id}?locale=${locale}`,
					{ headers },
				);
				assert.ok(deleted.ok());
			}
		}

		const projectResponse = await page.request.post("/_emdash/api/superboard/operator-context", {
			headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
			data: {},
		});
		assert.ok(projectResponse.ok(), await projectResponse.text());
		const scope = await projectResponse.json();
		const project = scope.project_scope?.production_project_ref ?? scope.production_project_ref;
		assert.ok(project);
		const created = await page.request.post(`/api/v1/paywalls/projects/${project}`, {
			headers: {
				...headers,
				"X-SuperBoard-Plugin-Id": "supbrd-plugmod-paywalls",
				"Idempotency-Key": crypto.randomUUID(),
			},
			data: { identifier: "issue76-editor", display_name: "Issue 76 editor" },
		});
		assert.ok(created.ok(), await created.text());
		const body = await created.json();
		const paywall = body.data?.data ?? body.data ?? body;
		assert.ok(paywall.id);
		for (const locale of ["en", "fr"]) {
			const editor = `/acquisition/paywalls?item=${paywall.id}`;
			await page.goto(`${editor}&lang=${locale}`);
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Enregistrer une version" : "Save immutable draft",
					exact: true,
				})
				.waitFor();
			const result = await check(editor, locale, 5000);
			await outcome("editor-is-not-statistics", result, "failed");
			assert.equal(result.http_status, 200);
			assert.equal(result.observed_release, releaseId);
			assert.ok(
				result.errors.some(
					({ kind, symptom }) => kind === "assertion" && symptom.includes("impression"),
				),
			);
		}

		const client = join(instance.directory, "apps/site/src/components/NativeFrontControls.tsx");
		const original = await readFile(client, "utf8");
		const moduleUrl = await page.evaluate(() =>
			performance
				.getEntriesByType("resource")
				.map((entry) => entry.name)
				.find((url) => url.includes("NativeFrontControls")),
		);
		assert.ok(moduleUrl, "Observe the real client module before injecting its failure");
		const waitForModule = async (broken) => {
			await expect
				.poll(
					async () => {
						const response = await page.request.get(moduleUrl);
						return (
							response.ok() && (await response.text()).includes("ISSUE76_RENDER_FAILURE") === broken
						);
					},
					{ timeout: 30000 },
				)
				.toBe(true);
		};
		try {
			await writeFile(client, `${original}\nthrow new Error("ISSUE76_RENDER_FAILURE");\n`);
			await waitForModule(true);
			for (const locale of ["en", "fr"]) {
				const result = await check(statistics, locale);
				await outcome("render-failure", result, "failed");
				assert.match(JSON.stringify(result), /ISSUE76_RENDER_FAILURE/u);
			}
		} finally {
			await writeFile(client, original);
			await waitForModule(false);
		}
		for (const locale of ["en", "fr"])
			await outcome("render-restored", await check(statistics, locale), "passed");

		const execute = promisify(execFile);
		const alter = (sql) =>
			execute(process.execPath, [
				join(root, "node_modules/wrangler/bin/wrangler.js"),
				"d1",
				"execute",
				"DB",
				"--local",
				"--config",
				join(instance.directory, "paywalls.jsonc"),
				"--persist-to",
				instance.state,
				"--command",
				sql,
			]);
		await alter("ALTER TABLE events RENAME TO issue76_events");
		try {
			for (const locale of ["en", "fr"]) {
				const result = await check(statistics, locale);
				await outcome("api-failure", result, "failed");
				assert.ok(
					result.requests.some(({ status }) => status >= 400),
					"A real business API must reject the damaged store",
				);
			}
		} finally {
			await alter("ALTER TABLE issue76_events RENAME TO events");
		}
		for (const locale of ["en", "fr"])
			await outcome("store-restored", await check(statistics, locale), "passed");

		const api = instance.children.get("api");
		assert.ok(api && api.exitCode === null);
		for (const locale of ["en", "fr"]) {
			try {
				const result = await check(statistics, locale, 30000, {
					dataTimeout: 1500,
					beforeCheck: async (loaded) => {
						await loaded.waitForLoadState("networkidle");
						process.kill(-api.pid, "SIGSTOP");
						await loaded
							.locator('input[type="date"]')
							.first()
							.fill(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
					},
				});
				await outcome("blocked-api", result, "failed");
				assert.ok(
					result.errors.some(({ kind, url }) => kind === "loading" && /paywall/u.test(url)),
					"Observe the business request pending after the page has hydrated",
				);
			} finally {
				process.kill(-api.pid, "SIGCONT");
			}
		}
		for (const locale of ["en", "fr"])
			await outcome("api-restored", await check(statistics, locale), "passed");
	} finally {
		await page.close();
	}
}
