import { test, expect } from "@playwright/test";

import {
	capturedLink,
	ownerRequest,
	useCapture,
	virtualPasskey,
} from "../../fixtures/operator-auth.js";
import { evidence, unique, unwrap } from "../../fixtures/site-api.js";

test.describe("Operator registration", () => {
	test("shows the registration entry and email verification requirement", async ({ page }) => {
		await page.goto("/register");
		await expect(page.getByRole("heading", { name: "Create an operator account" })).toBeVisible();
		await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
	});
	test("requires a valid email before requesting registration", async ({ page }) => {
		let requests = 0;
		page.on("request", (request) => {
			if (request.url().includes("signup/request")) requests++;
		});
		await page.goto("/register/with_email");
		await page.getByRole("textbox", { name: "Email", exact: true }).fill("invalid");
		await page.getByRole("button", { name: "Send email link", exact: true }).click();
		await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeFocused();
		expect(requests).toBe(0);
	});
	for (const [path, routeId] of [
		["/register", "superboard.register"],
		["/register/with_email", "superboard.register_with_email"],
	] as const) {
		test(`${path} completes email verification and creates a real passkey account`, async ({
			page,
		}) => {
			const owner = await ownerRequest(page);
			try {
				await useCapture(owner.request);
				const email = `${unique("signup")}@example.test`;
				await virtualPasskey(page);
				await page.goto(path);
				await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
				await page.getByRole("button", { name: "Send email link", exact: true }).click();
				await expect(page.getByRole("status")).toContainText("If this address is eligible");
				await page.goto(await capturedLink(owner.request, email));
				await expect(
					page.getByRole("heading", { name: "Email verified!", exact: true }),
				).toBeVisible();
				await page
					.getByRole("textbox", { name: "Your name (optional)", exact: true })
					.fill("Verified Site operator");
				await page.getByRole("button", { name: "Create Account", exact: true }).click();
				await expect.poll(() => new URL(page.url()).pathname).toBe("/_emdash/admin");
				const profile = unwrap(await (await page.request.get("/_emdash/api/auth/me")).json());
				const user = profile.user ?? profile;
				expect(user.email).toBe(email);
				expect(user.name).toBe("Verified Site operator");
				await evidence(
					"supbrd-plug-user",
					routeId,
					[user.id],
					"Captured real verification email, followed its emitted URL, and completed WebAuthn account registration.",
				);
			} finally {
				await owner.close();
			}
		});
	}
});
