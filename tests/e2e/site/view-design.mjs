import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, expect } from "@playwright/test";

const root = resolve(import.meta.dirname, "../../..");
const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const requested = process.argv.slice(2);
assert(requested.every((path) => path.startsWith("/") && !path.startsWith("//")));
const viewportWidth = Number(process.env.SUPERBOARD_DESIGN_WIDTH ?? 1440);
assert(Number.isFinite(viewportWidth) && viewportWidth >= 320);
const output = resolve(process.env.SUPERBOARD_DESIGN_REPORT ?? "scratch/view-design");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(resolve(tmpdir(), "superboard-view-design-"));
const files = [];
for (const plugin of (await readdir(resolve(root, "packages/plugins"))).filter((name) =>
	name.startsWith("superboard-"),
)) {
	for (const name of await readdir(resolve(root, "packages/plugins", plugin, "src"))) {
		if (/^front-.*\.ts$/u.test(name)) files.push(`packages/plugins/${plugin}/src/${name}`);
	}
}
const bundle = resolve(temporary, "catalog.mjs");
const entry = resolve(temporary, "catalog.ts");
await writeFile(
	entry,
	files
		.map(
			(file, index) =>
				`import { nativeFrontPlugin as p${index} } from ${JSON.stringify(resolve(root, file))};`,
		)
		.join("\n") +
		`\nexport default [${files.map((_, index) => `p${index}`).join(",")}].flatMap(p => p.surfaces.map(s => ({...s, plugin:p.plugin_id})));`,
);
const compiled = spawnSync(
	"pnpm",
	[
		"--dir",
		resolve(root, "packages/supbrd-front-ui"),
		"exec",
		"esbuild",
		entry,
		"--bundle",
		"--platform=node",
		"--format=esm",
		`--outfile=${bundle}`,
	],
	{ encoding: "utf8" },
);
assert.equal(compiled.status, 0, compiled.stderr);
const { default: catalog } = await import(pathToFileURL(bundle).href);
const browser = await chromium.launch();
const results = [];
let reportWrite = Promise.resolve();
const parameterizedRoute = /:(?!lang\b)/u;
const unresolved = new Set(
	catalog
		.filter((route) => parameterizedRoute.test(route.path_pattern))
		.map((route) => route.path_pattern),
);
const detailPaths = new Set();
const screenshots = process.env.SUPERBOARD_DESIGN_SCREENSHOTS !== "0";
try {
	for (const locale of ["fr", "en"]) {
		for (const theme of ["light", "dark"]) {
			const context = await browser.newContext({
				viewport: { width: viewportWidth, height: 1000 },
				colorScheme: theme,
			});

			const auth = await context.newPage();
			await auth.goto(
				new URL("/_emdash/api/auth/dev-bypass?redirect=/monetization/products", origin).href,
			);
			await auth.locator("main h1").waitFor();
			await auth.getByRole("button", { name: /account menu|menu du compte/u }).click();
			const currentTheme = await auth.locator("html").getAttribute("data-theme");
			if (currentTheme !== theme)
				await auth
					.getByRole("button", { name: /^(Light mode|Dark mode|Mode clair|Mode sombre)$/u })
					.click();
			else await auth.keyboard.press("Escape");
			await auth.close();
			const paths = requested.length
				? [...requested]
				: [
						...new Set(
							catalog
								.map((route) => route.path_pattern.replace(":lang", locale))
								.filter((path) => !path.includes(":")),
						),
					];
			paths.push(...[...detailPaths].filter((path) => !paths.includes(path)));
			let cursor = 0;
			async function worker() {
				const page = await context.newPage();
				page.setDefaultTimeout(12000);
				while (cursor < paths.length) {
					const path = paths[cursor++];
					const errors = [];
					const onError = (error) => errors.push(error.message);
					page.on("pageerror", onError);
					const row = { path, locale, theme, states: [], errors };
					try {
						const response = await page.goto(new URL(`${path}?lang=${locale}`, origin).href, {
							timeout: 30000,
						});
						row.status = response.status();
						await page
							.locator("main h1, main table, main [role=alert], h1, form")
							.first()
							.waitFor({ timeout: 10000 })
							.catch(() => {});
						await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
						async function capture(state) {
							await expect(
								page.locator('main svg[role="status"]:visible, main .animate-spin:visible'),
							).toHaveCount(0, { timeout: 30000 });
							const observation = await page.evaluate(() => {
								const main = document.querySelector("main");
								const heading = main?.querySelector("h1");
								const box = main?.getBoundingClientRect();
								const hbox = heading?.getBoundingClientRect();
								return {
									title: heading?.textContent ?? null,
									fontSize: heading ? getComputedStyle(heading).fontSize : null,
									inset: box && hbox ? hbox.x - box.x : null,
									loadedTheme: document.documentElement.getAttribute("data-theme"),
									overflow: document.documentElement.scrollWidth > innerWidth,
									kumoButtons: main?.querySelectorAll('[data-kumo-component="Button"]').length ?? 0,
									viewErrors: Array.from(
										document.querySelectorAll('[role="alert"]'),
										(element) => element.textContent,
									).filter((text) =>
										["View is not registered", "Plugin client unavailable", "Erreur de View"].some(
											(message) => text?.includes(message),
										),
									),
								};
							});
							const failures = [];
							if (observation.title && observation.fontSize !== "22px")
								failures.push(`Heading scale: ${observation.fontSize}`);
							if (observation.inset !== null && observation.inset < 16)
								failures.push(`Page inset: ${observation.inset}`);
							if (observation.loadedTheme !== theme)
								failures.push(`Theme: ${observation.loadedTheme}`);
							if (observation.overflow) failures.push("Page overflows the viewport");
							if (observation.kumoButtons) failures.push("Unadapted Kumo buttons");
							failures.push(...observation.viewErrors);
							const filename = `${locale}-${theme}-${path.replaceAll("/", "_") || "home"}-${row.states.length}.png`;
							if (screenshots) await page.screenshot({ path: resolve(output, filename) });
							row.states.push({
								state,
								...observation,
								failures,
								screenshot: screenshots ? filename : null,
							});
							return observation;
						}
						const initial = await capture("page");
						if (row.status === 200 && !initial.viewErrors.length) {
							const links = await page
								.locator("main a[href]")
								.evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));
							for (const href of links) {
								if (!href?.startsWith("/") || href.startsWith("//")) continue;
								const candidate = new URL(href, origin).pathname;
								for (const pattern of unresolved) {
									const expression = "^" + pattern.replace(/:[^/]+/gu, "[^/]+") + "/?$";
									if (new RegExp(expression, "u").test(candidate)) {
										detailPaths.add(candidate);
										if (!requested.length && !paths.includes(candidate)) paths.push(candidate);
									}
								}
							}
							const tabs = await page
								.locator('main nav button[aria-pressed], main [role="tab"]')
								.allTextContents();
							for (const name of [...new Set(tabs.map((text) => text.trim()))].filter(Boolean)) {
								const tab = page
									.locator('main nav button[aria-pressed], main [role="tab"]')
									.filter({
										hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"),
									})
									.first();
								if (!(await tab.isVisible()) || !(await tab.isEnabled())) continue;
								await tab.click();
								await page.waitForLoadState("networkidle", { timeout: 1000 }).catch(() => {});
								await capture(name);
							}
						}
					} catch (error) {
						errors.push(error.message.split("\n")[0]);
					}
					page.off("pageerror", onError);
					results.push(row);
					reportWrite = reportWrite.then(() =>
						writeFile(
							resolve(output, "report.json"),
							JSON.stringify(
								{
									catalogSize: catalog.length,
									parameterizedRoutes: [...unresolved],
									detailPaths: [...detailPaths],
									results,
								},
								null,
								2,
							),
						),
					);
					await reportWrite;
					console.log(
						`${locale}/${theme} ${path}: ${row.status} — ${row.states.length} states, ${errors.length + row.states.flatMap((state) => state.failures).length} findings`,
					);
				}
				await page.close();
			}
			await Promise.all([worker(), worker(), worker()]);
			await context.close();
		}
	}
} finally {
	await browser.close();
	await rm(temporary, { recursive: true, force: true });
}
const rendered = results.filter((row) => row.status === 200);
const failures = rendered.filter(
	(row) => row.errors.length || row.states.some((state) => state.failures.length),
);
console.log(
	JSON.stringify({
		pages: results.length,
		states: results.reduce((sum, row) => sum + row.states.length, 0),
		unavailable: results.length - rendered.length,
		failures: failures.length,
		output,
	}),
);
assert.equal(failures.length, 0, "Rendered views have design regressions; inspect report.json");
