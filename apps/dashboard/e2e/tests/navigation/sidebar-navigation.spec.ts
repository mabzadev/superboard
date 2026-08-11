import { test, expect } from "../../fixtures/base-fixtures";

test.describe("Sidebar Navigation", () => {
  test("sidebar shows navigation items", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/app/customers");

    // Key navigation items should be visible in sidebar
    await expect(
      page.getByRole("navigation", { name: "Product sections" })
    ).toBeVisible({
      timeout: 10_000,
    });
    const navigation = page.getByRole("navigation", {
      name: "Product sections",
    });
    await expect(navigation.getByRole("link")).toHaveCount(8);
    await expect(navigation.getByRole("link").first()).toHaveText("Dashboard");
  });

  test("navigates to links page", async ({ authenticatedPage: page }) => {
    await page.goto("/app/customers");

    // Click on Links navigation
    const linksNav = page.getByRole("link", {
      name: "Dynamic Links",
      exact: true,
    });
    await expect(linksNav).toBeVisible({ timeout: 10_000 });
    await linksNav.click();

    await page.waitForURL("**/dynamic-links/links**", { timeout: 10_000 });
  });

  test("navigates to settings page", async ({ authenticatedPage: page }) => {
    await page.goto("/app/customers");

    await page
      .getByRole("button", { name: /Open Test User account menu/i })
      .click();
    const settingsNav = page.getByRole("menuitem", {
      name: "Project Settings",
      exact: true,
    });
    await expect(settingsNav).toBeVisible({ timeout: 10_000 });
    await settingsNav.click();

    await page.waitForURL("**/project-settings**", { timeout: 10_000 });
  });

  test("module top bar only shows section navigation and environment", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/dynamic-links/campaigns");

    await expect(
      page.getByRole("navigation", { name: "Dynamic Links pages" })
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("combobox", { name: "Environment" })
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "breadcrumb" })
    ).toHaveCount(0);
  });

  test("account actions stay inside the user menu", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/app/customers");

    await expect(
      page.getByRole("menuitem", { name: "Account", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "Project Settings", exact: true })
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: /Open Test User account menu/i })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Account", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Project Settings", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /(?:Dark|Light) mode/ })
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  });

  test("mobile keeps the sidebar control in the module top bar", async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dynamic-links/campaigns");

    const topBar = page.getByRole("banner");
    const navigationTrigger = topBar.getByRole("button", {
      name: "Open navigation",
    });
    await expect(navigationTrigger).toBeVisible();
    await navigationTrigger.click();
    await expect(
      page.getByRole("navigation", { name: "Product sections" })
    ).toBeVisible();
  });

  test("project switcher shows project name", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/app/customers");

    await expect(page.getByText(/test project/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("uses the exact OpenFlow shell dimensions and flat menus", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/dynamic-links/campaigns");

    const sidebar = page.locator('[data-slot="sidebar-container"]');
    await expect(sidebar).toHaveCSS("width", "224px");
    await expect(page.getByRole("banner")).toHaveCSS("height", "48px");

    const primaryAction = page.getByRole("button", {
      name: "Create campaign",
      exact: true,
    });
    await expect(primaryAction).toHaveCSS("background-color", "rgb(15, 23, 42)");
    await expect(primaryAction).toHaveCSS("color", "rgb(248, 250, 252)");

    await page
      .getByRole("button", { name: /Open Test User account menu/i })
      .click();
    const userMenu = page.getByRole("menu");
    await expect(userMenu).toHaveCSS("width", "240px");
    const menuShadow = await userMenu.evaluate(
      (element) => getComputedStyle(element).boxShadow
    );
    expect(menuShadow.replaceAll("rgba(0, 0, 0, 0)", "")).not.toMatch(
      /(?:rgb|hsl|#)/
    );
    await page.keyboard.press("Escape");

    await page
      .getByRole("button", { name: "Collapse sidebar", exact: true })
      .click();
    await expect(sidebar).toHaveCSS("width", "64px");
  });
});
