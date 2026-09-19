const productNamePattern = /SuperBoard/;
const legacyTokenErrorPattern = /Invalid or expired token/;
const accountMenuPattern = /^(Open .* account menu|Ouvrir le menu du compte de .*)$/u;
const adminPathPattern = /\/_emdash\/admin\/?$/u;
import assert from "node:assert/strict";
import { test } from "node:test";

import { chromium, expect } from "@playwright/test";

const base = process.env.SUPERBOARD_TEST_BASE_URL;
if (!base) throw new Error("Run against an isolated local fixture with SUPERBOARD_TEST_BASE_URL");
const url = new URL(base);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
	throw new Error("A local test fixture is required");

await test("operator home signs in through EmDash and exposes administration through the account menu", async (t) => {
	const loggedOut = await fetch(new URL("/superboard-system/home", base), { redirect: "manual" });
	assert.equal(loggedOut.status, 302);
	assert.equal(new URL(loggedOut.headers.get("location"), base).pathname, "/_emdash/admin/login");
	const session = await fetch(new URL("/_emdash/api/setup/dev-bypass", base));
	assert.equal(session.status, 200);
	const cookie = session.headers
		.getSetCookie()
		.map((header) => header.split(";")[0])
		.join("; ");
	assert.ok(cookie);
	const home = await fetch(new URL("/superboard-system/home", base), {
		headers: { cookie },
		redirect: "manual",
	});
	assert.equal(home.status, 200);
	const html = await home.text();
	assert.match(html, productNamePattern);
	assert.doesNotMatch(html, legacyTokenErrorPattern);
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const context = await browser.newContext();
	await context.addCookies(
		cookie.split("; ").map((entry) => {
			const separator = entry.indexOf("=");
			return { name: entry.slice(0, separator), value: entry.slice(separator + 1), url: base };
		}),
	);
	const page = await context.newPage();
	await page.goto(new URL("/superboard-system/home", base).href);
	await expect(page.locator('a[href="/_emdash/admin"]')).toHaveCount(0);
	await page.getByRole("button", { name: accountMenuPattern }).click();
	const administration = page.getByRole("dialog").locator('a[href="/_emdash/admin"]');
	await expect(administration).toBeVisible({ timeout: 30000 });
	await administration.click();
	await expect(page).toHaveURL(adminPathPattern);
});
