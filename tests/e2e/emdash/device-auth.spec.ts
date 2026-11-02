import { test, expect } from "../../fixtures/emdash-browser";

const DEVICE_AUTHORIZE_PATTERN = /\/api\/oauth\/device\/authorize$/;

test.describe("Device Authorization", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Page rendering", () => {
		test("renders the device authorization page with heading", async ({ admin }) => {
			await admin.page.goto("/_emdash/admin/device");
			await admin.waitForHydration();

			await expect(admin.page.locator("h1")).toContainText("Authorize Device", {
				timeout: 15000,
			});

			await expect(admin.page.locator("text=Enter the code from your terminal")).toBeVisible();
		});

		test("shows user info badge for authenticated user", async ({ admin }) => {
			await admin.page.goto("/_emdash/admin/device");

			await expect(admin.page.getByText("Dev Admin")).toBeVisible({ timeout: 15000 });
			await expect(admin.page.getByText("Admin", { exact: true })).toBeVisible();
		});
	});

	test.describe("Code input", () => {
		test("shows device code input field", async ({ admin }) => {
			await admin.page.goto("/_emdash/admin/device");
			await admin.waitForHydration();

			const codeInput = admin.page.locator("#user-code");
			await expect(codeInput).toBeVisible({ timeout: 15000 });

			await expect(codeInput).toHaveAttribute("placeholder", "XXXX-XXXX");
		});

		test("Authorize button is disabled until 8 characters are entered", async ({ admin }) => {
			await admin.page.goto("/_emdash/admin/device");
			await admin.waitForHydration();

			const codeInput = admin.page.locator("#user-code");
			await expect(codeInput).toBeVisible({ timeout: 15000 });

			const authorizeBtn = admin.page.getByRole("button", { name: "Authorize" });
			const denyBtn = admin.page.getByRole("button", { name: "Deny" });
			await expect(authorizeBtn).toBeDisabled();
			await expect(denyBtn).toBeDisabled();

			await codeInput.fill("ABCD");
			await expect(authorizeBtn).toBeDisabled();

			await codeInput.fill("ABCD-1234");
			await expect(authorizeBtn).toBeEnabled();
			await expect(denyBtn).toBeEnabled();
		});

		test("auto-formats code with hyphen after 4 characters", async ({ admin }) => {
			await admin.page.goto("/_emdash/admin/device");
			await admin.waitForHydration();

			const codeInput = admin.page.locator("#user-code");
			await expect(codeInput).toBeVisible({ timeout: 15000 });

			await codeInput.pressSequentially("ABCDE");

			await expect(codeInput).toHaveValue("ABCD-E");
		});
	});

	test.describe("Invalid code submission", () => {
		test("submitting an invalid code shows error", async ({ admin }) => {
			await admin.page.goto("/_emdash/admin/device");
			await admin.waitForHydration();

			const codeInput = admin.page.locator("#user-code");
			await expect(codeInput).toBeVisible({ timeout: 15000 });

			await codeInput.fill("ZZZZ-9999");

			const authorizeBtn = admin.page.getByRole("button", { name: "Authorize" });
			await expect(authorizeBtn).toBeEnabled();

			const authResponse = admin.page.waitForResponse(
				(res) => DEVICE_AUTHORIZE_PATTERN.test(res.url()) && res.request().method() === "POST",
				{ timeout: 15000 },
			);

			await authorizeBtn.click();
			await authResponse;

			await expect(
				admin.page
					.locator("text=Invalid or expired code")
					.or(admin.page.locator(".text-destructive")),
			).toBeVisible({ timeout: 10000 });
		});
	});

	test.describe("URL pre-population", () => {
		test("pre-populates code from URL query parameter", async ({ admin }) => {
			await admin.page.goto("/_emdash/admin/device?code=TEST-CODE");
			await admin.waitForHydration();

			const codeInput = admin.page.locator("#user-code");
			await expect(codeInput).toBeVisible({ timeout: 15000 });

			await expect(codeInput).toHaveValue("TEST-CODE");
		});
	});
});
