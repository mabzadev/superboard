import { test, expect } from "@playwright/test";

import { invitedOperator, logout, virtualPasskey } from "../../fixtures/operator-auth.js";
import { evidence, operatorHeaders, unwrap } from "../../fixtures/site-api.js";

test.describe("Operator sign in", () => {
	test("shows the native email and passkey sign-in methods", async ({ page }) => {
		await page.goto("/login");
		await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Sign in with a passkey", exact: true }),
		).toBeVisible();
	});
	test("a real credential establishes the operator session", async ({ page }) => {
		const user = await invitedOperator(page);
		await logout(page);
		await page.goto("/login");
		await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/superboard-system/home");
		const value = unwrap(await (await page.request.get("/_emdash/api/auth/me")).json());
		expect((value.user ?? value).id).toBe(user.id);
		await evidence(
			"supbrd-plug-user",
			"superboard.login",
			[user.id],
			"Real WebAuthn sign-in creates the same operator session after logout.",
		);
	});
	test("invalid email-link credentials do not establish a session", async ({ page }) => {
		await page.goto("/_emdash/api/auth/magic-link/verify?token=invalid");
		await expect.poll(() => new URL(page.url()).pathname).toBe("/_emdash/admin/login");
		expect((await page.request.get("/_emdash/api/auth/me")).status()).toBe(401);
	});
	test("respects the requested local return path", async ({ page }) => {
		await invitedOperator(page);
		await logout(page);
		await page.goto("/login?backTo=%2Faccount");
		await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/account");
		await expect(
			page.getByRole("heading", { name: "Account security", exact: true }),
		).toBeVisible();
	});
	test("revoking a credential prevents subsequent authentication with it", async ({ page }) => {
		const user = await invitedOperator(page);
		await logout(page);
		await page.goto("/login");
		await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/superboard-system/home");
		const stored = await user.cdp.send("WebAuthn.getCredentials", {
			authenticatorId: user.authenticatorId,
		});
		await user.cdp.send("WebAuthn.removeVirtualAuthenticator", {
			authenticatorId: user.authenticatorId,
		});
		const backup = await virtualPasskey(page);
		await page.goto("/account");
		await page.getByRole("textbox", { name: "Passkey name", exact: true }).fill("Backup passkey");
		await page.getByRole("button", { name: "Create a passkey", exact: true }).click();
		await expect(page.getByText("Backup passkey", { exact: true })).toBeVisible();
		await backup.cdp.send("WebAuthn.removeVirtualAuthenticator", {
			authenticatorId: backup.authenticatorId,
		});
		const original = await virtualPasskey(page);
		await original.cdp.send("WebAuthn.addCredential", {
			authenticatorId: original.authenticatorId,
			credential: stored.credentials[0],
		});
		const credentials = unwrap(await (await page.request.get("/_emdash/api/auth/passkey")).json());
		const key = (credentials.credentials ?? credentials.items ?? credentials).find(
			(item: { name: string }) => item.name !== "Backup passkey",
		);
		expect(key.id).toBeTruthy();
		expect(
			(
				await page.request.delete(`/_emdash/api/auth/passkey/${key.id}`, {
					headers: operatorHeaders(),
				})
			).ok(),
		).toBe(true);
		await evidence(
			"supbrd-plug-user",
			"superboard.account",
			[user.id, key.id],
			"Registered a backup passkey through the account form, read the credential list, revoked the original and retained the backup.",
		);
		await logout(page);
		await page.goto("/login");
		await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/_emdash/admin/login");
		expect((await page.request.get("/_emdash/api/auth/me")).status()).toBe(401);
	});
	test("empty email cannot submit a sign-in request", async ({ page }) => {
		let submitted = false;
		page.on("request", (request) => {
			if (request.url().includes("magic-link/send")) submitted = true;
		});
		await page.goto("/login");
		await page.getByRole("button", { name: "Send email link", exact: true }).click();
		await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeFocused();
		expect(submitted).toBe(false);
	});
	test("keeps the core authentication entry available for configured SSO providers", async ({
		page,
	}) => {
		await page.goto("/login");
		await page.getByRole("link", { name: "Operator sign in", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/_emdash/admin/login");
		await expect(page.getByRole("heading", { name: /sign in|welcome/i }).first()).toBeVisible();
	});
});

test("operator profile updates the authenticated core user and persists after reload", async ({
	page,
}) => {
	const user = await invitedOperator(page);
	await page.goto("/app/profile");
	const name = "Native profile " + Date.now();
	await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
	await page.getByRole("button", { name: "Save profile", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Profile saved");
	await page.reload();
	await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(name);
	const me = unwrap(await (await page.request.get("/_emdash/api/auth/me")).json());
	expect((me.user ?? me).name).toBe(name);
	await evidence(
		"supbrd-plug-user",
		"superboard.profile",
		[user.id],
		"Saved the real operator profile, reloaded the form and confirmed the same name in the authenticated Core session.",
	);
});
