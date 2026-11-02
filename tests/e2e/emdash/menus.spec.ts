import { test, expect } from "../../fixtures/emdash-browser";

test.describe("Menus", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Menu List", () => {
		test("displays menus page", async ({ admin }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			await admin.expectPageTitle("Menus");

			await expect(admin.page.getByRole("button", { name: "Create Menu" }).first()).toBeVisible();
		});

		test("shows empty state when no menus", async ({ admin }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			await expect(admin.page.locator("text=No menus yet")).toBeVisible();
		});
	});

	test.describe("Create Menu", () => {
		test("opens create menu dialog", async ({ admin, page }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			await page.getByRole("button", { name: "Create Menu" }).first().click();

			await expect(page.locator('[role="dialog"]')).toBeVisible();
		});

		test("creates a new menu", async ({ admin, page }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			const menuName = `test-menu-${Date.now()}`;
			const menuLabel = "E2E Test Menu";

			await admin.createMenu(menuName, menuLabel);

			await expect(page).toHaveURL(new RegExp(`/menus/${menuName}(\\?|$)`));

			await expect(page.locator("h1")).toContainText(menuLabel);
		});

		test("cancels menu creation", async ({ admin, page }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			await page.getByRole("button", { name: "Create Menu" }).first().click();

			await page.click('button:has-text("Cancel")');

			await expect(page.locator('[role="dialog"]')).not.toBeVisible();
		});
	});

	test.describe("Edit Menu", () => {
		test("shows empty items state for new menu", async ({ admin, page }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			const menuName = `empty-menu-${Date.now()}`;
			await admin.createMenu(menuName, "Empty Menu");

			await expect(page.locator("text=No menu items yet")).toBeVisible();
		});

		test("adds custom link to menu", async ({ admin, page }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			const menuName = `links-menu-${Date.now()}`;
			await admin.createMenu(menuName, "Links Menu");

			await admin.addMenuLink("Home", "https://example.com");

			const main = page.locator("main");
			await expect(main.locator("text=Home")).toBeVisible();
			await expect(main.locator("text=https://example.com")).toBeVisible();
		});

		test("adds multiple menu items", async ({ admin, page }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			const menuName = `multi-menu-${Date.now()}`;
			await admin.createMenu(menuName, "Multi Menu");

			await admin.addMenuLink("Home", "https://example.com");
			await admin.addMenuLink("About", "https://example.com/about");
			await admin.addMenuLink("Contact", "https://example.com/contact");

			await expect(page.locator("text=https://example.com").first()).toBeVisible();
			await expect(page.locator("text=https://example.com/about")).toBeVisible();
			await expect(page.locator("text=https://example.com/contact")).toBeVisible();
		});

		test("deletes menu item", async ({ admin, page }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			const menuName = `delete-item-${Date.now()}`;
			await admin.createMenu(menuName, "Delete Item Menu");
			await admin.addMenuLink("To Delete", "https://example.com");

			await expect(page.locator("text=To Delete")).toBeVisible();

			const itemRow = page.locator(".border.rounded-lg").filter({ hasText: "To Delete" });
			await itemRow.locator("button").last().click();

			await admin.waitForLoading();
			await expect(page.locator("text=To Delete")).not.toBeVisible();
		});
	});

	test.describe("Delete Menu", () => {
		test("deletes a menu from list", async ({ admin, page }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			const menuName = `to-delete-${Date.now()}`;
			const menuLabel = "To Delete Menu";
			await admin.createMenu(menuName, menuLabel);

			await admin.goToMenus();
			await admin.waitForLoading();

			await expect(page.locator(`text=${menuLabel}`).first()).toBeVisible();

			const menuCard = page.locator(".rounded-lg").filter({ hasText: menuLabel }).first();
			await menuCard.getByRole("button").last().click();

			await page.getByRole("button", { name: "Delete" }).click();

			await admin.waitForLoading();
			await expect(page.locator(`text=${menuLabel}`)).not.toBeVisible();
		});

		test("cancel delete keeps menu", async ({ admin, page }) => {
			await admin.goToMenus();
			await admin.waitForLoading();

			const menuName = `keep-menu-${Date.now()}`;
			const menuLabel = "Keep This Menu";
			await admin.createMenu(menuName, menuLabel);

			await admin.goToMenus();
			await admin.waitForLoading();

			const menuCard = page.locator(".rounded-lg").filter({ hasText: menuLabel }).first();
			await menuCard.getByRole("button").last().click();

			await page.getByRole("button", { name: "Cancel" }).click();

			await expect(page.locator(`text=${menuLabel}`).first()).toBeVisible();
		});
	});
});
