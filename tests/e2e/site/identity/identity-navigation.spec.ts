import { createHash } from "node:crypto";

import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import { evidence, projectRef, ready, siteApi } from "../../../fixtures/site-browser/site-api.js";
const plugin = "supbrd-plug-user";
const noUser = "identity_missing_fixture_7c4f983d";
const policies = [
	["Update Info", "update_info"],
	["Change Password", "change_password"],
	["Change Email", "change_email"],
	["Reset MFA", "reset_mfa"],
	["Manage Passkey", "manage_passkey"],
	["Manage Recovery Code", "manage_recovery_code"],
] as const;

test("Identity roots and overview use real project configuration and navigation", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const config = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/identity-admin/projects/${ref}`,
	);
	for (const [path, route] of [
		["/identity", "superboard.identity"],
		["/identity/en", "superboard.identity_by_lang"],
		["/identity/en/dashboard", "superboard.identity_by_lang_dashboard"],
	]) {
		await ready(page, path!);
		await expect(page).toHaveURL(
			new URL(path!, String(test.info().project.use.baseURL)).toString(),
		);
		await expect(
			page.locator(`a[href="${config.configs.AUTH_SERVER_URL}/.well-known/openid-configuration"]`),
		).toBeVisible();
		const locales = page.getByRole("row").filter({ hasText: "SUPPORTED_LOCALES" });
		await expect(locales).toContainText(config.configs.SUPPORTED_LOCALES.join(", "));
		if (!(await page.getByRole("navigation", { name: "Identity pages" }).isVisible()))
			await page
				.getByRole("complementary", { name: "SuperBoard navigation" })
				.getByText("Identity", { exact: true })
				.click();
		await page
			.getByRole("navigation", { name: "Identity pages" })
			.getByRole("link", { name: "Roles", exact: true })
			.click();
		await expect(page).toHaveURL(/\/identity\/en\/roles$/);
		await evidence(
			plugin,
			route!,
			[ref],
			"Opened the configured Identity overview alias; showed live auth metadata and followed the Roles navigation link.",
		);
	}
});

test("Identity users search filters actual subjects and restores the list", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const users = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/identity-admin/projects/${ref}/api/v1/users?pageSize=10&pageNumber=1`,
	);
	const user = users.users.find((entry: { email?: string }) => entry.email);
	expect(user, "A native Identity subject must exist in this QA project").toBeDefined();
	await ready(page, "/identity/en/users");
	await page.getByRole("textbox").first().fill(noUser);
	await expect(page.getByTestId("userRow").filter({ visible: true })).toHaveCount(0);
	await page.getByRole("textbox").first().fill(user.email);
	await expect(page.getByTestId("userRow").filter({ visible: true })).toHaveCount(1);
	await expect(page.getByTestId("userRow").filter({ visible: true })).toContainText(user.email);
	await page.getByRole("textbox").first().fill("");
	await expect(page.getByTestId("userRow").filter({ visible: true })).not.toHaveCount(0);
	await evidence(
		plugin,
		"superboard.identity_by_lang_users",
		[user.authId],
		"Filtered the actual persisted native subject, confirmed no-result behavior, then restored the user list.",
	);
});

test("Identity log lists expose real native events and cancel cleanup without deleting them", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const ids: string[] = [];
	await ready(page, "/identity/en/logs");
	for (const [kind, button, row] of [
		["email", "emailLogCleanBtn", "emailLogRow"],
		["sms", "smsLogCleanBtn", "smsLogRow"],
		["sign-in", "signInLogCleanBtn", "signInRow"],
	]) {
		const api = `/api/v1/identity-admin/projects/${ref}/api/v1/logs/${kind}?pageSize=10&pageNumber=1`;
		const before = await siteApi(page.request, plugin, "GET", api);
		expect(before.logs.length).toBeGreaterThan(0);
		ids.push(String(before.logs[0].id));
		await expect(page.getByTestId(row!).first()).toBeVisible();
		await page.getByTestId(button!).click();
		await expect(page.getByRole("alertdialog")).toBeVisible();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		await expect(page.getByRole("alertdialog")).toHaveCount(0);
		const after = await siteApi(page.request, plugin, "GET", api);
		expect(after.logs.map((entry: { id: number }) => entry.id)).toEqual(
			before.logs.map((entry: { id: number }) => entry.id),
		);
	}
	await page.reload();
	await expect(page.getByTestId("emailLogRow").first()).toBeVisible();
	await evidence(
		plugin,
		"superboard.identity_by_lang_logs",
		ids,
		"Read real Email/SMS/sign-in events, opened each cleanup confirmation, cancelled, and confirmed all persisted IDs remain.",
	);
});

test("Identity account buttons initiate each registered OAuth policy with a fresh PKCE challenge", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const config = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/identity-admin/projects/${ref}`,
	);
	const apps = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/identity-admin/projects/${ref}/api/v1/apps`,
	);
	const app = apps.apps.find(
		(entry: { type: string; isActive: boolean; redirectUris: string[] }) =>
			entry.type === "spa" && entry.isActive && entry.redirectUris.length,
	);
	expect(app, "An active native SPA with a redirect URI is required").toBeDefined();
	const appDetail = (
		await siteApi(
			page.request,
			plugin,
			"GET",
			`/api/v1/identity-admin/projects/${ref}/api/v1/apps/${app.id}`,
		)
	).app;
	const seen = new Set<string>();
	for (const [label, policy] of policies) {
		await ready(page, "/identity/en/account");
		let captured: string | undefined;
		const routePattern = `${config.configs.AUTH_SERVER_URL}/oauth2/v1/authorize?**`;
		await page.route(routePattern, async (route) => {
			captured = route.request().url();
			await route.abort("blockedbyclient");
		});
		await page.getByRole("button", { name: label, exact: true }).click({ noWaitAfter: true });
		await expect.poll(() => captured !== undefined).toBe(true);
		await page.unroute(routePattern);
		await ready(page, "/identity/en/account");
		const url = new URL(captured!);
		const stored = await page.evaluate(
			(state) => sessionStorage.getItem(`superboard.identity.pkce.${state}`),
			url.searchParams.get("state"),
		);
		const verifier = JSON.parse(stored!).verifier;
		for (const scope of url.searchParams.get("scope")!.split(" "))
			expect(appDetail.scopes).toContain(scope);

		expect(url.origin).toBe(new URL(config.configs.AUTH_SERVER_URL).origin);
		expect(url.searchParams.get("policy")).toBe(policy);
		expect(url.searchParams.get("client_id")).toBe(app.clientId);
		expect(url.searchParams.get("redirect_uri")).toBe(app.redirectUris[0]);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("code_challenge")).toBe(
			createHash("sha256").update(verifier).digest("base64url"),
		);
		expect(seen.has(url.searchParams.get("state")!)).toBe(false);
		seen.add(url.searchParams.get("state")!);
		await page.unroute(routePattern);
	}
	await evidence(
		plugin,
		"superboard.identity_by_lang_account",
		[String(app.id)],
		"Six real account buttons produced registered OAuth requests with fresh state and verified PKCE. External navigation was blocked in QA; no remote account change is claimed.",
	);
});
