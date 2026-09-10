import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import {
	evidence,
	field,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
} from "../../../fixtures/site-browser/site-api.js";
const plugin = "supbrd-plug-user";

for (const [path, route] of [
	["/app/users", "superboard.users"],
	["/app/members", "superboard.app_members"],
] as const) {
	test(`Application audience ${path} searches and saves a native profile`, async ({
		authenticatedPage: page,
	}) => {
		const ref = await projectRef(page);
		const base = `/api/v1/application-users/projects/${ref}`;
		const users = await siteApi(page.request, plugin, "GET", `${base}/users?limit=50&offset=0`);
		const user = users.find(
			(item: { email?: string; name?: string }) =>
				item.email?.endsWith("@example.test") && item.name,
		);
		expect(user, "A real SDK-created QA application account is required").toBeDefined();
		const changed = unique("profile");
		try {
			await ready(page, path);
			await page.getByPlaceholder("Email, user ID, name or auth provider").fill(user.email);
			await page.getByRole("button", { name: "Search", exact: true }).click();
			await page.getByRole("button", { name: `Inspect ${user.email}`, exact: true }).click();
			await page.getByLabel("Display name", { exact: true }).fill(changed);
			const saved = page.waitForResponse(
				(response) =>
					response.request().method() === "POST" &&
					response.url().includes("command.update_profile"),
			);
			await page.getByRole("button", { name: "Save name", exact: true }).click();
			expect((await saved).ok()).toBe(true);
			expect(
				(await siteApi(page.request, plugin, "GET", `${base}/profiles/${user.id}`)).display_name,
			).toBe(changed);
			await page.reload();
			await page.getByPlaceholder("Email, user ID, name or auth provider").fill(user.email);
			await page.getByRole("button", { name: "Search", exact: true }).click();
			await page.getByRole("button", { name: `Inspect ${user.email}`, exact: true }).click();
			await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(changed);
			await evidence(
				plugin,
				route,
				[user.id],
				"Searched a real SDK application account, inspected it, saved the profile name through the browser form and verified persistence after reload. Original name restored after the scenario.",
			);
		} finally {
			await siteApi(page.request, plugin, "PUT", `${base}/profiles/${user.id}`, {
				user_id: user.id,
				display_name: user.name,
			});
		}
	});
}

test("App customers creates, edits and filters the actual acquisition customer", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const base = `/api/v1/app/projects/${ref}`;
	const name = unique("app-customer");
	await ready(page, "/app/customers");
	await page.getByRole("button", { name: "Add customer", exact: true }).first().click();
	await field(page, "SDK identifier").fill(name);
	await field(page, "Name").fill(name);
	await field(page, "Email").fill(`${name}@example.test`);
	await field(page, "Country code").fill("ch");
	const id = await savedByClick(page, "Save customer", plugin);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	const customer = await siteApi(page.request, plugin, "GET", `${base}/customers/${id}`);
	expect(customer).toMatchObject({ id, external_id: name, name, country_code: "CH" });
	await page.getByPlaceholder("Search customer").fill(name);
	await page.getByRole("button", { name: `View ${name}`, exact: true }).click();
	await field(page, "Name").fill(`${name} edited`);
	await savedByClick(page, "Save customer", plugin);
	await page.reload();
	await page.getByPlaceholder("Search customer").fill(name);
	await expect(
		page.getByRole("button", { name: `View ${name} edited`, exact: true }),
	).toBeVisible();
	expect((await siteApi(page.request, plugin, "GET", `${base}/customers/${id}`)).name).toBe(
		`${name} edited`,
	);
	await page.getByPlaceholder("Search customer").fill("missing-acquisition-fixture-62aa");
	await expect(page.getByRole("button", { name: `View ${name} edited`, exact: true })).toHaveCount(
		0,
	);
	await evidence(
		plugin,
		"superboard.app_customers",
		[id],
		"Created and edited a real acquisition customer with browser controls; normalized country and reloaded name were read back through the owning API, with search filtering verified.",
	);
});

test("App referrals filters and sorts real attributed records", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const base = `/api/v1/app/projects/${ref}`;
	const prefix = unique("app-referral");
	const customer = await siteApi(page.request, plugin, "POST", `${base}/customers`, {
		external_id: prefix,
		name: prefix,
	});
	const ids: string[] = [];
	const records: Array<{ id: string; code: string }> = [];
	for (const code of [`${prefix}_a`, `${prefix}_b`]) {
		const result = await siteApi(page.request, plugin, "POST", `${base}/referrals`, {
			customer_id: customer.id,
			code,
			source: "browser-fixture",
			status: "pending",
		});
		ids.push(result.id);
		records.push({ id: result.id, code });
	}
	await ready(page, "/app/referrals");
	await page.getByPlaceholder("Search referral").fill(prefix);
	const rows = page.getByRole("table", { name: "Referrals" }).locator("tbody tr");
	await expect(rows).toHaveCount(2);
	const sorted = records.toSorted((a, b) => a.id.localeCompare(b.id));
	await page.getByRole("button", { name: "Id", exact: true }).click();
	await expect(rows.first()).toContainText(sorted[0]!.code);
	await page.getByRole("button", { name: "Id", exact: true }).click();
	await expect(rows.first()).toContainText(sorted[1]!.code);
	await page.getByPlaceholder("Search referral").fill(`${prefix}_a`);
	await expect(rows).toHaveCount(1);
	await expect(rows).toContainText(`${prefix}_a`);
	await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(`${prefix}_a`);
	await page.reload();
	await expect(page.getByPlaceholder("Search referral")).toHaveValue(`${prefix}_a`);
	await expect(rows).toHaveCount(1);
	const stored = await siteApi(page.request, plugin, "GET", `${base}/referrals`);
	expect(stored.filter((item: { id: string }) => ids.includes(item.id))).toHaveLength(2);
	await evidence(
		plugin,
		"superboard.app_referrals",
		ids,
		"Created real referral records through the owning API, then filtered, sorted both directions and reloaded the browser search state.",
	);
});
