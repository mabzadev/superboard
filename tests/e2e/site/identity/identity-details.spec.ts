import { readFileSync } from "node:fs";

import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import { evidence, projectRef, ready, siteApi } from "../../../fixtures/site-browser/site-api.js";

const plugin = "supbrd-plug-user";
const usersUrl = /\/identity\/fr\/users\/?$/;
const logsUrl = /\/identity\/fr\/logs\/?$/;
type IdentityFixture = {
	authId: string;
	emailLogId: string;
	smsLogId: string;
	signInLogId: string;
};
function fixture(): IdentityFixture {
	const path = process.env.SUPERBOARD_IDENTITY_E2E_FIXTURE;
	if (!path)
		throw new Error(
			"SUPERBOARD_IDENTITY_E2E_FIXTURE must identify persisted native signup, email, SMS and sign-in fixtures.",
		);
	const value = JSON.parse(readFileSync(path, "utf8"));
	for (const name of ["authId", "emailLogId", "smsLogId", "signInLogId"])
		if (typeof value[name] !== "string" || !value[name])
			throw new Error(`Identity fixture is missing ${name}`);
	return value;
}

test("the native user detail resolves its identity, translates passkeys and cancels deletion", async ({
	authenticatedPage: page,
}) => {
	const { authId } = fixture();
	const ref = await projectRef(page);
	const data = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/identity-admin/projects/${ref}/api/v1/users/${authId}`,
	);
	const user = data.user;
	expect(user.authId).toBe(authId);
	await ready(page, `/identity/en/users/${authId}`);
	await expect(page.locator("main")).toContainText(authId);
	await expect(page.locator("main")).toContainText(user.email);
	await ready(page, `/identity/fr/users/${authId}`);
	await expect(page.getByRole("cell", { name: "Clé d’accès", exact: true })).toBeVisible();
	await expect(page.getByTestId("firstNameInput")).toHaveValue(user.firstName ?? "");
	await page.getByRole("button", { name: "Supprimer", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toContainText(user.email);
	await page.getByRole("button", { name: "Annuler", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole("cell", { name: "Clé d’accès", exact: true })).toBeVisible();
	await page.locator("main").getByText("Utilisateurs", { exact: true }).first().click();
	await expect(page).toHaveURL(usersUrl);
	await page.goBack();
	await expect(page.locator("main")).toContainText(authId);
	expect(
		(
			await siteApi(
				page.request,
				plugin,
				"GET",
				`/api/v1/identity-admin/projects/${ref}/api/v1/users/${authId}`,
			)
		).user.authId,
	).toBe(authId);
	await evidence(
		plugin,
		"superboard.identity_by_lang_users_by_authid",
		[authId],
		"Compared the native user to the owning API, rendered French passkey controls without translation errors, cancelled deletion, reloaded and returned through browser history.",
	);
});

for (const kind of ["email", "sms", "sign-in"] as const) {
	test(`${kind} log detail displays its persisted record in English and French`, async ({
		authenticatedPage: page,
	}) => {
		const ids = fixture();
		const id = kind === "email" ? ids.emailLogId : kind === "sms" ? ids.smsLogId : ids.signInLogId;
		const ref = await projectRef(page);
		const value = await siteApi(
			page.request,
			plugin,
			"GET",
			`/api/v1/identity-admin/projects/${ref}/api/v1/logs/${kind}/${id}`,
		);
		expect(value.log).toBeTruthy();
		const { log } = value;
		for (const lang of ["en", "fr"]) {
			await ready(page, `/identity/${lang}/logs/${kind}/${id}`);
			const main = page.locator("main");
			await expect(main).toContainText(log.createdAt);
			if (kind === "email" || kind === "sms") {
				await expect(main).toContainText(log.receiver);
				await expect(main).toContainText(log.response);
			} else {
				await expect(main).toContainText(String(log.userId));
			}
			await page.reload();
			await expect(main).toContainText(log.createdAt);
		}
		await page.locator("main").getByText("Journaux", { exact: true }).first().click();
		await expect(page).toHaveURL(logsUrl);
		await page.goBack();
		await expect(page.locator("main")).toContainText(log.createdAt);
		await evidence(
			plugin,
			`superboard.identity_by_lang_logs_${kind === "sign-in" ? "sign_in" : kind}_by_id`,
			[id],
			"Compared persisted native log fields to the owning API in English and French, reloaded, returned to logs and reopened through browser history.",
		);
	});
}
