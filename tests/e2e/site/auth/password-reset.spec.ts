import { test, expect } from "@playwright/test";

import {
	capturedLink,
	invitedOperator,
	logout,
	ownerRequest,
} from "../../../fixtures/site-browser/operator-auth.js";
import { evidence, unwrap } from "../../../fixtures/site-browser/site-api.js";

test.describe("Passwordless operator recovery", () => {
	test("explains recovery through the operator email address", async ({ page }) => {
		await page.goto("/reset_password");
		await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
		await expect(
			page.getByText("Operator accounts use EmDash passkeys and email links.", { exact: false }),
		).toBeVisible();
	});
	for (const [path, routeId] of [
		["/reset_password", "superboard.reset_password"],
		["/new_password", "superboard.new_password"],
	] as const) {
		test(`${path} recovers the same real operator through the captured email link`, async ({
			page,
		}) => {
			const user = await invitedOperator(page);
			const owner = await ownerRequest(page);
			try {
				await logout(page);
				await page.goto(path);
				await page.getByRole("textbox", { name: "Email", exact: true }).fill(user.email);
				await page.getByRole("button", { name: "Send email link", exact: true }).click();
				await expect(page.getByRole("status")).toContainText("If this address is eligible");
				await page.goto(await capturedLink(owner.request, user.email));
				await expect.poll(() => new URL(page.url()).pathname).toBe("/_emdash/admin");
				const profile = unwrap(await (await page.request.get("/_emdash/api/auth/me")).json());
				expect((profile.user ?? profile).id).toBe(user.id);
				await evidence(
					"supbrd-plug-user",
					routeId,
					[user.id],
					"Real captured magic link restores the existing operator session; no external email transport.",
				);
			} finally {
				await owner.close();
			}
		});
	}
	test("invalid email cannot send a recovery request", async ({ page }) => {
		let requests = 0;
		page.on("request", (request) => {
			if (request.url().includes("magic-link/send")) requests++;
		});
		await page.goto("/reset_password");
		await page.getByRole("textbox", { name: "Email", exact: true }).fill("invalid");
		await page.getByRole("button", { name: "Send email link", exact: true }).click();
		await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeFocused();
		expect(requests).toBe(0);
	});
});
